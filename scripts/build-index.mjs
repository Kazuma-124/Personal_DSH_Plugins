#!/usr/bin/env node
/**
 * Generate `docs/index.json` — a DSH plugin market index (format 1) — from the
 * plugin directories in this repository.
 *
 * The index is the machine-readable entry point for DSH's Discover tab, the
 * `plugin_market` tool, community catalogs and crawlers. Every field that DSH
 * reads is taken from the plugin directory, so the index cannot drift from the
 * code it points at:
 *
 *   - name, version, engines.dsh, homepage, repository.directory → package.json
 *   - title, description (en + zh) → locale/<lang>.json `meta`
 *   - icon → icon.svg next to the package
 *
 * Usage:
 *   node scripts/build-index.mjs                 # write docs/index.json for the current commit
 *   node scripts/build-index.mjs --check         # verify the committed file is current
 *   node scripts/build-index.mjs --allow-dirty   # generate before committing (the pin then lags the code)
 *   node scripts/build-index.mjs --base <url>    # override the public base URL
 *
 * A git source installs a pinned commit of this repository, so the plugin
 * directories must be committed first: the index is regenerated after every
 * release commit that changes a plugin.
 *
 * Requires `@deepseek-ai/dsh-plugin-market-index` (devDependency) so the output
 * is validated by DSH's own rules before it is written.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_METADATA, PLUGINS } from './plugins.mjs';
import { assertVersions, compareVersions } from './version.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE_DIR = resolve(REPO_ROOT, 'docs');
const INDEX_FILE = resolve(SITE_DIR, 'index.json');
const REPOSITORY_URL = 'https://github.com/Kazuma-124/Personal_DSH_Plugins';
const DEFAULT_PUBLIC_BASE = 'https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/docs/';
const ICON_MAX_BYTES = 256 * 1024;
const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);
const MAX_LISTED_VERSIONS = 100;

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const PUBLIC_BASE = argument('base', process.env.INDEX_PUBLIC_BASE ?? DEFAULT_PUBLIC_BASE);
const CHECK_ONLY = process.argv.includes('--check');
const ALLOW_DIRTY = process.argv.includes('--allow-dirty');

function fail(message) {
  console.error(`build-index: ${message}`);
  process.exit(1);
}

/**
 * Refuse a git pin that would not contain the code it describes: a committed
 * index installs HEAD, so uncommitted plugin changes make it lie.
 */
function assertPluginsCommitted() {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...PLUGINS.map(spec => spec.dir)], {
    cwd: REPO_ROOT, encoding: 'utf8',
  }).trim();
  if (dirty === '') return;
  fail(`uncommitted changes in a plugin directory:\n${dirty}\nCommit them first, then regenerate, so the pinned commit contains them (or pass --allow-dirty).`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/** The commit that last changed a plugin directory: the code this version carries. */
function gitDirectoryCommit(dir) {
  try {
    const commit = execFileSync('git', ['log', '-1', '--format=%H', '--', dir], {
      cwd: REPO_ROOT, encoding: 'utf8',
    }).trim();
    return commit === '' ? undefined : commit;
  } catch {
    return undefined;
  }
}

/** Commit time of a package directory, in Unix seconds. */
function gitDirectoryTime(dir) {
  try {
    const seconds = Number(execFileSync('git', ['log', '-1', '--format=%ct', '--', dir], {
      cwd: REPO_ROOT, encoding: 'utf8',
    }).trim());
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
  } catch {
    return undefined;
  }
}

/** The index publish timestamp: the commit that carries the package. */
function commitTimestamp(dir) {
  const seconds = gitDirectoryTime(dir);
  if (seconds === undefined) fail(`${dir} has no commit time; commit the package first`);
  return seconds;
}

/** The commit pinned for the current version of one plugin. */
function pluginCommit(dir) {
  const commit = gitDirectoryCommit(dir);
  if (commit === undefined) fail(`${dir} has no commit; commit the package first`);
  return commit;
}

/** Localized display text for one package, from its locale files. */
async function localizedMeta(dir) {
  const read = async (language) => {
    const file = resolve(dir, 'locale', `${language}.json`);
    if (!existsSync(file)) fail(`${dir} has no locale/${language}.json`);
    const { meta } = await readJson(file);
    if (typeof meta?.title !== 'string' || typeof meta.description !== 'string') {
      fail(`${dir} locale/${language}.json needs meta.title and meta.description`);
    }
    return { title: meta.title, description: meta.description };
  };
  return { en: await read('en'), zh: await read('zh') };
}

/** Version entries currently published in docs/index.json, keyed by package name. */
async function publishedVersions() {
  if (!existsSync(INDEX_FILE)) return new Map();
  const document = await readJson(INDEX_FILE);
  return new Map((document.plugins ?? []).map(plugin => [plugin.name, plugin.versions ?? []]));
}

async function pluginEntry({ dir, category }, published) {
  const root = resolve(REPO_ROOT, dir);
  const pkg = await readJson(resolve(root, 'package.json'));

  if (!pkg.dsh?.bundle?.patch) fail(`${pkg.name} does not declare dsh.bundle.patch, so DSH will not activate it`);
  if (!existsSync(resolve(root, pkg.dsh.bundle.patch))) fail(`${pkg.name} declares a patch that does not exist`);
  if (typeof pkg.engines?.dsh !== 'string') {
    fail(`${pkg.name} needs engines.dsh; without it DSH cannot tell users which runtime versions it runs on`);
  }

  const meta = await localizedMeta(root);

  const iconFile = resolve(root, pkg.icon ?? 'icon.svg');
  if (!existsSync(iconFile)) fail(`${pkg.name} has no icon file at ${iconFile}`);
  if (!ICON_EXTENSIONS.has(extname(iconFile).toLowerCase())) fail(`${pkg.name} icon must be SVG, PNG, JPEG or WebP`);
  if ((await stat(iconFile)).size > ICON_MAX_BYTES) fail(`${pkg.name} icon exceeds 256 KiB`);
  const iconRelative = `icons/${dir}${extname(iconFile).toLowerCase()}`;
  if (!CHECK_ONLY) {
    await mkdir(resolve(SITE_DIR, 'icons'), { recursive: true });
    await copyFile(iconFile, resolve(SITE_DIR, iconRelative));
  }

  const homepage = typeof pkg.homepage === 'string' ? pkg.homepage.replace(/#readme$/u, '') : REPOSITORY_URL;

  const current = {
    version: pkg.version,
    publishTimestamp: commitTimestamp(dir),
    source: { type: 'git', url: REPOSITORY_URL, commit: pluginCommit(dir), path: dir },
    engines: { dsh: pkg.engines.dsh },
  };
  // Keep earlier versions so users can see what changed, install an older build,
  // and compare a local copy against the published history.
  const older = (published.get(pkg.name) ?? [])
    .filter(entry => typeof entry?.version === 'string' && compareVersions(entry.version, pkg.version) < 0)
    .map(entry => ({
      version: entry.version,
      publishTimestamp: entry.publishTimestamp,
      source: entry.source,
      engines: entry.engines ?? {},
    }));
  const versions = [current, ...older]
    .sort((left, right) => compareVersions(right.version, left.version))
    .slice(0, MAX_LISTED_VERSIONS);

  return {
    name: pkg.name,
    title: { en: meta.en.title, zh: meta.zh.title },
    description: { en: meta.en.description, zh: meta.zh.description },
    icon: iconRelative,
    author: pkg.author?.name ?? pkg.author,
    homepage,
    repository: { url: REPOSITORY_URL, directory: dir },
    metadata: {
      category,
      keywords: Array.isArray(pkg.keywords) ? pkg.keywords.filter(word => typeof word === 'string') : [],
      labels: [],
    },
    versions,
  };
}

async function main() {
  if (!ALLOW_DIRTY) assertPluginsCommitted();
  await assertVersions();

  const published = await publishedVersions();
  const built = [];
  for (const spec of PLUGINS) built.push(await pluginEntry(spec, published));

  const document = {
    format: 1,
    title: { en: "Kazuma's DSH plugins", zh: 'Kazuma 的 DSH 插件' },
    description: {
      en: 'Bundles for DeepSeek Harness: token usage statistics, a per-conversation notebook, plugin-manager actions and workspace session migration.',
      zh: 'DeepSeek Harness 组合包：Token 用量统计、对话记事本、插件操作与会话迁移。',
    },
    metadata: INDEX_METADATA,
    plugins: built,
  };

  // Validate with DSH's own rules before writing: a rejected index fails silently in the UI.
  const { parseMarketIndex } = await import('@deepseek-ai/dsh-plugin-market-index');
  try {
    parseMarketIndex(document, `${PUBLIC_BASE}index.json`);
  } catch (error) {
    fail(`the generated index is invalid at ${error.path}: ${error.reason ?? error.message}`);
  }

  const json = `${JSON.stringify(document, null, 2)}\n`;
  const previous = existsSync(INDEX_FILE) ? await readFile(INDEX_FILE, 'utf8') : undefined;

  if (CHECK_ONLY) {
    if (previous !== json) fail('docs/index.json is out of date; run `node scripts/build-index.mjs`');
    console.log('build-index: docs/index.json is up to date');
    return;
  }

  await mkdir(SITE_DIR, { recursive: true });
  await writeFile(INDEX_FILE, json);
  const names = built.map(plugin => `${plugin.name}@${plugin.versions[0].version}`).join(', ');
  console.log(`build-index: wrote ${INDEX_FILE}`);
  console.log(`build-index: ${built.length} plugin(s): ${names}`);
  console.log(`build-index: index URL for DSH Discover: ${PUBLIC_BASE}index.json`);
}

await main();
