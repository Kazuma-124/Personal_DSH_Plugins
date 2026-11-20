import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from './index.mjs';

test('host routes use lifecycle cleanup, local GET access, and serve JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-token-host-'));
  try {
    const routes = [], effects = [];
    apply({ effect(fn) { effects.push(fn()); }, webServer: { register(route) { routes.push(route); return () => {}; } } }, { dataDir: dir });
    assert.deepEqual(routes.map(r => r.path), ['/token-usage', '/api/token-usage']);
    assert.ok(effects.every(fn => typeof fn === 'function'));
    async function request(path, changes = {}) {
      const result = {};
      const req = { method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:8080' }, ...changes };
      const res = { writeHead(status, headers) { result.status = status; result.headers = headers; }, end(body) { result.body = body; } };
      await routes.find(r => r.path === path).handler(req, res);
      return result;
    }
    const json = await request('/api/token-usage');
    assert.equal(json.status, 200);
    assert.ok(Array.isArray(JSON.parse(json.body).events));
    assert.equal((await request('/api/token-usage', { method: 'POST' })).status, 405);
    assert.equal((await request('/api/token-usage', { socket: { remoteAddress: '10.0.0.2' } })).status, 403);
    assert.equal((await request('/api/token-usage', { headers: { host: '127.0.0.1:8080', origin: 'https://unrelated.invalid' } })).status, 403);
    const page = await request('/token-usage');
    assert.equal(page.status, 200);
    assert.match(page.body, /Token|token/);
    assert.equal((await request('/token-usage', { method: 'HEAD' })).body, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('client registers a reversible main panel and sidebar entry', async () => {
  let plugin;
  vm.runInNewContext(await readFile(new URL('./client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(row) { plugin = row.factory(() => ({ createElement() {} })); } } } });
  const registrations = [], cleanups = [];
  plugin.apply({ effect(fn) { cleanups.push(fn()); }, slots: { inject(name, fn) { return fn(); }, register(spec) { registrations.push(spec); return () => {}; } } });
  assert.equal(registrations[0].key, 'token-usage');
  assert.equal(registrations[1].label(), 'Token 用量');
  assert.ok(cleanups.every(fn => typeof fn === 'function'));
});
