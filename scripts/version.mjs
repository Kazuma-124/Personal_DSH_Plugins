#!/usr/bin/env node
/**
 * Version bookkeeping for the plugins in this repository.
 *
 * Each plugin carries one SemVer version in `package.json`, and every commit
 * that changes a plugin directory must raise that version. This script makes
 * both sides checkable:
 *
 *   node scripts/version.mjs check
 *       Fail when a plugin directory changed but its version did not, when a
 *       version is not valid SemVer, or when the current version has no
 *       CHANGELOG entry.
 *
 *   node scripts/version.mjs bump <directory> <major|minor|patch> --note <text>
 *       Raise the version and prepend a dated CHANGELOG entry describing the
 *       change.
 *
 * "Changed" compares the plugin directory against the commit that
 * `docs/index.json` publishes for it, so the comparison keeps working after a
 * release commit and does not depend on the working tree being clean.
 *
 * Versions are compared with SemVer precedence. `docs/index.json` keeps the
 * earlier version entries (each pinned to its own commit) so users can install
 * or inspect an older build.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLUGINS } from './plugins.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INDEX_FILE = resolve(REPO_ROOT, 'docs', 'index.json');
const CHANGELOG_FILE = 'CHANGELOG.md';
const CHANGELOG_HEADING = '# 版本记录';
const LEVELS = new Set(['major', 'minor', 'patch']);

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/u;

function fail(message) {
  console.error(`version: ${message}`);
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function parseVersion(version) {
  const match = SEMVER.exec(version);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/** SemVer precedence: negative, zero or positive like a comparator. */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Cannot compare non-SemVer versions: ${left}, ${right}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/u.test(x);
    const yNumeric = /^\d+$/u.test(y);
    if (xNumeric && yNumeric) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Raise a version by one SemVer level; a prerelease first becomes its release. */
export function bumpVersion(version, level) {
  const current = parseVersion(version);
  if (!current) throw new Error(`Not a SemVer version: ${version}`);
  if (!LEVELS.has(level)) throw new Error(`Unknown version level: ${level}`);
  const { major, minor, patch, prerelease } = current;
  if (prerelease.length > 0) {
    if (level === 'patch') return `${major}.${minor}.${patch}`;
    if (level === 'minor' && patch === 0) return `${major}.${minor}.0`;
    if (level === 'major' && minor === 0 && patch === 0) return `${major}.0.0`;
  }
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function changelogSection(version, note) {
  return `## ${version} — ${today()}\n\n- ${note.trim()}\n\n`;
}

/** Insert a version section before the first existing section. */
function prependChangelog(existing, section) {
  if (existing === undefined) {
    return `${CHANGELOG_HEADING}\n\n版本号遵循 SemVer；每个版本对应一次提交，` +
      '`docs/index.json` 保留各版本的固定 commit 与发布时间。\n\n' + section;
  }
  const start = existing.indexOf('\n## ');
  if (start === -1) return `${existing.trimEnd()}\n\n${section}`;
  return `${existing.slice(0, start).trimEnd()}\n\n${section}${existing.slice(start + 1)}`;
}

function hasChangelogEntry(content, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^##\\s+${escaped}(?:\\s|$)`, 'mu').test(content);
}

/** Whether a plugin directory differs from a published commit, including untracked files. */
function changedSince(commit, dir) {
  try {
    git(['cat-file', '-e', `${commit}^{commit}`]);
  } catch {
    // A shallow clone may not contain the published commit; the working tree is
    // still a useful signal, and build-index will pin the new commit anyway.
    return git(['status', '--porcelain', '--', dir]) !== '';
  }
  const diff = git(['diff', '--name-only', commit, '--', dir]);
  const status = git(['status', '--porcelain', '--', dir]);
  return diff !== '' || status !== '';
}

/** The highest published version entry for a plugin, or undefined. */
function latestEntry(entries) {
  return entries.reduce((best, entry) => (
    best === undefined || compareVersions(entry.version, best.version) > 0 ? entry : best
  ), undefined);
}

async function publishedVersions() {
  if (!existsSync(INDEX_FILE)) return new Map();
  const index = await readJson(INDEX_FILE);
  return new Map((index.plugins ?? []).map(plugin => [plugin.name, plugin]));
}

/**
 * Collect every problem that would make a release's version misleading.
 * Empty array means the current tree is consistent.
 */
export async function versionProblems() {
  const problems = [];
  const published = await publishedVersions();

  for (const { dir } of PLUGINS) {
    const root = resolve(REPO_ROOT, dir);
    const pkg = await readJson(resolve(root, 'package.json'));
    if (typeof pkg.version !== 'string' || !parseVersion(pkg.version)) {
      problems.push(`${dir}: package.json version "${pkg.version}" is not valid SemVer`);
      continue;
    }

    const changelogPath = resolve(root, CHANGELOG_FILE);
    if (!existsSync(changelogPath)) {
      problems.push(`${dir}: missing ${CHANGELOG_FILE}; add one with a section for ${pkg.version}`);
    } else {
      const changelog = await readFile(changelogPath, 'utf8');
      if (!hasChangelogEntry(changelog, pkg.version)) {
        problems.push(`${dir}: ${CHANGELOG_FILE} has no "## ${pkg.version}" section`);
      }
    }

    const previous = published.get(pkg.name);
    if (previous === undefined) continue;
    const latest = latestEntry(previous.versions ?? []);
    if (latest === undefined) continue;

    const order = compareVersions(pkg.version, latest.version);
    if (order < 0) {
      problems.push(`${dir}: version ${pkg.version} is lower than the published ${latest.version}`);
      continue;
    }
    if (order > 0) continue;

    if (changedSince(latest.source.commit, dir)) {
      problems.push(
        `${dir}: content changed since ${latest.version} (${latest.source.commit.slice(0, 7)}) ` +
        `but the version is still ${pkg.version}; run \`node scripts/version.mjs bump ${dir} patch --note "..."\``,
      );
    }
  }

  return problems;
}

/** Throwing wrapper used by build-index before it writes a release index. */
export async function assertVersions() {
  const problems = await versionProblems();
  if (problems.length === 0) return;
  fail(`refusing to publish inconsistent versions:\n${problems.map(problem => `  - ${problem}`).join('\n')}`);
}

async function check() {
  const problems = await versionProblems();
  if (problems.length > 0) {
    fail(`version check failed:\n${problems.map(problem => `  - ${problem}`).join('\n')}`);
  }
  for (const { dir } of PLUGINS) {
    const pkg = await readJson(resolve(REPO_ROOT, dir, 'package.json'));
    console.log(`version: ${dir} ${pkg.version} ok`);
  }
}

async function bump(args) {
  const [dir, level, ...rest] = args;
  if (!dir || !level) fail('usage: node scripts/version.mjs bump <directory> <major|minor|patch> --note <text>');
  if (!LEVELS.has(level)) fail(`unknown level "${level}"; use major, minor or patch`);
  if (!PLUGINS.some(plugin => plugin.dir === dir)) fail(`unknown plugin directory "${dir}"`);

  const noteIndex = rest.indexOf('--note');
  const note = noteIndex === -1 ? '' : rest.slice(noteIndex + 1).join(' ').trim();
  if (note === '') fail('--note is required: it becomes the CHANGELOG entry');

  const root = resolve(REPO_ROOT, dir);
  const packagePath = resolve(root, 'package.json');
  const pkg = await readJson(packagePath);
  const previous = pkg.version;
  const next = bumpVersion(previous, level);
  pkg.version = next;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  const changelogPath = resolve(root, CHANGELOG_FILE);
  const existing = existsSync(changelogPath) ? await readFile(changelogPath, 'utf8') : undefined;
  await writeFile(changelogPath, prependChangelog(existing, changelogSection(next, note)));

  console.log(`version: ${dir} ${previous} -> ${next}`);
  console.log(`version: updated ${dir}/package.json and ${dir}/${CHANGELOG_FILE}`);
  console.log('version: next steps: run tests, commit the plugin directory, then `node scripts/build-index.mjs`');
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'check') return check();
  if (command === 'bump') return bump(rest);
  if (command === undefined || command === '--help' || command === '-h') {
    console.log('Usage: node scripts/version.mjs <check | bump <directory> <major|minor|patch> --note <text>>');
    return;
  }
  fail(`unknown command "${command}"`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
