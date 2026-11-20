import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';

// Read only: never opens credentials, projections, search indexes, or application settings.
// Node >=22.15 with native Zstandard is required for compressed session logs.
const canonical = value => typeof value === 'string' ? value.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase() : '';
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const logName = /^session(?:\.v([1-9][0-9]*))?\.jsonl(\.zstd)?$/;

// DSH writes independently checksummed, concatenated frames. Never decode an
// incomplete final frame: its uncommitted plaintext must not become usage.
function completeZstdPrefix(bytes) {
  let offset = 0;
  let committed = 0;
  const frames = [];
  while (offset < bytes.length) {
    const start = offset;
    if (bytes.length - offset < 4) break;
    if (bytes.readUInt32LE(offset) !== 0xfd2fb528) throw new Error('invalid Zstandard frame');
    offset += 4;
    if (offset === bytes.length) break;
    const descriptor = bytes[offset++];
    if (descriptor & 0x18) throw new Error('reserved Zstandard frame bits');
    const single = (descriptor & 0x20) !== 0;
    const dictionary = descriptor & 3;
    const flag = descriptor >>> 6;
    const extra = (single ? 0 : 1) + (dictionary === 3 ? 4 : dictionary) + (flag === 0 ? (single ? 1 : 0) : 1 << flag);
    if (bytes.length - offset < extra) break;
    offset += extra;
    let incomplete = false;
    for (;;) {
      if (bytes.length - offset < 3) { incomplete = true; break; }
      const block = bytes.readUIntLE(offset, 3);
      offset += 3;
      const type = (block >>> 1) & 3;
      if (type === 3) throw new Error('reserved Zstandard block type');
      const size = type === 1 ? 1 : block >>> 3;
      if (bytes.length - offset < size) { incomplete = true; break; }
      offset += size;
      if (block & 1) break;
    }
    if (incomplete) break;
    if (descriptor & 4) {
      if (bytes.length - offset < 4) break;
      offset += 4;
    }
    committed = offset;
    frames.push({ start, end: offset });
  }
  return { end: committed, frames };
}

function usageOf(event) {
  if (event.type === 'assistant/message' && event.data?.usage) return event.data.usage;
  const stream = event.data?.stream;
  if (!Array.isArray(stream)) return undefined;
  for (let i = stream.length - 1; i >= 0; i--) {
    const chunk = stream[i]?.chunk;
    if (chunk?.type === 'usage') return chunk.usage;
  }
}

function parseLog(text, label, initialWarnings = []) {
  const warnings = [...initialWarnings];
  const lines = text.split('\n');
  if (!lines.at(-1)?.trim()) lines.pop();
  let header;
  try { header = JSON.parse(lines.shift() ?? ''); } catch { throw new Error('invalid session header'); }
  if (header.type !== 'session' || typeof header.id !== 'string') throw new Error('invalid session identity');
  if (![2, 3, 4].includes(header.version)) throw new Error('unsupported session format ' + header.version + '; migrate through DSH before collecting');
  const events = [];
  let previous = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let event;
    try { event = JSON.parse(lines[i]); } catch {
      warnings.push(label + ': incomplete or malformed JSONL row; remaining tail excluded');
      break;
    }
    if (!validCount(event.seq)) { warnings.push(label + ': invalid sequence; remaining tail excluded'); break; }
    if (event.seq <= previous) {
      warnings.push(label + ': duplicate/out-of-order sequence ' + event.seq + ' excluded');
      continue;
    }
    if (event.seq !== previous + 1) { warnings.push(label + ': sequence gap; remaining tail excluded'); break; }
    previous = event.seq;
    events.push(event);
  }
  const markers = events.filter(e => e.type === 'session/end-seed' && e.data?.inherited === true);
  const cut = header.isSeeded ? markers.at(-1)?.seq : 0;
  const title = events.findLast(e => e.type === 'session/title' && typeof e.data?.title === 'string')?.data.title || header.id;
  if (header.isSeeded && cut === undefined) {
    warnings.push(label + ': seeded session has no inherited boundary; all usage excluded');
    return { header, title, samples: [], warnings };
  }
  const samples = [];
  let last;
  for (const event of events) {
    if (event.seq < cut) continue;
    if (event.type === 'llm/retry-started') {
      if (last?.turn === event.data?.turn && last?.step === event.data?.step) last = undefined;
      continue;
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue;
    const usage = usageOf(event);
    if (!usage) continue;
    const values = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0];
    if (!values.every(validCount)) { warnings.push(label + ': invalid token usage at seq ' + event.seq + ' excluded'); continue; }
    if (!validCount(event.data?.turn) || !validCount(event.data?.step)) { warnings.push(label + ': invalid turn/step at seq ' + event.seq + ' excluded'); continue; }
    const sample = {
      seq: event.seq,
      timestamp: validTime(event.time) ? new Date(event.time).toISOString() : null,
      input: values[0], output: values[1], cacheRead: values[2], cacheWrite: values[3],
      total: values.reduce((sum, count) => sum + count, 0),
    };
    if (sample.timestamp === null) warnings.push(label + ': missing/invalid timestamp at seq ' + event.seq + '; retained without date');
    // Mirrors tokenUsageProjectionDefinition: same step is replacement until a
    // retry-started barrier. Provider totalTokens/reasoningTokens are not added.
    const same = last?.turn === event.data.turn && last?.step === event.data.step;
    if (same) samples[last.index] = sample;
    else samples.push(sample);
    last = { turn: event.data.turn, step: event.data.step, index: same ? last.index : samples.length - 1 };
  }
  return { header, title, samples, warnings };
}

export function createCollector({ dataDir = path.join(os.homedir(), '.dsh') } = {}) {
  const root = path.resolve(dataDir);
  const cache = new Map();
  let pending;
  async function cached(file, loader) {
    const info = await stat(file);
    const signature = [info.mtimeMs, info.ctimeMs, info.size, info.ino].join(':');
    const old = cache.get(file);
    if (old?.signature === signature) return old.value;
    const value = await loader();
    cache.set(file, { signature, value });
    return value;
  }
  async function scan() {
    const warnings = [];
    const active = new Set();
    const registryPath = path.join(root, 'storages', 'workspace.json');
    let registry = {};
    try {
      active.add(registryPath);
      registry = await cached(registryPath, async () => JSON.parse(await readFile(registryPath, 'utf8')));
    } catch { warnings.push('Workspace registry unavailable; projects inferred from session cwd.'); }
    const projects = [];
    const owners = new Map();
    const byPath = new Map();
    const records = registry.tables?.workspaces ?? {};
    const order = [...new Set([...(registry.global?.workspaceIds ?? []), ...Object.keys(records)])];
    for (const id of order) {
      const record = records[id];
      if (!record || typeof record.path !== 'string') continue;
      projects.push({ id, title: record.title || path.basename(record.path), path: record.path, parentId: null });
      byPath.set(canonical(record.path), id);
      for (const sessionId of record.sessionIds ?? []) {
        if (owners.has(sessionId)) warnings.push('Session has multiple Workspace owners: ' + sessionId + '; first owner selected.');
        else owners.set(sessionId, id);
      }
    }
    const logs = new Map();
    const sessionsRoot = path.join(root, 'sessions');
    let groups;
    try { groups = await readdir(sessionsRoot, { withFileTypes: true }); }
    catch { warnings.push('Session directory unavailable: ' + sessionsRoot); groups = []; }
    for (const group of groups) {
      if (!group.isDirectory() || group.isSymbolicLink()) continue;
      const groupDir = path.join(sessionsRoot, group.name);
      let dirs;
      try { dirs = await readdir(groupDir, { withFileTypes: true }); } catch { warnings.push('Unreadable session project directory: ' + group.name); continue; }
      for (const dir of dirs) {
        if (!dir.isDirectory() || dir.isSymbolicLink()) continue;
        const sessionDir = path.join(groupDir, dir.name);
        try {
          const files = (await readdir(sessionDir, { withFileTypes: true })).filter(f => f.isFile() && logName.test(f.name));
          files.sort((a, b) => Number(b.name.match(logName)[1] ?? 0) - Number(a.name.match(logName)[1] ?? 0) || a.name.localeCompare(b.name));
          if (!files.length) continue;
          const selected = files[0];
          const version = selected.name.match(logName)[1] ?? '0';
          if (files[1] && (files[1].name.match(logName)[1] ?? '0') === version) warnings.push(dir.name + ': multiple physical encodings; selecting one artifact only.');
          const file = path.join(sessionDir, selected.name);
          active.add(file);
          const log = await cached(file, async () => {
            let bytes = await readFile(file);
            const extra = [];
            if (file.endsWith('.zstd')) {
              if (!zlib.zstdDecompress) throw new Error('native Zstandard unavailable; use Node >=22.15');
              const { end, frames } = completeZstdPrefix(bytes);
              if (end !== bytes.length) extra.push(dir.name + ': incomplete Zstandard tail excluded');
              if (!end) throw new Error('no complete Zstandard frames');
              const decoded = [];
              const decompress = promisify(zlib.zstdDecompress);
              for (const frame of frames) decoded.push(await decompress(bytes.subarray(frame.start, frame.end)));
              bytes = Buffer.concat(decoded);
            }
            return parseLog(bytes.toString('utf8'), dir.name, extra);
          });
          warnings.push(...log.warnings);
          if (logs.has(log.header.id)) warnings.push('Duplicate session identity excluded: ' + log.header.id);
          else logs.set(log.header.id, log);
        } catch (error) { warnings.push(dir.name + ': ' + error.message); }
      }
    }
    for (const key of cache.keys()) if (!active.has(key)) cache.delete(key);
    function rootOf(log) {
      let current = log;
      const seen = new Set();
      while (current.header.origin === 'subagent' && current.header.parentSession) {
        if (seen.has(current.header.id)) { warnings.push('Subagent parent cycle: ' + log.header.id); return log; }
        seen.add(current.header.id);
        const parent = logs.get(current.header.parentSession);
        if (!parent) { warnings.push('Subagent parent missing: ' + current.header.id + '; retaining child separately.'); return current; }
        current = parent;
      }
      return current;
    }
    function projectOf(log) {
      const owner = owners.get(log.header.id);
      if (owner) return owner;
      const cwd = log.header.cwd;
      const key = canonical(cwd);
      if (byPath.has(key)) return byPath.get(key);
      const id = 'cwd:' + (key || '_no-cwd');
      if (!projects.some(project => project.id === id)) projects.push({ id, title: cwd ? cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd : '无工作目录', path: cwd ?? '', parentId: null });
      byPath.set(key, id);
      return id;
    }
    const sessions = new Map();
    const events = [];
    for (const log of logs.values()) {
      const ancestor = rootOf(log);
      const projectId = projectOf(ancestor);
      const sessionId = ancestor.header.id;
      sessions.set(sessionId, { id: sessionId, title: ancestor.title, projectId });
      for (const sample of log.samples) {
        const { seq, ...value } = sample;
        events.push({ id: log.header.id + ':' + seq, sessionId, sessionTitle: ancestor.title, projectId, ...value });
      }
    }
    // Workspace itself is flat. The UI tree is inferred only between registered
    // canonical directory paths; explicit future parentId takes precedence.
    let inferred = false;
    for (const project of projects) {
      const explicit = records[project.id]?.parentId;
      if (explicit && explicit !== project.id && projects.some(p => p.id === explicit)) {
        project.parentId = explicit;
        continue;
      }
      const target = canonical(project.path);
      const candidates = projects.filter(p => p.id !== project.id && records[p.id] && canonical(p.path) !== target && target.startsWith(canonical(p.path) + '/'));
      candidates.sort((a, b) => canonical(b.path).length - canonical(a.path).length);
      if (candidates.length) { project.parentId = candidates[0].id; inferred = true; }
    }
    // Defensive cycle removal for malformed explicit parent links.
    for (const project of projects) {
      const seen = new Set([project.id]);
      let parent = project.parentId;
      while (parent) {
        if (seen.has(parent)) { project.parentId = null; warnings.push('Project parent cycle removed: ' + project.id); break; }
        seen.add(parent);
        parent = projects.find(p => p.id === parent)?.parentId;
      }
    }
    if (inferred) warnings.push('Project hierarchy inferred from nearest registered ancestor directory; native Workspace storage is flat.');
    events.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? '') || a.id.localeCompare(b.id));
    return { projects, sessions: [...sessions.values()], events, warnings: [...new Set(warnings)], generatedAt: new Date().toISOString() };
  }
  return { collect() {
    if (!pending) pending = scan().finally(() => { pending = undefined; });
    return pending;
  } };
}
