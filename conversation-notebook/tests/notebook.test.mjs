import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script, createContext } from 'node:vm';
import { createNotesStore, noteEditorState, migrateLegacyNotes } from '../src/notes-store.js';
const PREFIX = 'test-notebook:';
function memoryAPI() {
  const values = new Map();
  let version = 0;
  return { values,
    async read(id) { return values.get(id) ?? null; },
    async write(id, text, revision) {
      if ((values.get(id)?.revision ?? null) !== revision) throw Object.assign(Error('changed'), { code: 'conflict' });
      const record = { text, revision: String(++version) };
      values.set(id, record); return record;
    },
    async importLegacy(id, text) { if (!values.has(id)) return this.write(id, text, null); return values.get(id); },
  };
}
function memoryStorage(entries = []) {
  const values = new Map(entries);
  return { get length() { return values.size; }, key: i => [...values.keys()][i], getItem: key => values.get(key) ?? null };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('asynchronous loads are read-only; notes stay isolated and survive store recreation and browser clearing', async () => {
  const api = memoryAPI();
  let store = createNotesStore(api);
  assert.equal(store.get('one').status, 'loading');
  assert.equal(noteEditorState(store.get('one')).readOnly, true);
  store.save('one', 'blocked while loading');
  await store.ready('one');
  assert.deepEqual(store.get('one'), { text: '', status: 'empty' });
  store.save('one', '第一份笔记\n手动输入');
  assert.equal(store.get('one').status, 'saving');
  await store.ready('one');
  await store.ready('two'); store.save('two', 'separate'); await store.ready('two');
  store.dispose();
  store = createNotesStore(api);
  await store.ready('one'); await store.ready('two');
  assert.equal(store.get('one').text, '第一份笔记\n手动输入');
  assert.equal(store.get('two').text, 'separate');
  store.save('one', ''); await store.ready('one');
  assert.equal(api.values.get('one').text, '');
  assert.deepEqual(store.get('one'), { text: '', status: 'empty' });
});

test('rapid edits serialize requests and never mark a newer draft saved on an older acknowledgement', async () => {
  const api = memoryAPI(); const original = api.write.bind(api); const started = deferred(); const release = deferred(); let calls = 0;
  api.write = async (...args) => { if (++calls === 1) { started.resolve(); await release.promise; } return original(...args); };
  const store = createNotesStore(api); await store.ready('one');
  store.save('one', 'a'); await started.promise;
  store.save('one', 'ab'); store.save('one', 'abc');
  assert.deepEqual(store.get('one'), { text: 'abc', status: 'saving' });
  release.resolve(); await store.ready('one');
  assert.equal(api.values.get('one').text, 'abc'); assert.equal(calls, 2);
  assert.equal(store.get('one').status, 'saved');
});

test('failed writes retain latest drafts; retries are shared; failed reads cannot overwrite data', async () => {
  const api = memoryAPI(); const store = createNotesStore(api); await store.ready('one');
  store.save('one', 'original'); await store.ready('one');
  const write = api.write; api.write = async () => { throw Error('offline'); };
  store.save('one', 'unsaved'); await store.ready('one');
  assert.deepEqual(store.get('one'), { text: 'unsaved', status: 'saveError' });
  assert.equal(api.values.get('one').text, 'original');
  const failed = store.retry('one'); assert.equal(store.retry('one'), failed);
  assert.equal(store.get('one').status, 'retrying'); assert.equal(noteEditorState(store.get('one')).retryDisabled, true);
  await failed; assert.equal(store.get('one').status, 'saveError');
  api.write = write; await store.retry('one'); assert.equal(api.values.get('one').text, 'unsaved');
  const read = api.read; api.read = async () => { throw Error('offline'); };
  const reopened = createNotesStore(api); await reopened.ready('one');
  assert.equal(reopened.get('one').status, 'readError'); reopened.save('one', 'must not write');
  assert.equal(api.values.get('one').text, 'unsaved'); api.read = read;
  await reopened.retry('one'); assert.equal(reopened.get('one').text, 'unsaved');
});

test('two clients reject stale saves and preserve conflict drafts until explicit reload', async () => {
  const api = memoryAPI(); const a = createNotesStore(api), b = createNotesStore(api);
  await a.ready('one'); await b.ready('one');
  a.save('one', 'newer'); await a.ready('one');
  b.save('one', 'my draft'); await b.ready('one');
  assert.deepEqual(b.get('one'), { text: 'my draft', status: 'conflict' });
  await b.retry('one'); b.save('one', 'cannot overwrite'); assert.equal(api.values.get('one').text, 'newer');
  await b.reload('one'); assert.equal(b.get('one').text, 'newer');
});

test('closing a sidebar lets pending edits finish without notifying disposed views', async () => {
  const api = memoryAPI(); const store = createNotesStore(api); await store.ready('one');
  let notifications = 0; store.subscribe('one', () => notifications++);
  store.save('one', 'persist after closing'); const pending = store.ready('one'); store.dispose();
  const count = notifications; await pending;
  assert.equal(api.values.get('one').text, 'persist after closing'); assert.equal(notifications, count);
});

test('migration includes archived sessions, keeps browser originals and never reads other values', async () => {
  const api = memoryAPI(); const storage = memoryStorage([[PREFIX + 'archived%2Fone', 'old archived note'], [PREFIX + 'empty', ''], ['unrelated', 'secret']]);
  const get = storage.getItem; storage.getItem = key => { assert.ok(key.startsWith(PREFIX)); return get(key); };
  assert.deepEqual(await migrateLegacyNotes(() => storage, PREFIX, api), { status: 'done', count: 2 });
  assert.equal(api.values.get('archived/one').text, 'old archived note'); assert.equal(storage.length, 3);
  await api.write('archived/one', 'server version', api.values.get('archived/one').revision);
  await migrateLegacyNotes(() => storage, PREFIX, api);
  assert.equal(api.values.get('archived/one').text, 'server version');
  const reopened = createNotesStore(api); await reopened.ready('archived/one'); assert.equal(reopened.get('archived/one').text, 'server version');
});

test('failed legacy migration rejects and can retry; inaccessible browser storage does not disable durable notes', async () => {
  const storage = memoryStorage([[PREFIX + 'one', 'keep me']]); const api = memoryAPI(); const migrate = api.importLegacy;
  api.importLegacy = async () => { throw Error('disk full'); };
  await assert.rejects(migrateLegacyNotes(() => storage, PREFIX, api)); assert.equal(storage.getItem(PREFIX + 'one'), 'keep me');
  api.importLegacy = migrate; await migrateLegacyNotes(() => storage, PREFIX, api); assert.equal(api.values.get('one').text, 'keep me');
  assert.equal((await migrateLegacyNotes(() => { throw Error('blocked'); }, PREFIX, api)).status, 'unavailable');
});

test('a failed legacy note does not stop migration of other sessions', async () => {
  const api = memoryAPI(); const migrate = api.importLegacy;
  api.importLegacy = async function(id, text) { if (id === 'blocked') throw Error('unavailable'); return migrate.call(this, id, text); };
  const storage = memoryStorage([[PREFIX + 'blocked', 'keep browser draft'], [PREFIX + 'other', 'migrate me']]);
  await assert.rejects(migrateLegacyNotes(() => storage, PREFIX, api), error => {
    assert.deepEqual(error.failedIds, ['blocked']); assert.equal(error.count, 1); return true;
  });
  assert.equal(api.values.get('other').text, 'migrate me');
});

test('built plugin registers guide, body and title and closes only its own tabs', async () => {
  let factory; const events = [];
  const window = { __ModuleLoader__: { load: value => { factory = value.factory; } },
    addEventListener: () => events.push('listen'), removeEventListener: () => events.push('unlisten') };
  new Script(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')).runInContext(createContext({ window }));
  const plugin = factory(name => { assert.equal(name, 'react'); return {}; });
  const cleanups = []; let definition;
  const ctx = {
    effect: callback => cleanups.push(callback()),
    locale: { register: () => () => events.push('locale-off'), bind: () => key => key },
    sidebarRightTabs: { register: value => { definition = value; return () => events.push('type-off'); } },
    slots: { inject: (name, callback) => callback(), register: options => { events.push(options.name); return () => events.push(options.name + '-off'); } },
    sidebarRight: { openTabs: { getSnapshot: () => [
      { sessionId: 'one', tabId: 'owned', kind: definition.kind },
      { sessionId: 'two', tabId: 'owned-two', kind: definition.kind },
      { sessionId: 'one', tabId: 'unrelated', kind: 'files' },
    ] }, closeIn: (session, tab) => { events.push('close:' + session + ':' + tab); if (tab === 'owned') throw Error('stale'); } },
  };
  plugin.apply(ctx); assert.equal(definition.guide.length, 1);
  for (const cleanup of cleanups.reverse()) cleanup();
  assert.deepEqual(events.filter(e => e.startsWith('close:')), ['close:one:owned', 'close:two:owned-two']);
  assert.ok(events.indexOf('close:one:owned') < events.indexOf('type-off'));
  assert.ok(events.includes('sidebar.right.pane.tab-off')); assert.ok(events.includes('locale-off'));
});

test('distribution works without original source directory', async () => {
  const root = new URL('../', import.meta.url);
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-notebook-package-'));
  try {
    for (const file of ['package.json', 'dist', 'cordis.patch.yml', 'locale', 'icon.svg', 'README.md']) {
      await cp(new URL(file, root), join(temporary, file), { recursive: true });
    }
    const host = await import(pathToFileURL(join(temporary, 'dist/index.js')).href); assert.equal(typeof host.apply, 'function');
    const client = await readFile(join(temporary, 'dist/client.js'), 'utf8'); assert.equal(client.includes("from './notes-store.js'"), false);
    assert.equal(client.includes('D:\\'), false); new Script(client);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
