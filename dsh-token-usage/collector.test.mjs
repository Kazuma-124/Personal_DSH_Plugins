import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as zlib from 'node:zlib';
import { createCollector } from './collector.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-usage-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'storages'), { recursive: true });
  const registry = async records => writeFile(path.join(root, 'storages', 'workspace.json'), JSON.stringify({ global: { workspaceIds: Object.keys(records) }, tables: { workspaces: records } }));
  async function log(id, events, meta = {}, filename = 'session.v4.jsonl', compressed = false) {
    const dir = path.join(root, 'sessions', 'project', id);
    await mkdir(dir, { recursive: true });
    const text = [JSON.stringify({ type: 'session', id, version: 4, createdAt: 1, isSeeded: false, cwd: 'D:/projects', delegationDepth: 0, ...meta }), ...events.map(e => JSON.stringify(e))].join('\n') + '\n';
    await writeFile(path.join(dir, filename), compressed ? zlib.zstdCompressSync(text) : text);
    return dir;
  }
  return { root, registry, log, collector: createCollector({ dataDir: root }) };
}
const usage = (input = 10, output = 5) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 7, cacheWriteTokens: 3, totalTokens: 25, reasoningTokens: 2 });
const msg = (seq, value = usage(), turn = 0, step = 0, time = 1000) => ({ type: 'assistant/message', seq, time, data: { turn, step, usage: value } });
const marker = seq => ({ type: 'session/end-seed', seq, time: 1000, data: { inherited: true } });

test('four disjoint buckets, same-step replacement, retry barriers and refresh snapshots', async t => {
  const f = await fixture(t);
  await f.registry({ p: { title: 'Project', path: 'D:/projects', sessionIds: ['s'] } });
  await f.log('s', [msg(0), msg(1, usage(20)), { type: 'llm/retry-started', seq: 2, time: 1000, data: { turn: 0, step: 0 } }, { type: 'assistant/attempt', seq: 3, time: 2000, data: { turn: 0, step: 0, stream: [{ type: 'chunk', time: 1500, chunk: { type: 'usage', usage: usage(1, 2) } }, { type: 'chunk', time: 2000, chunk: { type: 'usage', usage: usage(4, 6) } }] } }]);
  const first = await f.collector.collect();
  assert.equal(first.events.length, 2);
  assert.equal(first.events.reduce((sum, e) => sum + e.total, 0), 55);
  assert.deepEqual(first.events.map(e => [e.input, e.output, e.cacheRead, e.cacheWrite]), [[20, 5, 7, 3], [4, 6, 7, 3]]);
  assert.deepEqual((await f.collector.collect()).events, first.events);
  const concurrent = await Promise.all([f.collector.collect(), f.collector.collect()]);
  assert.equal(concurrent[0], concurrent[1]);
  await f.log('s', [msg(0, usage(30))]);
  assert.equal((await f.collector.collect()).events[0].input, 30);
});

test('fork excludes full nested inherited prefix; subagents attribute new spend to root; ordinary fork remains separate', async t => {
  const f = await fixture(t);
  await f.registry({ old: { title: 'Old', path: 'D:/projects', sessionIds: [] }, moved: { title: 'Moved', path: 'D:/elsewhere', sessionIds: ['root'] } });
  await f.log('root', [msg(0)]);
  await f.log('child', [msg(0), marker(1), msg(2, usage(99)), marker(3), msg(4, usage(2), 2)], { isSeeded: true, origin: 'subagent', parentSession: 'root', delegationDepth: 1 });
  await f.log('fork', [msg(0), marker(1), msg(2, usage(3), 1)], { isSeeded: true, parentSession: 'root' });
  const data = await f.collector.collect();
  assert.equal(data.events.length, 3);
  const child = data.events.find(e => e.id === 'child:4');
  assert.equal(child.sessionId, 'root');
  assert.equal(child.projectId, 'moved');
  assert.equal(data.events.find(e => e.id === 'fork:2').sessionId, 'fork');
  assert.equal(data.events.reduce((sum, e) => sum + e.input, 0), 15);
});

test('missing timestamp retained without invented date; malformed usage and unsafe fork omitted', async t => {
  const f = await fixture(t);
  const missing = msg(0); delete missing.time;
  await f.log('s', [missing, msg(1, usage(-1), 1)]);
  await f.log('unsafe', [msg(0)], { isSeeded: true });
  const data = await f.collector.collect();
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].timestamp, null);
  assert.ok(data.warnings.some(w => w.includes('timestamp')));
  assert.ok(data.warnings.some(w => w.includes('inherited boundary')));
  assert.ok(data.warnings.some(w => w.includes('invalid token usage')));
});

test('latest generation only, duplicate sequence rejected, corrupt tail and compressed concatenated frames', async t => {
  const f = await fixture(t);
  await f.log('s', [msg(0, usage(99))], {}, 'session.v3.jsonl');
  await f.log('s', [msg(0), msg(0), msg(1, usage(2), 1)], {}, 'session.v4.jsonl.zstd', true);
  const dir = path.join(f.root, 'sessions', 'project', 's');
  const file = path.join(dir, 'session.v4.jsonl.zstd');
  const { readFile } = await import('node:fs/promises');
  const original = await readFile(file);
  const complete = zlib.zstdCompressSync(JSON.stringify(msg(2, usage(3), 2)) + '\n');
  const torn = zlib.zstdCompressSync(JSON.stringify(msg(3, usage(100), 3)) + '\n');
  await writeFile(file, Buffer.concat([original, complete, torn.subarray(0, Math.floor(torn.length / 2))]));
  const data = await f.collector.collect();
  assert.equal(data.events.length, 3);
  assert.equal(data.events.reduce((sum, e) => sum + e.input, 0), 15);
  assert.ok(data.warnings.some(w => w.includes('duplicate/out-of-order')));
  assert.ok(data.warnings.some(w => w.includes('incomplete Zstandard')));
});

test('project nearest ancestor uses Windows case-insensitive path boundaries and explicit parents', async t => {
  const f = await fixture(t);
  await f.registry({ p: { title: 'Projects', path: 'D:/projects', sessionIds: [] }, c: { title: 'Learning', path: 'd:\\PROJECTS\\Learning\\', sessionIds: [] }, g: { title: 'Sub', path: 'D:/projects/Learning/sub', sessionIds: [] }, sibling: { title: 'Other', path: 'D:/projects-other', sessionIds: [] }, same: { title: 'Same', path: 'd:/PROJECTS/', sessionIds: [] }, explicit: { title: 'Explicit', path: 'D:/outside', parentId: 'c', sessionIds: [] } });
  const data = await f.collector.collect();
  const parent = id => data.projects.find(p => p.id === id).parentId;
  assert.ok(['p', 'same'].includes(parent('c')));
  assert.equal(parent('g'), 'c');
  assert.equal(parent('sibling'), null);
  assert.equal(parent('p'), null);
  assert.equal(parent('same'), null);
  assert.equal(parent('explicit'), 'c');
});
