import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const clientSource = await readFile(join(packageDir, 'client.js'), 'utf8');

const STORAGE_KEY = 'dsh.plugin-actions.unread.v1';
const registrations = [];
const storage = new Map();

const localStorageStub = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)); },
};

globalThis.window = {
  localStorage: localStorageStub,
  __ModuleLoader__: { load: registration => { registrations.push(registration); } },
};

const moduleUrl = `data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}`;
await import(moduleUrl);

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};

const requireStub = specifier => {
  if (specifier === 'react') return React;
  throw new Error(`unexpected module request: ${specifier}`);
};

function storedMarks() {
  const raw = storage.get(STORAGE_KEY);
  return raw === undefined ? [] : JSON.parse(raw);
}

function createContext({ omit = [], initialRows = [], initialArchived = [] } = {}) {
  const menuContributions = [];
  const slotRegistrations = [];
  const localeRegistrations = [];
  const notifyCalls = [];
  const listListeners = new Set();
  const workspaceListeners = new Set();
  let sessionList = snapshot(initialRows);
  let workspaceState = {
    items: [],
    archivedSessionIds: [...initialArchived],
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  };

  function snapshot(rows) {
    const byId = {};
    for (const row of rows) byId[row.id] = { id: row.id, retainedBy: { mainView: row.mainView ?? 0 } };
    return { ids: rows.map(row => row.id), byId, phase: 'ready', projectionsBySession: {} };
  }

  const ctx = {
    effect(fn) {
      const cleanup = fn();
      return typeof cleanup === 'function' ? cleanup : () => {};
    },
    inject(deps, callback) {
      // Like Cordis, a missing optional service leaves the callback uninstalled.
      if (!deps.every(name => ctx[name] !== undefined)) return () => {};
      callback(ctx);
      return () => {};
    },
    slots: {
      inject(_name, register) {
        const dispose = register();
        return () => { if (typeof dispose === 'function') dispose(); };
      },
      register(options, component) {
        slotRegistrations.push({ options, component });
        return () => {};
      },
    },
    locale: {
      register(ns, dictionaries) {
        localeRegistrations.push({ ns, dictionaries });
        return () => {};
      },
      bind(ns) {
        const entry = localeRegistrations.find(item => item.ns === ns);
        return (key, params) => {
          const template = entry?.dictionaries.en?.[key] ?? key;
          if (params === undefined) return template;
          return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
        };
      },
    },
    sessions: {
      list: {
        getSnapshot: () => sessionList,
        subscribe(listener) {
          listListeners.add(listener);
          return () => { listListeners.delete(listener); };
        },
      },
    },
    workspaces: {
      list: {
        getSnapshot: () => workspaceState,
        subscribe(listener) {
          workspaceListeners.add(listener);
          return () => { workspaceListeners.delete(listener); };
        },
      },
    },
    contextMenus: {
      register(contribution) {
        menuContributions.push(contribution);
        return () => {};
      },
      notify(...args) {
        notifyCalls.push(args);
      },
    },
  };

  for (const name of omit) delete ctx[name];

  return {
    ctx,
    menuContributions,
    slotRegistrations,
    localeRegistrations,
    notifyCalls,
    emit(rows) {
      sessionList = snapshot(rows);
      for (const listener of [...listListeners]) listener();
    },
    emitWorkspaces(archivedSessionIds) {
      workspaceState = { ...workspaceState, archivedSessionIds: [...archivedSessionIds] };
      for (const listener of [...workspaceListeners]) listener();
    },
  };
}

function mount(options) {
  const plugin = registrations[0].factory(requireStub);
  const harness = createContext(options);
  plugin.apply(harness.ctx);
  return { plugin, ...harness };
}

function menuContribution(harness) {
  const contribution = harness.menuContributions.find(item => item.target === 'session');
  assert.ok(contribution, 'a session context-menu contribution is registered');
  return contribution;
}

function renderMark(harness, sessionId, { mainView = 0, completionUnread = false } = {}) {
  const slot = harness.slotRegistrations.find(item => item.options.name === 'sidebar.session.row.trailing');
  assert.ok(slot, 'the trailing seat carries the unread mark');
  return slot.component({
    sessionId,
    t: key => key,
    useSessionRetainInfo: (_id, selector) => selector({
      referenceCount: mainView > 0 ? 1 : 0,
      retainedBy: mainView > 0 ? { mainView } : {},
    }),
    useSessionStatus: selector => selector(new Map([[
      sessionId,
      { running: false, pendingInteraction: undefined, completionUnread },
    ]])),
  });
}

test('package browser half registers once with the package identity', () => {
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, '@kazuma-124/dsh-plugin-actions');
});

test('registers the contribution surfaces, menu icon and locale dictionaries', async () => {
  storage.clear();
  const { slotRegistrations, localeRegistrations } = mount();
  const names = slotRegistrations.map(item => item.options.name).sort();
  assert.deepEqual(names, ['contextMenu.icon', 'plugins.detail.actions', 'sidebar.session.row.trailing']);
  assert.equal(slotRegistrations.find(item => item.options.name === 'contextMenu.icon').options.key, 'plugin-actions.unread');

  const locale = localeRegistrations.find(item => item.ns === '@kazuma-124/dsh-plugin-actions');
  assert.ok(locale);
  for (const key of [
    'reveal', 'revealFailed', 'markUnread', 'clearUnread', 'markedNotice', 'clearedNotice', 'unreadBadge', 'unreadStoreFailed',
  ]) {
    assert.equal(typeof locale.dictionaries.en[key], 'string');
    assert.equal(typeof locale.dictionaries.zh[key], 'string');
  }

  const host = await readFile(join(packageDir, 'index.js'), 'utf8');
  assert.ok(host.includes("API_PATH + 'reveal'"));
});

test('session menu toggles a mark and re-resolves its label', () => {
  storage.clear();
  const harness = mount();
  const contribution = menuContribution(harness);
  assert.equal(contribution.id, 'plugin-actions-mark-unread');
  assert.equal(contribution.order, 350);

  const target = { sessionId: 'session-a', displayTitle: 'A' };
  const [mark] = contribution.resolve(target);
  assert.equal(mark.id, 'mark-unread');
  assert.equal(mark.label, 'Mark as unread');
  assert.deepEqual(mark.icon, { key: 'plugin-actions.unread' });
  mark.run();
  assert.deepEqual(storedMarks(), ['session-a']);
  assert.deepEqual(harness.notifyCalls.at(-1), ['Marked as unread', true]);

  const [clear] = contribution.resolve(target);
  assert.equal(clear.id, 'clear-unread-mark');
  assert.equal(clear.label, 'Clear unread mark');
  clear.run();
  assert.deepEqual(storedMarks(), []);
  assert.deepEqual(harness.notifyCalls.at(-1), ['Unread mark cleared', true]);
});

test('row mark shows only while marked, closed and without a host unread dot', () => {
  storage.clear();
  const harness = mount();
  menuContribution(harness).resolve({ sessionId: 'session-b' })[0].run();

  assert.equal(renderMark(harness, 'session-b')?.props['aria-label'], 'unreadBadge');
  assert.equal(renderMark(harness, 'session-b', { mainView: 1 }), null);
  assert.equal(renderMark(harness, 'session-b', { completionUnread: true }), null);
  assert.equal(renderMark(harness, 'session-other'), null);
});

test('opening the Session clears its mark but keeps the others', () => {
  storage.clear();
  const harness = mount();
  const contribution = menuContribution(harness);
  contribution.resolve({ sessionId: 'session-c' })[0].run();
  contribution.resolve({ sessionId: 'session-d' })[0].run();

  harness.emit([{ id: 'session-c', mainView: 0 }, { id: 'session-d', mainView: 0 }]);
  assert.deepEqual(storedMarks().sort(), ['session-c', 'session-d']);

  harness.emit([{ id: 'session-c', mainView: 1 }, { id: 'session-d', mainView: 0 }]);
  assert.deepEqual(storedMarks(), ['session-d']);
});

test('a mark survives a restart that restores its Session as the open one', () => {
  storage.clear();
  storage.set(STORAGE_KEY, JSON.stringify(['session-e']));
  const harness = mount({ initialRows: [{ id: 'session-e', mainView: 1 }] });
  assert.deepEqual(storedMarks(), ['session-e']);
  assert.equal(renderMark(harness, 'session-e', { mainView: 1 }), null);

  // Leaving the conversation keeps the reminder; opening it again consumes it.
  harness.emit([{ id: 'session-e', mainView: 0 }]);
  assert.deepEqual(storedMarks(), ['session-e']);
  assert.equal(renderMark(harness, 'session-e')?.props['aria-label'], 'unreadBadge');

  harness.emit([{ id: 'session-e', mainView: 1 }]);
  assert.deepEqual(storedMarks(), []);
});

test('archiving a Session drops its mark and hides the menu entry', () => {
  storage.clear();
  const harness = mount();
  const contribution = menuContribution(harness);
  contribution.resolve({ sessionId: 'session-f' })[0].run();
  assert.deepEqual(storedMarks(), ['session-f']);

  harness.emitWorkspaces(['session-f']);
  assert.deepEqual(storedMarks(), []);
  assert.deepEqual(contribution.resolve({ sessionId: 'session-f' }), []);
});

test('marks stored for Sessions that are already archived are dropped on start', () => {
  storage.clear();
  storage.set(STORAGE_KEY, JSON.stringify(['session-g']));
  const harness = mount({ initialArchived: ['session-g'] });
  assert.deepEqual(storedMarks(), []);
  assert.equal(renderMark(harness, 'session-g'), null);
});

test('a new plugin instance reads the persisted marks', () => {
  storage.clear();
  mount().menuContributions[0].resolve({ sessionId: 'session-h' })[0].run();
  assert.deepEqual(storedMarks(), ['session-h']);

  const reloaded = mount();
  const [action] = menuContribution(reloaded).resolve({ sessionId: 'session-h' });
  assert.equal(action.id, 'clear-unread-mark');
});

test('corrupted or foreign storage falls back to no marks', () => {
  storage.clear();
  storage.set(STORAGE_KEY, '{not json');
  assert.equal(renderMark(mount(), 'session-i'), null);

  storage.set(STORAGE_KEY, JSON.stringify(['session-j', 42, null, { id: 'x' }]));
  assert.equal(renderMark(mount(), 'session-j')?.props['aria-label'], 'unreadBadge');
});

test('optional menu, session and workspace services degrade without breaking the rest', () => {
  storage.clear();
  for (const omit of [['contextMenus'], ['sessions'], ['workspaces']]) {
    const harness = mount({ omit });
    assert.equal(harness.slotRegistrations.length, 3);
    if (omit.includes('contextMenus')) assert.equal(harness.menuContributions.length, 0);
  }
});

test('a failed browser storage write reports through the shared menu notice', () => {
  storage.clear();
  const harness = mount();
  const original = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error('quota'); };
  try {
    menuContribution(harness).resolve({ sessionId: 'session-k' })[0].run();
  } finally {
    window.localStorage.setItem = original;
  }
  assert.equal(harness.notifyCalls.length, 1);
  assert.equal(harness.notifyCalls[0][1], false);
  // The in-memory mark still exists so the current page stays consistent.
  assert.equal(renderMark(harness, 'session-k')?.props['aria-label'], 'unreadBadge');
});
