#!/usr/bin/env node
// Copy this repository's plugins into the current DSH profile's default
// plugin directory (<profile>/created-plugins). No machine-specific paths are
// stored in the repository; DSH_PROFILE_DIR supplies the destination.
//
// Plugins are independent install units. Pass --only to update exactly one
// plugin, or --all to deploy every plugin explicitly; there is no implicit
// all-plugin mode.
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const plugins = [
  { source: 'dsh-token-usage', target: 'dsh-token-usage' },
  { source: 'conversation-notebook', target: 'e1727a2d-8dfb-4483-8fd4-2a5078b2229e', build: 'build.mjs' },
  { source: 'dsh-plugin-actions', target: 'dsh-plugin-actions' },
  { source: 'workspace-session-migration', target: 'workspace-session-migration' },
];
const skip = new Set(['node_modules', 'verification', '.git']);

function usage() {
  console.error('Usage: node scripts/deploy.mjs (--only <plugin>... | --all) [--list]');
}

const args = process.argv.slice(2);
const only = [];
let all = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--only') {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      console.error('--only requires a plugin directory name, for example: --only dsh-token-usage');
      process.exit(1);
    }
    only.push(value);
    index += 1;
  } else if (arg === '--all') {
    all = true;
  } else if (arg === '--list') {
    for (const plugin of plugins) console.log(`${plugin.source} -> ${plugin.target}`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    usage();
    process.exit(1);
  }
}

if (all && only.length > 0) {
  console.error('--all and --only cannot be combined.');
  usage();
  process.exit(1);
}
if (!all && only.length === 0) {
  console.error('Refusing to deploy every plugin implicitly.');
  usage();
  process.exit(1);
}

if (only.length > 0) {
  const known = new Set(plugins.flatMap(plugin => [plugin.source, plugin.target]));
  const unknown = only.filter(name => !known.has(name));
  if (unknown.length > 0) {
    console.error(`Unknown plugin(s): ${unknown.join(', ')}`);
    console.error(`Known: ${plugins.map(plugin => plugin.source).join(', ')}`);
    process.exit(1);
  }
}

const profileDir = process.env.DSH_PROFILE_DIR;
if (!profileDir) {
  console.error('DSH_PROFILE_DIR is not set. Run this from a DSH session shell, or set it to the profile directory.');
  process.exit(1);
}

const createdPlugins = resolve(profileDir, 'created-plugins');
const selected = all
  ? plugins
  : plugins.filter(plugin => only.includes(plugin.source) || only.includes(plugin.target));

for (const plugin of selected) {
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
