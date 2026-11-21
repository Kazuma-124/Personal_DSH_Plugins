import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerNotebookRoutes, API_PATH, inject } from '../src/host.js';
import { createDiskStore, MAX_NOTE_BYTES } from '../src/disk-store.js';

test('authenticated connection routes persist notes and report conflicts, invalid inputs and import backups', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notebook-routes-'));
  try {
    const routes = new Map();
    registerNotebookRoutes({ connection: { fetch: { register(route) { routes.set(route.path, route); } } } }, createDiskStore(directory));
    assert.deepEqual(inject, ['connection']); assert.equal(routes.size, 3);
    for (const route of routes.values()) { assert.deepEqual(route.methods, ['POST']); assert.equal(route.requestBody, 'streaming'); }
    async function call(action, input, raw = false) {
      const route = routes.get(API_PATH + action);
      return route.fetch(new Request('http://localhost' + route.path, { method: 'POST', body: raw ? input : JSON.stringify(input) }));
    }
    let response = await call('read', { sessionId: 'archived-session' });
    assert.deepEqual(await response.json(), { record: null }); assert.equal(response.headers.get('cache-control'), 'no-store');
    response = await call('import', { sessionId: 'archived-session', text: '旧笔记' });
    const original = (await response.json()).record; assert.equal(original.text, '旧笔记');
    response = await call('write', { sessionId: 'archived-session', text: 'saved on disk', revision: original.revision });
    assert.equal(response.status, 200); const current = (await response.json()).record;
    response = await call('write', { sessionId: 'archived-session', text: 'stale', revision: original.revision });
    assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'conflict');
    response = await call('import', { sessionId: 'archived-session', text: 'different browser version' });
    assert.equal((await response.json()).record.legacyBackup, true);
    assert.equal((await readdir(join(directory, 'legacy-backups'))).length, 1);
    assert.equal((await createDiskStore(directory).read('archived-session')).text, current.text);
    for (const input of [null, [], {}, { sessionId: '' }, { sessionId: 5 }, { sessionId: 'one', path: '../../secret' }]) {
      response = await call('read', input); assert.equal(response.status, 400);
    }
    assert.equal((await call('write', { sessionId: 'one', text: 'no revision' })).status, 400);
    assert.equal((await call('write', { sessionId: 'one', text: 'x', revision: 'invalid' })).status, 400);
    assert.equal((await call('import', { sessionId: 'one', text: 'x'.repeat(MAX_NOTE_BYTES + 1) })).status, 413);
    assert.equal((await call('read', '{bad', true)).status, 400);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('disk failures return explicit failure without leaking filesystem details', async () => {
  const routes = new Map();
  registerNotebookRoutes({ connection: { fetch: { register: route => routes.set(route.path, route) } } }, {
    read: async () => { throw Error('EACCES C:\\private\\data'); },
  });
  const response = await routes.get(API_PATH + 'read').fetch(new Request('http://localhost' + API_PATH + 'read', { method: 'POST', body: JSON.stringify({ sessionId: 'one' }) }));
  assert.equal(response.status, 500); const value = await response.json();
  assert.equal(value.error.code, 'storage_error'); assert.equal(JSON.stringify(value).includes('private'), false);
});
