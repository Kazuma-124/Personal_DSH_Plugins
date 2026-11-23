import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { API_PATH, apply, resolvePackageDirectory } from '../index.js';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function makeProfile(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tweaks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = join(root, 'profile');
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'test-profile' }), 'utf8');
  return profile;
}

function useProfile(t, profile) {
  const previous = process.env.DSH_PROFILE_DIR;
  process.env.DSH_PROFILE_DIR = profile;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR;
    else process.env.DSH_PROFILE_DIR = previous;
  });
}

function registerRoute() {
  let route;
  apply({ connection: { fetch: { register(value) { route = value; } } } });
  return route;
}

test('resolves installed packages and rejects unsafe names', async t => {
  const profile = await makeProfile(t);
  useProfile(t, profile);
  const installed = join(profile, 'node_modules', '@scope', 'demo');
  await mkdir(installed, { recursive: true });
  await writeFile(join(installed, 'package.json'), JSON.stringify({ name: '@scope/demo' }), 'utf8');

  assert.equal(resolvePackageDirectory('@scope/demo'), realpathSync.native(installed));
  assert.equal(resolvePackageDirectory('@scope/missing'), null);
  assert.equal(resolvePackageDirectory('../../etc/passwd'), null);
  assert.equal(resolvePackageDirectory('not a name'), null);
  assert.equal(resolvePackageDirectory(42), null);
});

test('registers a streaming reveal route', () => {
  const route = registerRoute();
  assert.ok(route);
  assert.equal(route.path, API_PATH + 'reveal');
  assert.deepEqual(route.methods, ['POST']);
  assert.equal(route.requestBody, 'streaming');
  assert.equal(typeof route.fetch, 'function');
});

test('rejects invalid requests before opening anything', async t => {
  const profile = await makeProfile(t);
  useProfile(t, profile);
  const route = registerRoute();

  const invalid = await route.fetch(new Request('http://127.0.0.1/api/tweaks/reveal', {
    method: 'POST',
    body: JSON.stringify({ packageName: 42 }),
  }));
  assert.equal(invalid.status, 400);

  const missing = await route.fetch(new Request('http://127.0.0.1/api/tweaks/reveal', {
    method: 'POST',
    body: JSON.stringify({ packageName: '@scope/missing' }),
  }));
  assert.equal(missing.status, 404);
});

test('package metadata and assets stay consistent', async () => {
  const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@kazuma-124/dsh-tweaks');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.ok(pkg.engines.dsh);
  assert.equal(pkg.license, 'MIT');

  const patch = JSON.parse(await readFile(join(packageDir, pkg.dsh.bundle.patch), 'utf8'));
  assert.equal(patch[0].insert[0].name, pkg.name);
  assert.equal(patch[0].insert[0].id, pkg.name + ':tweaks');

  const client = await readFile(join(packageDir, 'client.js'), 'utf8');
  assert.ok(client.includes(`id: '${pkg.name}'`));
  assert.ok(client.includes("'plugins.detail.actions'"));
  assert.ok(client.includes("'/api/tweaks/reveal'"));

  for (const lang of ['en', 'zh']) {
    const locale = JSON.parse(await readFile(join(packageDir, 'locale', `${lang}.json`), 'utf8'));
    assert.ok(locale.meta.title);
    assert.ok(locale.meta.description);
  }

  const icon = await stat(join(packageDir, 'icon.svg'));
  assert.ok(icon.size > 0 && icon.size <= 256 * 1024);
});
