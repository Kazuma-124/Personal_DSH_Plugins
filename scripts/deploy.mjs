#!/usr/bin/env node
// Copy this repository's plugins into the current DSH profile's default
// plugin directory (<profile>/created-plugins). No machine-specific paths are
// stored in the repository; DSH_PROFILE_DIR supplies the destination.
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const profileDir = process.env.DSH_PROFILE_DIR;
if (!profileDir) {
  console.error('DSH_PROFILE_DIR is not set. Run this from a DSH session shell, or set it to the profile directory.');
  process.exit(1);
}

const createdPlugins = resolve(profileDir, 'created-plugins');
const plugins = [
  { source: 'dsh-token-usage', target: 'dsh-token-usage' },
  { source: 'conversation-notebook', target: 'e1727a2d-8dfb-4483-8fd4-2a5078b2229e', build: 'build.mjs' },
];
const skip = new Set(['node_modules', 'verification', '.git']);

for (const plugin of plugins) {
  const source = resolve(repoRoot, plugin.source);
  const target = resolve(createdPlugins, plugin.target);
  if (target === source || !target.startsWith(createdPlugins + sep)) {
    throw new Error('Refusing to write outside the profile plugin directory: ' + target);
  }
  await stat(source);

  if (plugin.build) {
    const built = spawnSync(process.execPath, [plugin.build], { cwd: source, stdio: 'inherit' });
    if (built.status !== 0) throw new Error('Build failed for ' + plugin.source);
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, target, {
    recursive: true,
    force: true,
    filter: path => !skip.has(path.split(/[\\/]/).pop()),
  });
  console.log('deployed ' + plugin.source + ' -> ' + target);
}

console.log('Done. Refresh the DSH page, or restart DSH for host-side changes.');
