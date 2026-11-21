import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createDiskStore, MAX_NOTE_BYTES } from '../src/disk-store.js';

async function fixture(t) {
  const parent = await fs.mkdtemp(join(tmpdir(), 'notebook-disk-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'storage');
  const notePath = id => join(root, 'notes', `${createHash('sha256').update(id).digest('hex')}.json`);
  return { parent, root, notePath, store: createDiskStore(root) };
}

const conflict = { code: 'conflict' };
const damaged = { code: 'invalid_record' };

test('missing reads create nothing; records persist and sessions stay isolated', async t => {
  const { root, store, notePath } = await fixture(t);
  assert.equal(await store.read('one'), null);
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  const one = await store.write('one', '中文笔记\nline two', null);
  const two = await store.write('two', 'isolated', null);
  assert.equal(one.version, 1);
  assert.equal(one.sessionId, 'one');
  assert.match(one.revision, /^[0-9a-f-]{36}$/);
  assert.equal(new Date(one.updatedAt).toISOString(), one.updatedAt);
  assert.deepEqual(JSON.parse(await fs.readFile(notePath('one'), 'utf8')), one);
  const reopened = createDiskStore(root);
  assert.deepEqual(await reopened.read('one'), one);
  assert.deepEqual(await reopened.read('two'), two);
});

test('legacy notes above the former 2 MiB limit migrate intact and survive store recreation', async t => {
  const { root, store } = await fixture(t);
  const text = '中'.repeat(1024 * 1024);
  assert.equal(Buffer.byteLength(text, 'utf8'), 3 * 1024 * 1024);
  const imported = await store.importLegacy('large-archived', text);
  const reopened = createDiskStore(root);
  const persisted = await reopened.read('large-archived');
  assert.equal(persisted.text, text);
  assert.deepEqual(persisted, imported);
  assert.deepEqual(await reopened.importLegacy('large-archived', text), imported);
});

test('empty text is an existing record with a revision', async t => {
  const { store } = await fixture(t);
  const empty = await store.write('empty', '', null);
  assert.equal((await store.read('empty')).text, '');
  assert.deepEqual(await store.importLegacy('empty', ''), empty);
  await assert.rejects(store.write('empty', 'overwrite', null), conflict);
  const next = await store.write('empty', 'next', empty.revision);
  assert.notEqual(next.revision, empty.revision);
});

test('concurrent imports create one canonical record and preserve conflicting legacy values', async t => {
  const { store, root } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 16 }, (_, i) => store.importLegacy('archived', `legacy ${i}`)));
  const canonical = await store.read('archived');
  assert.equal(canonical.text, 'legacy 0');
  assert.ok(results.every(result => result.revision === canonical.revision));
  assert.equal(results[0].legacyBackup, undefined);
  assert.ok(results.slice(1).every(result => result.legacyBackup === true));
  const files = await fs.readdir(join(root, 'legacy-backups'));
  assert.equal(files.length, 15);
  const backups = await Promise.all(files.map(async file => JSON.parse(await fs.readFile(join(root, 'legacy-backups', file), 'utf8'))));
  assert.deepEqual(backups.map(record => record.text).sort(), Array.from({ length: 15 }, (_, i) => `legacy ${i + 1}`).sort());
});

test('conflicting legacy backups persist and repeated imports are idempotent', async t => {
  const { store, root } = await fixture(t);
  const canonical = await store.write('archived/id', 'server text', null);
  const first = await store.importLegacy('archived/id', 'browser text');
  assert.deepEqual(first, { ...canonical, legacyBackup: true });
  const backupDirectory = join(root, 'legacy-backups');
  const [filename] = await fs.readdir(backupDirectory);
  assert.match(filename, /^[0-9a-f]{64}\.json$/);
  const bytes = await fs.readFile(join(backupDirectory, filename), 'utf8');
  assert.equal(JSON.parse(bytes).text, 'browser text');
  assert.deepEqual(await createDiskStore(root).importLegacy('archived/id', 'browser text'), first);
  assert.equal(await fs.readFile(join(backupDirectory, filename), 'utf8'), bytes);
  assert.deepEqual(await store.read('archived/id'), canonical);
  assert.deepEqual(await store.importLegacy('archived/id', 'server text'), canonical);
  assert.equal((await fs.readdir(backupDirectory)).length, 1);
});

test('concurrent CAS permits one winner, rejects stale revisions, and recovers after rejection', async t => {
  const { store } = await fixture(t);
  const original = await store.write('session', 'original', null);
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => store.write('session', `edit ${i}`, original.revision)));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(attempts.filter(result => result.status === 'rejected').every(result => result.reason.code === 'conflict'));
  const winner = await store.read('session');
  assert.equal(winner.text, 'edit 0');
  const next = await store.write('session', 'after conflict', winner.revision);
  assert.equal((await store.read('session')).revision, next.revision);
  await assert.rejects(store.write('missing', 'stale', randomUUID()), conflict);
  assert.equal(await store.read('missing'), null);
});

test('concurrent initial CAS and imports share the same session queue', async t => {
  const { store } = await fixture(t);
  const [first, second, third] = await Promise.allSettled([
    store.write('session', 'canonical', null),
    store.importLegacy('session', 'canonical'),
    store.write('session', 'must conflict', null),
  ]);
  assert.equal(first.status, 'fulfilled');
  assert.deepEqual(second.value, first.value);
  assert.equal(third.reason.code, 'conflict');
});

test('invalid JSON, structure, ID, revision, timestamp and oversize text cannot be overwritten', async t => {
  const { root, store, notePath } = await fixture(t);
  await fs.mkdir(join(root, 'notes'), { recursive: true });
  const valid = { version: 1, sessionId: 'broken', text: 'valuable', revision: randomUUID(), updatedAt: new Date().toISOString() };
  const variants = ['{broken', 'null', '[]', JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, sessionId: 'another' }), JSON.stringify({ ...valid, text: null }),
    JSON.stringify({ ...valid, revision: 'bad' }), JSON.stringify({ ...valid, updatedAt: 'bad' }),
    JSON.stringify({ ...valid, text: 'a'.repeat(MAX_NOTE_BYTES + 1) })];
  for (const bytes of variants) {
    await fs.writeFile(notePath('broken'), bytes);
    await assert.rejects(store.read('broken'), damaged);
    await assert.rejects(store.write('broken', 'replacement', null), damaged);
    await assert.rejects(store.importLegacy('broken', 'replacement'), damaged);
    assert.equal(await fs.readFile(notePath('broken'), 'utf8'), bytes);
  }
});

test('filesystem read errors propagate and do not count as absence', async t => {
  const { store, root, notePath } = await fixture(t);
  await fs.mkdir(notePath('directory'), { recursive: true });
  await assert.rejects(store.read('directory'), error => error.code !== 'ENOENT');
  await assert.rejects(store.write('directory', 'no', null));
  await assert.rejects(store.importLegacy('directory', 'no'));
  assert.deepEqual(await fs.readdir(notePath('directory')), []);
  assert.equal((await fs.readdir(join(root, 'notes'))).length, 1);
});

test('session IDs containing paths cannot escape the notes directory', async t => {
  const { store, root, parent } = await fixture(t);
  const ids = ['../escape', '..\\escape', '/absolute/path', 'C:\\absolute\\path', '../'.repeat(100), 'nul\0id'];
  for (const id of ids) {
    const record = await store.write(id, `text:${id}`, null);
    assert.equal((await store.read(id)).revision, record.revision);
  }
  assert.deepEqual(await fs.readdir(parent), ['storage']);
  assert.deepEqual((await fs.readdir(root)).sort(), ['locks', 'notes']);
  assert.deepEqual(await fs.readdir(join(root, 'locks')), []);
  const names = await fs.readdir(join(root, 'notes'));
  assert.equal(names.length, ids.length);
  assert.ok(names.every(name => /^[0-9a-f]{64}\.json$/.test(name)));
});

test('parameters and UTF-8 byte limits are checked before writing', async t => {
  const { store } = await fixture(t);
  for (const root of [null, undefined, '', ' ', 'bad\0path', 123]) assert.throws(() => createDiskStore(root), TypeError);
  for (const id of ['', 'x'.repeat(1025), null, 123]) {
    await assert.rejects(store.read(id), TypeError);
    await assert.rejects(store.write(id, '', null), TypeError);
    await assert.rejects(store.importLegacy(id, ''), TypeError);
  }
  for (const text of [null, 123, {}, undefined]) {
    await assert.rejects(store.write('id', text, null), TypeError);
    await assert.rejects(store.importLegacy('id', text), TypeError);
  }
  for (const revision of [undefined, '', 123, {}, 'invalid']) await assert.rejects(store.write('id', '', revision), TypeError);
  await assert.rejects(store.write('id', '中'.repeat(Math.ceil(MAX_NOTE_BYTES / 3)), null), RangeError);
  await assert.rejects(store.importLegacy('id', 'a'.repeat(MAX_NOTE_BYTES + 1)), RangeError);
  const boundaryId = 'x'.repeat(1024);
  const boundary = await store.write(boundaryId, 'a'.repeat(MAX_NOTE_BYTES), null);
  assert.equal((await store.read(boundaryId)).text.length, MAX_NOTE_BYTES);
  assert.equal(boundary.sessionId.length, 1024);
});

test('rename failure preserves old bytes, cleans temporary files, and allows retry', async t => {
  const { store, root, notePath } = await fixture(t);
  const original = await store.write('session', 'old text', null);
  const oldBytes = await fs.readFile(notePath('session'), 'utf8');
  const rename = t.mock.method(fs, 'rename', async () => { throw Object.assign(new Error('simulated rename failure'), { code: 'EIO' }); });
  try {
    await assert.rejects(store.write('session', 'new text', original.revision), { code: 'EIO' });
    assert.equal(await fs.readFile(notePath('session'), 'utf8'), oldBytes);
    assert.deepEqual(await fs.readdir(join(root, 'notes')), [notePath('session').split(/[\\/]/).at(-1)]);
  } finally {
    rename.mock.restore();
  }
  assert.deepEqual(await fs.readdir(join(root, 'locks')), []);
  assert.equal((await createDiskStore(root).write('session', 'retry', original.revision)).text, 'retry');
});

test('legacy backup write failure is reported without changing the canonical record', async t => {
  const { store, root } = await fixture(t);
  const original = await store.write('session', 'canonical', null);
  const rename = t.mock.method(fs, 'rename', async () => { throw Object.assign(new Error('backup failure'), { code: 'EIO' }); });
  try {
    await assert.rejects(store.importLegacy('session', 'legacy'), { code: 'EIO' });
    assert.deepEqual(await store.read('session'), original);
    assert.deepEqual(await fs.readdir(join(root, 'legacy-backups')), []);
  } finally {
    rename.mock.restore();
  }
  assert.deepEqual(await fs.readdir(join(root, 'locks')), []);
  assert.equal((await createDiskStore(root).importLegacy('session', 'legacy')).legacyBackup, true);
});

function runNode(source, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(child.pid);
      else reject(new Error(`Node child failed: exit=${code}, signal=${signal}`));
    });
  });
}

const moduleURL = new URL('../src/disk-store.js', import.meta.url).href;

test('independent store instances serialize CAS and concurrent imports', async t => {
  const { root, store } = await fixture(t);
  const stores = Array.from({ length: 8 }, () => createDiskStore(root));
  const original = await store.write('cas', 'original', null);
  const attempts = await Promise.allSettled(stores.map((other, i) => other.write('cas', `edit ${i}`, original.revision)));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(attempts.filter(result => result.status === 'rejected').every(result => result.reason.code === 'conflict'));
  const imports = await Promise.all(stores.map((other, i) => other.importLegacy('import', `legacy ${i}`)));
  const canonical = await store.read('import');
  assert.ok(imports.every(record => record.revision === canonical.revision));
  assert.equal((await fs.readdir(join(root, 'legacy-backups'))).length, stores.length - 1);
  assert.deepEqual(await fs.readdir(join(root, 'locks')), []);
});

test('independent processes serialize CAS and legacy imports without losing values', async t => {
  const { parent, root, store } = await fixture(t);
  const original = await store.write('cas', 'original', null);
  const source = `
    import fs from 'node:fs/promises';
    const { createDiskStore } = await import(${JSON.stringify(moduleURL)});
    const [root, revision, output, index, action] = process.argv.slice(1);
    const store = createDiskStore(root);
    let result;
    try {
      result = action === 'cas' ? await store.write('cas', 'edit ' + index, revision)
        : await store.importLegacy('import', 'legacy ' + index);
    } catch (error) {
      if (error.code !== 'conflict') throw error;
      result = { code: error.code };
    }
    await fs.writeFile(output, JSON.stringify(result));
  `;
  async function batch(action) {
    return Promise.all(Array.from({ length: 4 }, async (_, i) => {
      const output = join(parent, `${action}-${i}.json`);
      await runNode(source, [root, original.revision, output, String(i), action]);
      return JSON.parse(await fs.readFile(output, 'utf8'));
    }));
  }
  const attempts = await batch('cas');
  assert.equal(attempts.filter(result => result.revision).length, 1);
  assert.equal(attempts.filter(result => result.code === 'conflict').length, 3);
  const imports = await batch('import');
  const canonical = await store.read('import');
  assert.ok(imports.every(record => record.revision === canonical.revision));
  const backups = await fs.readdir(join(root, 'legacy-backups'));
  const saved = await Promise.all(backups.map(async name => JSON.parse(await fs.readFile(join(root, 'legacy-backups', name), 'utf8')).text));
  assert.deepEqual([...saved, canonical.text].sort(), ['legacy 0', 'legacy 1', 'legacy 2', 'legacy 3']);
  assert.deepEqual(await fs.readdir(join(root, 'locks')), []);
});

test('multiple recovery contenders safely reclaim a dead process lock', async t => {
  const { root, store } = await fixture(t);
  const lockDirectory = join(root, 'locks');
  const path = join(lockDirectory, `${createHash('sha256').update('dead').digest('hex')}.lock`);
  const deadPid = await runNode(`
    import fs from 'node:fs/promises';
    import { dirname } from 'node:path';
    import { randomUUID } from 'node:crypto';
    const path = process.argv[1];
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify({ pid: process.pid, token: randomUUID() }));
  `, [path]);
  assert.equal(JSON.parse(await fs.readFile(path, 'utf8')).pid, deadPid);
  const contenders = Array.from({ length: 8 }, () => createDiskStore(root));
  const attempts = await Promise.allSettled(contenders.map((other, i) => other.write('dead', `recovered ${i}`, null)));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(attempts.filter(result => result.status === 'rejected').every(result => result.reason.code === 'conflict'));
  assert.match((await store.read('dead')).text, /^recovered /);
  assert.deepEqual(await fs.readdir(lockDirectory), []);
});

test('an old lock owned by a live process is retained until its owner releases it', async t => {
  const { root, store } = await fixture(t);
  const directory = join(root, 'locks');
  const path = join(directory, `${createHash('sha256').update('live').digest('hex')}.lock`);
  await fs.mkdir(directory, { recursive: true });
  const metadata = JSON.stringify({ pid: process.pid, token: randomUUID() });
  await fs.writeFile(path, metadata);
  await fs.utimes(path, new Date(0), new Date(0));
  let finished = false;
  const pending = store.write('live', 'after release', null).finally(() => { finished = true; });
  try {
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(finished, false);
    assert.equal(await fs.readFile(path, 'utf8'), metadata);
  } finally {
    await fs.unlink(path);
  }
  assert.equal((await pending).text, 'after release');
});

test('an abandoned reaper lock times out explicitly without deleting a session lock', { timeout: 15_000 }, async t => {
  const { root, store } = await fixture(t);
  const deadPid = await runNode('');
  const directory = join(root, 'locks');
  const path = join(directory, `${createHash('sha256').update('blocked').digest('hex')}.lock`);
  await fs.mkdir(directory, { recursive: true });
  const metadata = JSON.stringify({ pid: deadPid, token: randomUUID() });
  await fs.writeFile(path, metadata);
  await fs.writeFile(join(directory, '.reaper'), 'abandoned');
  await assert.rejects(store.write('blocked', 'must not write', null), { code: 'lock_timeout' });
  assert.equal(await fs.readFile(path, 'utf8'), metadata);
  assert.equal(await fs.readFile(join(directory, '.reaper'), 'utf8'), 'abandoned');
  assert.equal(await store.read('blocked'), null);
});
