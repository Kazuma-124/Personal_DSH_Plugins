#!/usr/bin/env node
/**
 * Generate `site/index.json` — a DSH plugin market index (format 1) — from the
 * plugin packages in this repository.
 *
 * The index is the machine-readable entry point for DSH's Discover tab, the
 * `plugin_market` tool, community catalogs and crawlers. Every field that DSH
 * reads is taken from the package itself, so this script cannot drift from the
 * published packages:
 *
 *   - name, version, engines.dsh, homepage, repository.directory → package.json
 *   - title, description (en + zh) → locale/<lang>.json `meta`
 *   - icon → icon.svg next to the package
 *
 * Usage:
 *   node scripts/build-index.mjs                 # write site/index.json (pinned git commit, the default)
 *   node scripts/build-index.mjs --source npm    # list npm versions instead, once they are published
 *   node scripts/build-index.mjs --check         # verify the committed file is current
 *   node scripts/build-index.mjs --allow-dirty   # generate before committing (the pin then lags the code)
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

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE_DIR = resolve(REPO_ROOT, 'site');
const INDEX_FILE = resolve(SITE_DIR, 'index.json');
const REPOSITORY_URL = 'https://github.com/Kazuma-124/Personal_DSH_Plugins';
const DEFAULT_PUBLIC_BASE = 'https://cdn.jsdelivr.net/gh/Kazuma-124/Personal_DSH_Plugins@main/site/';
const ICON_MAX_BYTES = 256 * 1024;
const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);

/** Plugins listed in the index, in display order. Everything else comes from the package. */
const PLUGINS = [
  { dir: 'dsh-token-usage', category: 'usage' },
  { dir: 'conversation-notebook', category: 'ui' },
];

/** Market-level declarations. Category ids used by PLUGINS must be declared here. */
const INDEX_METADATA = {
  categories: {
    usage: { title: { en: 'Usage statistics', zh: '用量统计' } },
    ui: { title: { en: 'Interface', zh: '界面' } },
  },
  labels: {},
  sortKeys: {},
};

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const SOURCE = argument('source', 'git');
const PUBLIC_BASE = argument('base', process.env.INDEX_PUBLIC_BASE ?? DEFAULT_PUBLIC_BASE);
const CHECK_ONLY = process.argv.includes('--check');
const STRICT = process.argv.includes('--strict');
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

/** The repository's current commit, used by `--source git`. */
function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    fail('--source git needs a git checkout to read HEAD from');
  }
}

/** Commit time of a package directory, in Unix seconds; the stable fallback for an unpublished version. */
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

/** Publish time of one exact version, in Unix seconds. */
async function publishTimestamp(pkg, dir) {
  const override = argument('published-at', undefined);
  if (override !== undefined) return Number(override);
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name).replace(/%40/g, '@')}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const document = await response.json();
    const published = document?.time?.[pkg.version];
    if (typeof published !== 'string') throw new Error(`${pkg.name}@${pkg.version} is not published yet`);
    return Math.floor(Date.parse(published) / 1000);
  } catch (error) {
    if (STRICT) fail(`cannot read ${pkg.name}@${pkg.version} from the npm registry: ${error.message}`);
    // Stay deterministic before the first publish, so `--check` is meaningful in CI.
    const committed = gitDirectoryTime(dir);
    if (committed === undefined) fail(`${pkg.name}@${pkg.version} is unpublished and ${dir} has no commit time; pass --published-at`);
    console.warn(`build-index: warn: ${pkg.name}@${pkg.version} is not on npm (${error.message}); using the last commit time of ${dir}`);
    return committed;
  }
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

async function pluginEntry({ dir, category }) {
  const root = resolve(REPO_ROOT, dir);
  const pkg = await readJson(resolve(root, 'package.json'));

  if (!pkg.dsh?.bundle?.patch) fail(`${pkg.name} does not declare dsh.bundle.patch, so DSH will not activate it`);
  if (!existsSync(resolve(root, pkg.dsh.bundle.patch))) fail(`${pkg.name} declares a patch that does not exist`);
  if (typeof pkg.engines?.dsh !== 'string') {
    fail(`${pkg.name} needs engines.dsh; without it DSH cannot tell users which runtime versions it runs on`);
  }
  if (SOURCE === 'npm' && pkg.private === true) fail(`${pkg.name} is private and cannot be published to npm`);

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
  const source = SOURCE === 'git'
    ? { type: 'git', url: REPOSITORY_URL, commit: gitHead(), path: dir }
    : { type: 'npm' };

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
    versions: [{
      version: pkg.version,
      publishTimestamp: await publishTimestamp(pkg, dir),
      source,
      engines: { dsh: pkg.engines.dsh },
    }],
  };
}

async function main() {
  if (SOURCE !== 'npm' && SOURCE !== 'git') fail('--source must be npm or git');

  if (SOURCE === 'git' && !ALLOW_DIRTY) assertPluginsCommitted();

  const built = [];
  for (const spec of PLUGINS) built.push(await pluginEntry(spec));

  const document = {
    format: 1,
    title: { en: "Kazuma's DSH plugins", zh: 'Kazuma 的 DSH 插件' },
    description: {
      en: 'Bundles for DeepSeek Harness: token usage statistics and a per-conversation notebook. Read-only, no model calls.',
      zh: 'DeepSeek Harness 组合包：Token 用量统计与对话记事本。只读、不调用模型。',
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
    if (previous !== json) fail('site/index.json is out of date; run `npm run index`');
    console.log('build-index: site/index.json is up to date');
    return;
  }

  await mkdir(SITE_DIR, { recursive: true });
  await writeFile(INDEX_FILE, json);
  const names = built.map(plugin => `${plugin.name}@${plugin.versions[0].version}`).join(', ');
  console.log(`build-index: wrote ${INDEX_FILE}`);
  console.log(`build-index: ${built.length} plugin(s) with ${SOURCE} sources: ${names}`);
  console.log(`build-index: index URL for DSH Discover: ${PUBLIC_BASE}index.json`);
}

await main();
