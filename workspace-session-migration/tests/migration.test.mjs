import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, collectInventory, migrateSessions, resolveWorkspace } from '../index.js';

/** A stored Session the fake persistence serves. */
function sessionRecord(root, header, events) {
  const file = join(root, header.cwd.replace(/[\\/:]+/gu, '-'), header.id, 'session.v4.jsonl.zstd');
  return { header, events, inheritedEventCount: 0, file, materialized: false };
}

async function writeRecord(record) {
  await mkdir(join(record.file, '..'), { recursive: true });
  await writeFile(record.file, `${JSON.stringify(record.header)}\n`);
  record.materialized = true;
}

/** Minimal JSONL persistence seam used by the plugin: stat, list, read, create. */
class FakePersistence {
  constructor(root) {
    this.root = root;
    this.entries = new Map();
  }

  add(header, events = []) {
    const record = sessionRecord(this.root, header, events);
    this.entries.set(header.id, record);
    return record;
  }

  snapshot(record) {
    const stored = record.materialized && existsSync(record.file);
    return {
      header: record.header,
      formatStatus: 'current',
      revision: 'test',
      location: stored ? { kind: 'jsonl', path: record.file } : undefined,
    };
  }

  async stat(id) {
    const record = this.entries.get(id);
    if (record === undefined) return undefined;
    const snapshot = this.snapshot(record);
    return snapshot.location === undefined && record.materialized ? undefined : snapshot;
  }

  async list() {
    return [...this.entries.values()]
      .filter(record => this.snapshot(record).location !== undefined)
      .map(record => this.snapshot(record));
  }

  async open(id) {
    const record = this.entries.get(id);
    assert.ok(record, `opening unknown session ${id}`);
    return {
      id,
      header: record.header,
      inheritedEventCount: record.inheritedEventCount,
      async read() {
        return { eventState: 'owned', events: structuredClone(record.events) };
      },
      async close() {},
    };
  }

  async create(header, options) {
    assert.equal(this.entries.has(header.id), false, `duplicate session id ${header.id}`);
    const record = sessionRecord(this.root, header, []);
    record.inheritedEventCount = options?.inheritedEventCount ?? 0;
    this.entries.set(header.id, record);
    const persistence = this;
    return {
      id: header.id,
      header: record.header,
      inheritedEventCount: record.inheritedEventCount,
      async append(events) {
        record.events.push(...structuredClone(events));
        await writeRecord(record);
      },
      async flush() {
        await writeRecord(record);
      },
      async close() {},
    };
  }
}

function makeWorkspace(id, path) {
  return {
    id,
    title: id,
    path,
    sessionIds: [],
    async status() {
      return 'ok';
    },
    async attachSession(sessionId) {
      if (!this.sessionIds.includes(sessionId)) this.sessionIds.unshift(sessionId);
    },
    async detachSession(sessionId) {
      this.sessionIds = this.sessionIds.filter(value => value !== sessionId);
    },
  };
}

function makeRegistry(workspaces) {
  const calls = [];
  return {
    calls,
    archived: [],
    pinned: [],
    list: () => workspaces,
    get archivedSessionIds() {
      return this.archived;
    },
    get pinnedSessionIds() {
      return this.pinned;
    },
    async archiveSession(sessionId) {
      calls.push(['archive', sessionId]);
      this.archived.push(sessionId);
    },
    async unarchiveSession(sessionId) {
      calls.push(['unarchive', sessionId]);
      this.archived = this.archived.filter(value => value !== sessionId);
    },
    async unpinSession(sessionId) {
      calls.push(['unpin', sessionId]);
      this.pinned = this.pinned.filter(value => value !== sessionId);
    },
    async pinSession(sessionId) {
      calls.push(['pin', sessionId]);
      this.pinned.push(sessionId);
    },
  };
}

function makeProjectionCache(titles = new Map()) {
  return {
    calls: [],
    coldSnapshot(header, inheritedEventCount, events) {
      this.calls.push({ header: structuredClone(header), inheritedEventCount, count: events.length });
      return { values: { title: 'cached' } };
    },
    cachedSnapshot(header) {
      const title = titles.get(header.id);
      return title === undefined ? undefined : { values: { title } };
    },
  };
}

/** One source workspace holding one plain conversation, plus an empty target workspace. */
async function fixture(t) {
  const tmp = await mkdtemp(join(tmpdir(), 'session-migration-'));
  t.after(async () => {
    await rm(tmp, { recursive: true, force: true });
  });
  const root = join(tmp, 'sessions');
  const sourcePath = join(tmp, 'source');
  const targetPath = join(tmp, 'target');
  await mkdir(sourcePath, { recursive: true });
  await mkdir(targetPath, { recursive: true });

  const persistence = new FakePersistence(root);
  const header = {
    version: 4,
    id: 'session-old',
    createdAt: 1_700_000_000_000,
    cwd: sourcePath,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'standard',
  };
  const record = persistence.add(header, [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'session/title', data: { title: 'Old chat' } },
  ]);
  await writeRecord(record);

  const source = makeWorkspace('workspace-source', sourcePath);
  source.sessionIds = ['session-old'];
  const target = makeWorkspace('workspace-target', targetPath);
  const registry = makeRegistry([target, source]);
  const projectionCache = makeProjectionCache(new Map([['session-old', 'Old chat']]));
  const deps = {
    workspaceRegistry: registry,
    sessionPersistence: persistence,
    sessionProjectionCache: projectionCache,
    sessions: { get: () => undefined },
  };
  return { tmp, root, sourcePath, targetPath, persistence, header, record, source, target, registry, projectionCache, deps };
}

test('the same path with different spelling resolves to one workspace', () => {
  const workspace = { id: 'w1', path: 'C:\\Projects\\Alpha', title: 'Alpha', sessionIds: [] };
  const candidates = [workspace];
  assert.equal(resolveWorkspace(candidates, 'w1'), workspace);
  assert.equal(resolveWorkspace(candidates, 'C:\\Projects\\Alpha\\'), workspace);
  if (process.platform === 'win32') assert.equal(resolveWorkspace(candidates, 'c:\\projects\\alpha'), workspace);
  assert.equal(resolveWorkspace(candidates, 'C:\\Projects\\Beta'), undefined);
});

test('migrates a conversation into the target workspace and moves the original log aside', async (t) => {
  const f = await fixture(t);
  const result = await migrateSessions(f.deps, {
    targetWorkspace: f.target.id,
    sessionIds: [f.header.id],
  });

  assert.equal(result.migrated.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.failed.length, 0);
  const migrated = result.migrated[0];
  assert.notEqual(migrated.newSessionId, f.header.id);
  assert.equal(migrated.sourceSessionId, f.header.id);
  assert.equal(migrated.title, 'Old chat');
  assert.equal(migrated.sourceWorkspaceId, f.source.id);

  const copy = await f.persistence.stat(migrated.newSessionId);
  assert.equal(copy.header.cwd, f.targetPath);
  assert.deepEqual(f.persistence.entries.get(migrated.newSessionId).events, f.record.events);

  assert.deepEqual(f.target.sessionIds, [migrated.newSessionId]);
  assert.deepEqual(f.source.sessionIds, []);
  assert.equal(existsSync(join(f.record.file, '..')), false, 'the original session directory must leave the store');
  assert.equal(existsSync(migrated.backupPath), true, 'the original log must be recoverable from the backup');
  assert.equal(result.backupRoots.length, 1);
  assert.equal(f.projectionCache.calls.length, 1);
  assert.equal(f.projectionCache.calls[0].header.cwd, f.targetPath);
  assert.equal(f.projectionCache.calls[0].count, 2);
});

test('keepOriginal archives the original and leaves its log in place', async (t) => {
  const f = await fixture(t);
  const result = await migrateSessions(f.deps, {
    targetWorkspace: f.targetPath,
    sessionIds: [f.header.id],
    keepOriginal: true,
  });

  assert.equal(result.migrated.length, 1);
  assert.equal(result.migrated[0].original, 'archived');
  assert.equal(existsSync(f.record.file), true);
  assert.ok(f.registry.calls.some(([verb, id]) => verb === 'archive' && id === f.header.id));
  assert.deepEqual(f.source.sessionIds, []);
});

test('a seeded session keeps its inherited prefix length', async (t) => {
  const f = await fixture(t);
  f.record.header.isSeeded = true;
  f.record.inheritedEventCount = 1;
  const result = await migrateSessions(f.deps, {
    targetWorkspace: f.target.id,
    sessionIds: [f.header.id],
  });
  assert.equal(result.migrated.length, 1);
  const copy = f.persistence.entries.get(result.migrated[0].newSessionId);
  assert.equal(copy.header.isSeeded, true);
  assert.equal(copy.inheritedEventCount, 1);
  assert.equal(f.projectionCache.calls[0].inheritedEventCount, 1);
});

test('the copy inherits the original archived state', async (t) => {
  const f = await fixture(t);
  f.registry.archived = [f.header.id];
  const result = await migrateSessions(f.deps, {
    targetWorkspace: f.target.id,
    sessionIds: [f.header.id],
  });
  assert.equal(result.migrated.length, 1);
  const newId = result.migrated[0].newSessionId;
  assert.deepEqual(f.registry.archived, [newId]);
  assert.equal(f.registry.archived.includes(f.header.id), false);
});

test('a source workspace whose directory is missing still migrates its sessions', async (t) => {
  const f = await fixture(t);
  f.source.status = async () => 'missing-dir';
  const result = await migrateSessions(f.deps, {
    targetWorkspace: f.target.id,
    sourceWorkspace: f.source.path,
  });
  assert.equal(result.migrated.length, 1);
  assert.equal(result.failed.length, 0);
  assert.deepEqual(f.source.sessionIds, []);
  assert.equal(f.target.sessionIds.length, 1);
});

test('a sourceWorkspace migrates every accounted session', async (t) => {
  const f = await fixture(t);
  const result = await migrateSessions(f.deps, {
    targetWorkspace: f.target.id,
    sourceWorkspace: f.source.id,
    dryRun: false,
  });
  assert.equal(result.migrated.length, 1);
  assert.equal(result.migrated[0].sourceWorkspaceId, f.source.id);
});

test('an open session is skipped without writing anything', async (t) => {
  const f = await fixture(t);
  f.deps.sessions = { get: id => (id === f.header.id ? { id } : undefined) };
  const result = await migrateSessions(f.deps, {
    targetWorkspace: f.target.id,
    sessionIds: [f.header.id],
  });
  assert.equal(result.migrated.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /open/u);
  assert.deepEqual(f.target.sessionIds, []);
  assert.equal(f.persistence.entries.size, 1);
});

test('dryRun reports the plan without writing', async (t) => {
  const f = await fixture(t);
  const result = await migrateSessions(f.deps, {
    targetWorkspace: f.target.id,
    sessionIds: [f.header.id],
    dryRun: true,
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.planned.length, 1);
  assert.equal(result.planned[0].sourceSessionId, f.header.id);
  assert.equal(result.planned[0].title, 'Old chat');
  assert.equal(result.migrated.length, 0);
  assert.equal(f.persistence.entries.size, 1);
  assert.deepEqual(f.target.sessionIds, []);
  assert.equal(f.projectionCache.calls.length, 0);
});

test('failure to attach rolls the original back and discards the copy', async (t) => {
  const f = await fixture(t);
  f.target.attachSession = async () => {
    throw new Error('attach failed');
  };
  const result = await migrateSessions(f.deps, {
    targetWorkspace: f.target.id,
    sessionIds: [f.header.id],
  });
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].reason, /attach failed/u);
  assert.equal(existsSync(f.record.file), true, 'the original log must be restored');
  assert.deepEqual(f.source.sessionIds, [f.header.id]);
  assert.deepEqual(f.target.sessionIds, []);
  assert.equal((await f.persistence.list()).length, 1, 'the discarded copy must not remain in storage');
});

test('unknown targets and empty selections are rejected', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () => migrateSessions(f.deps, { targetWorkspace: 'workspace-missing', sessionIds: [f.header.id] }),
    /unknown target workspace/u,
  );
  await assert.rejects(
    () => migrateSessions(f.deps, { targetWorkspace: f.target.id }),
    /provide sessionIds/u,
  );
});

test('inventory lists workspaces with title and state hints', async (t) => {
  const f = await fixture(t);
  f.registry.archived = ['session-old'];
  f.registry.pinned = ['session-old'];
  const inventory = await collectInventory(f.deps);
  assert.equal(inventory.workspaces.length, 2);
  const source = inventory.workspaces.find(workspace => workspace.id === f.source.id);
  assert.equal(source.status, 'ok');
  assert.equal(source.sessions.length, 1);
  assert.deepEqual(source.sessions[0], {
    id: 'session-old',
    title: 'Old chat',
    createdAt: new Date(f.header.createdAt).toISOString(),
    cwd: f.sourcePath,
    isSeeded: false,
    subagent: false,
    archived: true,
    pinned: true,
    open: false,
    stored: true,
    formatStatus: 'current',
  });
  assert.equal(inventory.truncated, false);
});

test('apply registers both tools and validates arguments', async (t) => {
  const f = await fixture(t);
  const definitions = [];
  const routes = [];
  const ctx = {
    workspaceRegistry: f.registry,
    sessionPersistence: f.persistence,
    tools: {
      register(definition) {
        definitions.push(definition);
        return () => {};
      },
    },
    connection: {
      fetch: {
        register(definition) {
          routes.push(definition);
          return () => {};
        },
      },
    },
    logger: { warn() {} },
    get(serviceName) {
      if (serviceName === 'sessionProjectionCache') return f.projectionCache;
      if (serviceName === 'sessions') return f.deps.sessions;
      return undefined;
    },
  };
  apply(ctx);
  assert.deepEqual(definitions.map(definition => definition.name).sort(), [
    'list_workspace_sessions',
    'migrate_workspace_sessions',
  ]);
  assert.deepEqual(routes.map(route => route.path).sort(), [
    '/api/workspace-session-migration/migrate',
    '/api/workspace-session-migration/state',
  ]);
  const listTool = definitions.find(definition => definition.name === 'list_workspace_sessions');
  const migrateTool = definitions.find(definition => definition.name === 'migrate_workspace_sessions');

  const inventory = await listTool.execute({});
  assert.equal(inventory.workspaces.length, 2);

  await assert.rejects(
    () => migrateTool.execute({ targetWorkspace: f.target.id, unexpected: true }),
    /unknown migration argument/u,
  );
  await assert.rejects(
    () => migrateTool.execute({ targetWorkspace: '   ' }),
    /targetWorkspace/u,
  );
  await assert.rejects(
    () => migrateTool.execute({ targetWorkspace: f.target.id, sessionIds: [] }),
    /must not be empty/u,
  );

  const result = await migrateTool.execute({ targetWorkspace: f.target.id, sessionIds: ['session-old'], dryRun: true });
  assert.equal(result.planned.length, 1);
  assert.equal(result.dryRun, true);
});

test('connection routes expose the same inventory and migration operation', async (t) => {
  const f = await fixture(t);
  const routes = new Map();
  const ctx = {
    workspaceRegistry: f.registry,
    sessionPersistence: f.persistence,
    tools: { register: () => () => {} },
    connection: {
      fetch: {
        register(definition) {
          routes.set(definition.path.split('/').pop(), definition);
          return () => {};
        },
      },
    },
    logger: { warn() {} },
    get(serviceName) {
      if (serviceName === 'sessionProjectionCache') return f.projectionCache;
      if (serviceName === 'sessions') return f.deps.sessions;
      return undefined;
    },
  };
  apply(ctx);

  const state = await routes.get('state').fetch(new Request('http://127.0.0.1/api/workspace-session-migration/state'));
  assert.equal(state.status, 200);
  const inventory = await state.json();
  assert.equal(inventory.workspaces.length, 2);

  const migrate = routes.get('migrate');
  const dry = await migrate.fetch(new Request('http://127.0.0.1/api/workspace-session-migration/migrate', {
    method: 'POST',
    body: JSON.stringify({ targetWorkspace: f.target.id, sessionIds: [f.header.id], dryRun: true }),
  }));
  assert.equal(dry.status, 200);
  assert.equal((await dry.json()).planned.length, 1);

  const rejected = await migrate.fetch(new Request('http://127.0.0.1/api/workspace-session-migration/migrate', {
    method: 'POST',
    body: JSON.stringify({ targetWorkspace: f.target.id, unexpected: true }),
  }));
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, 'invalid_request');

  const malformed = await migrate.fetch(new Request('http://127.0.0.1/api/workspace-session-migration/migrate', {
    method: 'POST',
    body: '{',
  }));
  assert.equal(malformed.status, 400);

  const real = await migrate.fetch(new Request('http://127.0.0.1/api/workspace-session-migration/migrate', {
    method: 'POST',
    body: JSON.stringify({ targetWorkspace: f.target.id, sessionIds: [f.header.id] }),
  }));
  assert.equal(real.status, 200);
  assert.equal((await real.json()).migrated.length, 1);
  assert.deepEqual(f.target.sessionIds.length, 1);
});
