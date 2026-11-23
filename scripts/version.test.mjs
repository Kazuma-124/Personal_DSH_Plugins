import assert from 'node:assert/strict';
import test from 'node:test';
import { bumpVersion, compareVersions } from './version.mjs';

test('SemVer precedence orders release, prerelease and numeric identifiers', () => {
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
  assert.ok(compareVersions('2.0.0', '1.9.9') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.0') === 0);
  assert.ok(compareVersions('1.0.0-alpha', '1.0.0') < 0);
  assert.ok(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10') < 0);
  assert.ok(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta') < 0);
});

test('bumping raises one level and releases a prerelease first', () => {
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(bumpVersion('1.2.3-rc.1', 'patch'), '1.2.3');
  assert.equal(bumpVersion('1.2.0-rc.1', 'minor'), '1.2.0');
  assert.equal(bumpVersion('1.0.0-rc.1', 'major'), '1.0.0');
});

test('invalid versions and levels are rejected', () => {
  assert.throws(() => compareVersions('1.0', '1.0.0'), /SemVer/u);
  assert.throws(() => bumpVersion('v1.0.0', 'patch'), /SemVer/u);
  assert.throws(() => bumpVersion('1.0.0', 'release'), /level/u);
});
