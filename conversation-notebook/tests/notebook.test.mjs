import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script, createContext } from 'node:vm';
import { createNotesStore, noteEditorState } from '../src/notes-store.js';
const PREFIX = 'test-notebook:';
function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
test('notes start blank, remain isolated and survive closing/recreating the plugin store', () => {
  const storage = memoryStorage();
  let store = createNotesStore(() => storage, PREFIX);
  assert.deepEqual(store.get('one'), { text: '', status: 'empty' });
  store.save('one', '第一份笔记\n手动输入');
  store.save('two', 'A separate note');
  assert.equal(store.get('one').text, '第一份笔记\n手动输入');
  store.dispose();
  store = createNotesStore(() => storage, PREFIX);
  assert.equal(store.get('one').text, '第一份笔记\n手动输入');
  assert.equal(store.get('two').text, 'A separate note');
  store.save('one', '');
  assert.deepEqual(store.get('one'), { text: '', status: 'empty' });
  assert.deepEqual(createNotesStore(() => storage, PREFIX).get('one'), { text: '', status: 'empty' });
  assert.equal(store.get('two').text, 'A separate note');
});
test('failed writes preserve drafts and retry; failed reads cannot overwrite an unknown note', async () => {
  const storage = memoryStorage();
  const store = createNotesStore(() => storage, PREFIX);
  store.save('one', 'original');
  const setter = storage.setItem;
  storage.setItem = () => { throw new Error('quota'); };
  store.save('one', 'unsaved draft');
  assert.deepEqual(store.get('one'), { text: 'unsaved draft', status: 'saveError' });
  assert.equal(storage.getItem(PREFIX + 'one'), 'original');
  storage.setItem = setter;
  await store.retry('one');
  assert.equal(storage.getItem(PREFIX + 'one'), 'unsaved draft');
  const getter = storage.getItem;
  storage.getItem = () => { throw new Error('blocked'); };
  const reopened = createNotesStore(() => storage, PREFIX);
  assert.equal(reopened.get('one').status, 'readError');
  reopened.save('one', 'must not overwrite');
  storage.getItem = getter;
  assert.equal(storage.getItem(PREFIX + 'one'), 'unsaved draft');
  await reopened.retry('one');
  assert.equal(reopened.get('one').text, 'unsaved draft');
});
test('all mounted views share one note; storage changes ignore unrelated keys and protect unsaved drafts', async () => {
  const storage = memoryStorage();
  const store = createNotesStore(() => storage, PREFIX);
  let notifications = 0;
  const unsubscribe = store.subscribe('one', () => notifications++);
  store.save('one', 'draft');
  assert.equal(notifications, 1);
  storage.setItem(PREFIX + 'one', 'changed in another window');
  store.onStorage({ key: 'other-plugin' });
  assert.equal(store.get('one').text, 'draft');
  store.onStorage({ key: PREFIX + 'one' });
  assert.equal(store.get('one').text, 'changed in another window');
  storage.setItem = () => { throw Error('quota'); };
  store.save('one', 'preserve draft');
  store.onStorage({ key: PREFIX + 'one' });
  assert.equal(store.get('one').text, 'preserve draft');
  unsubscribe();
  const previous = notifications;
  await store.retry('one');
  assert.equal(notifications, previous);
});
test('retry feedback disables repeated retries, preserves read-only semantics and returns to the right result', async () => {
  const storage = memoryStorage();
  const store = createNotesStore(() => storage, PREFIX);
  store.save('one', 'draft');
  const setter = storage.setItem;
  storage.setItem = () => { throw Error('quota'); };
  store.save('one', 'unsaved');
  const states = [];
  store.subscribe('one', () => states.push(store.get('one').status));
  const attempt = store.retry('one');
  assert.equal(store.get('one').status, 'retrying');
  assert.equal(noteEditorState(store.get('one')).retryDisabled, true);
  assert.equal(noteEditorState(store.get('one')).retryVisible, true);
  assert.equal(store.retry('one'), attempt);
  await attempt;
  assert.deepEqual(states, ['retrying', 'saveError']);
  assert.equal(noteEditorState(store.get('one')).retryDisabled, false);
  storage.setItem = setter;
  await store.retry('one');
  assert.equal(store.get('one').status, 'saved');
  const blocked = createNotesStore(() => { throw Error('blocked'); }, PREFIX);
  const readFailure = blocked.get('one');
  assert.equal(readFailure.status, 'readError');
  assert.equal(noteEditorState(readFailure).readOnly, true);
  await blocked.retry('one');
  assert.equal(blocked.get('one').status, 'readError');
  assert.equal(noteEditorState(blocked.get('one')).readOnly, true);
});
test('disposing cancels pending retries and preserves storage', async () => {
  const storage = memoryStorage();
  const store = createNotesStore(() => storage, PREFIX);
  store.save('one', 'saved');
  const setter = storage.setItem;
  storage.setItem = () => { throw Error('quota'); };
  store.save('one', 'unsaved');
  storage.setItem = setter;
  const attempt = store.retry('one');
  store.dispose();
  await attempt;
  assert.equal(storage.getItem(PREFIX + 'one'), 'saved');
});
test('built plugin registers a guide entry, body and title; teardown survives close errors and preserves unrelated kinds', async () => {
  let factory;
  const window = { __ModuleLoader__: { load: value => { factory = value.factory; } },
    addEventListener: () => events.push('listen'), removeEventListener: () => events.push('unlisten') };
  const events = [];
  const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8');
  new Script(source).runInContext(createContext({ window }));
  // No renderer or DOM is simulated. Test only the Cordis registration lifecycle.
  const plugin = factory(name => { assert.equal(name, 'react'); return {}; });
  const cleanups = [];
  let definition;
  const ctx = {
    effect: callback => cleanups.push(callback()),
    locale: { register: () => () => events.push('locale-off'), bind: () => key => key },
    sidebarRightTabs: { register: value => { definition = value; return () => events.push('type-off'); } },
    slots: { inject: (name, callback) => callback(), register: options => { events.push(options.name); return () => events.push(options.name + '-off'); } },
    sidebarRight: { openTabs: { getSnapshot: () => [
      { sessionId: 'one', tabId: 'owned', kind: definition.kind },
      { sessionId: 'two', tabId: 'owned-two', kind: definition.kind },
      { sessionId: 'one', tabId: 'unrelated', kind: 'files' },
      { sessionId: 'one', tabId: 'near-match', kind: definition.kind + '-other' },
    ] }, closeIn: (session, tab) => {
      events.push('close:' + session + ':' + tab);
      if (tab === 'owned') throw Error('one tab failed to close');
    } },
  };
  plugin.apply(ctx);
  assert.equal(definition.guide.length, 1);
  assert.equal(typeof definition.guide[0].icon, 'function');
  for (const cleanup of cleanups.reverse()) cleanup();
  assert.deepEqual(events.filter(e => e.startsWith('close:')), ['close:one:owned', 'close:two:owned-two']);
  assert.ok(events.indexOf('unlisten') < events.indexOf('close:one:owned'));
  assert.ok(events.indexOf('close:one:owned') < events.indexOf('type-off'));
  assert.ok(events.includes('sidebar.right.pane.tab-off'));
  assert.ok(events.includes('sidebar.right.pane.tab.title-off'));
  assert.ok(events.includes('locale-off'));
});
test('distribution exports work in a copied directory without original sources', async () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-notebook-package-'));
  try {
    for (const file of ['package.json', ...pkg.files]) await cp(new URL(file, root), join(temporary, file), { recursive: true });
    const host = await import(pathToFileURL(join(temporary, 'dist/index.js')).href);
    assert.equal(typeof host.apply, 'function');
    const client = await readFile(join(temporary, 'dist/client.js'), 'utf8');
    assert.equal(client.includes("from './notes-store.js'"), false);
    assert.equal(client.includes('D:\\'), false);
    new Script(client);
    for (const file of ['locale/zh.json', 'locale/en.json', 'icon.svg', 'cordis.patch.yml']) assert.ok((await readFile(join(temporary, file))).length);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
