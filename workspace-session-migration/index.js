/**
 * Workspace session migration.
 *
 * DSH stores every Session as an append-only log under the working directory it
 * was created in, and a Workspace account only accepts a Session whose stored
 * header `cwd` resolves to the Workspace directory. Moving an existing Session
 * between Workspaces therefore means producing a Session whose header names the
 * target directory. This plugin does that through the public persistence and
 * Workspace services: it reads the complete stored event log, writes a new
 * Session in the target Workspace with the same title and history, adds it to
 * that Workspace's account, and then removes the original from DSH (moved into
 * a backup directory, or archived when the caller keeps it).
 *
 * The plugin exposes two Agent tools and performs no model calls, network
 * requests, or shell commands. Everything it writes stays below the local DSH
 * session root and its sibling backup directory.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const name = 'workspace-session-migration';
export const inject = ['tools', 'workspaceRegistry', 'sessionPersistence', 'connection'];

const LIST_TOOL = 'list_workspace_sessions';
const MIGRATE_TOOL = 'migrate_workspace_sessions';
const API_PREFIX = '/api/workspace-session-migration/';
const MAX_SESSIONS_PER_CALL = 50;
const MAX_INVENTORY_SESSIONS = 500;
const MAX_API_BODY_BYTES = 16 * 1024;
const BACKUP_DIR_NAME = 'session-migration-backups';

/** A migration request the caller can correct, as opposed to a storage failure. */
export class MigrationRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationRequestError';
  }
}

const LIST_DESCRIPTION = 'List registered Workspaces and their Sessions: id, title, working directory, '
  + 'archived/pinned state, whether the Session is open, whether it has a stored log, and whether its '
  + 'format needs an upgrade. Read this before migrating to choose the Workspace and Session ids.';

const MIGRATE_DESCRIPTION = 'Move Sessions into another Workspace by copying their complete stored history '
  + 'into a new Session whose working directory is the target Workspace, attaching it there, and removing '
  + 'the original from DSH. The new Session keeps the title, creation time, and every event, but DSH cannot '
  + 'change an existing Session\'s working directory, so it gets a new Session id. By default the original '
  + 'log is moved to a backup directory and disappears from the Session list; with keepOriginal it is '
  + 'detached and archived instead. Open Sessions, Sessions that need a format migration, and subagent '
  + 'Sessions are skipped. Use dryRun first to inspect the plan.';

const LIST_PARAMETERS = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const MIGRATE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['targetWorkspace'],
  properties: {
    targetWorkspace: {
      type: 'string',
      description: 'Target Workspace id or canonical directory path.',
    },
    sourceWorkspace: {
      type: 'string',
      description: 'Workspace id or path whose Sessions all migrate; required when sessionIds is omitted.',
    },
    sessionIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exact Session ids to migrate, at most 50. Omit to migrate every Session of sourceWorkspace.',
    },
    keepOriginal: {
      type: 'boolean',
      description: 'Keep the original log and archive it (hidden but recoverable) instead of moving it to a backup directory.',
    },
    dryRun: {
      type: 'boolean',
      description: 'Validate and report the plan without writing anything.',
    },
    includeSubagentSessions: {
      type: 'boolean',
      description: 'Also migrate Sessions created as subagent children; skipped by default.',
    },
  },
};

const LIST_OUTPUT = {
  schema: {},
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
};

const MIGRATE_OUTPUT = {
  schema: {},
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
};

/** Case-normalized comparison key for a directory path. */
function pathKey(value) {
  const withoutTrailingSeparators = String(value).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? withoutTrailingSeparators.toLowerCase() : withoutTrailingSeparators;
}

/**
 * Resolve one Workspace by id or by canonical directory path.
 * @param {readonly object[]} workspaces - registered Workspaces.
 * @param {unknown} wanted - Workspace id or path supplied by the caller.
 * @returns {object | undefined} the matching Workspace.
 */
export function resolveWorkspace(workspaces, wanted) {
  if (typeof wanted !== 'string' || wanted.trim() === '') return undefined;
  const value = wanted.trim();
  const byId = workspaces.find(workspace => workspace.id === value);
  if (byId !== undefined) return byId;
  const key = pathKey(value);
  return workspaces.find(workspace => pathKey(workspace.path) === key);
}

/** The Workspace accounting for one Session, ignoring the target. */
function owningWorkspace(workspaces, sessionId, target) {
  return workspaces.find(workspace => workspace.id !== target.id && workspace.sessionIds.includes(sessionId));
}

/** ISO-8601 text for a stored creation timestamp. */
function createdAtText(createdAt) {
  return Number.isFinite(createdAt) ? new Date(createdAt).toISOString() : null;
}

/** The durable title record carried by the last `session/title` event, when present. */
function titleFromEvents(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'session/title' && typeof event.data?.title === 'string') return event.data.title;
  }
  return null;
}

/** The zero-I/O title hint kept by the projection cache, when a matching record exists. */
function titleFromCache(cache, header) {
  if (cache === undefined) return null;
  try {
    const snapshot = cache.cachedSnapshot(header);
    const title = snapshot?.values?.title;
    return typeof title === 'string' && title.trim() !== '' ? title : null;
  } catch {
    return null;
  }
}

/** A filesystem-safe, collision-free directory name for one Session id. */
function backupSegment(sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/gu, '_');
  if (safe === sessionId) return safe;
  const digest = createHash('sha1').update(sessionId).digest('hex').slice(0, 8);
  return `${safe}-${digest}`;
}

/** One backup directory name shared by every Session of a single call. */
function backupStamp(now) {
  const stamp = now.toISOString().replace(/[:.]/gu, '-');
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Describe the registered Workspaces and their accounted Sessions without
 * reading any Session body: headers and projection-cache rows only.
 * @param {object} deps - Workspace, persistence, and projection-cache services.
 * @returns {Promise<object>} the inventory reported to the caller.
 */
export async function collectInventory(deps) {
  const workspaces = deps.workspaceRegistry.list();
  const archived = new Set(deps.workspaceRegistry.archivedSessionIds ?? []);
  const pinned = new Set(deps.workspaceRegistry.pinnedSessionIds ?? []);
  const snapshots = await deps.sessionPersistence.list();
  const byId = new Map(snapshots.map(snapshot => [snapshot.header.id, snapshot]));
  const total = workspaces.reduce((sum, workspace) => sum + workspace.sessionIds.length, 0);
  let budget = MAX_INVENTORY_SESSIONS;
  const listed = [];

  for (const workspace of workspaces) {
    const sessions = [];
    for (const sessionId of workspace.sessionIds) {
      if (budget <= 0) break;
      budget -= 1;
      const snapshot = byId.get(sessionId);
      const header = snapshot?.header;
      sessions.push({
        id: sessionId,
        title: header === undefined ? null : titleFromCache(deps.sessionProjectionCache, header),
        createdAt: header === undefined ? null : createdAtText(header.createdAt),
        cwd: header?.cwd ?? null,
        isSeeded: header?.isSeeded === true,
        subagent: header?.origin === 'subagent',
        archived: archived.has(sessionId),
        pinned: pinned.has(sessionId),
        open: deps.sessions?.get?.(sessionId) !== undefined,
        stored: snapshot?.location !== undefined,
        formatStatus: snapshot?.formatStatus ?? (snapshot === undefined ? null : 'current'),
      });
    }
    listed.push({
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      status: await workspace.status(),
      sessionCount: workspace.sessionIds.length,
      sessions,
    });
  }

  return { workspaces: listed, truncated: total > MAX_INVENTORY_SESSIONS };
}

/** Inspect one Session and decide whether it can be copied into the target Workspace. */
async function inspectSession(deps, sessionId, target, options) {
  if (deps.sessions?.get?.(sessionId) !== undefined) {
    return { ok: false, reason: 'the session is open in DSH; close it before migrating' };
  }
  const snapshot = await deps.sessionPersistence.stat(sessionId, { signal: options.signal });
  if (snapshot === undefined) {
    return { ok: false, reason: 'the session log was not found' };
  }
  if (snapshot.formatStatus === 'migration-required') {
    return { ok: false, reason: 'the session needs a format migration; open it once in DSH first' };
  }
  if (snapshot.location?.path === undefined) {
    return { ok: false, reason: 'the session has no stored log file' };
  }
  if (snapshot.header.origin === 'subagent' && options.includeSubagentSessions !== true) {
    return { ok: false, reason: 'subagent sessions are skipped by default' };
  }
  return {
    ok: true,
    header: snapshot.header,
    directory: dirname(snapshot.location.path),
  };
}

/** Read the complete validated event log and its inherited prefix length. */
async function readStoredSession(persistence, sessionId, signal) {
  const handle = await persistence.open(sessionId, 'read', { signal });
  try {
    const result = await handle.read(0, undefined, { signal });
    return { events: result.events, inheritedEventCount: handle.inheritedEventCount };
  } finally {
    await handle.close();
  }
}

/** Remove a just-created Session log after a failed copy (best effort; it is ours). */
async function discardSession(persistence, sessionId) {
  try {
    const snapshot = await persistence.stat(sessionId);
    const path = snapshot?.location?.path;
    if (path !== undefined) await rm(dirname(path), { recursive: true, force: true });
  } catch {
    // The copy never materialized, or the cleanup raced with storage; nothing else owns this id.
  }
}

/** Write the new Session and return its identity plus the header the caller must validate against. */
async function createCopy(persistence, target, header, events, inheritedEventCount, signal) {
  const newId = `session-${randomUUID()}`;
  const newHeader = { ...header, id: newId, cwd: target.path };
  const handle = await persistence.create(newHeader, { signal, inheritedEventCount });
  try {
    await handle.append(events, { signal });
    await handle.flush({ signal });
  } catch (error) {
    await handle.close().catch(() => {});
    await discardSession(persistence, newId);
    throw error;
  }
  try {
    await handle.close();
  } catch (error) {
    await discardSession(persistence, newId);
    throw error;
  }
  return { newId, newHeader };
}

/** Seed the new Session's list-title/state cache so it appears before it is first opened. */
function refreshProjectionCache(cache, header, inheritedEventCount, events, warn) {
  if (cache === undefined) return;
  try {
    cache.coldSnapshot(header, inheritedEventCount, events);
  } catch (error) {
    warn(`could not refresh the projection cache for the new session: ${errorMessage(error)}`);
  }
}

/** Move one Session log directory out of the session store into the backup tree. */
async function moveSessionAside(directory, sessionId, stamp) {
  const sessionRoot = dirname(dirname(directory));
  const backupDir = join(dirname(sessionRoot), BACKUP_DIR_NAME, stamp);
  await mkdir(backupDir, { recursive: true });
  const destination = join(backupDir, backupSegment(sessionId));
  await rename(directory, destination);
  return { backupDir, destination };
}

/** Copy one Session, attach the copy, and settle the original according to `keepOriginal`. */
async function migrateOne(deps, entry, target, options) {
  const { sessionId, source } = entry;
  const inspected = await inspectSession(deps, sessionId, target, options);
  if (!inspected.ok) return { status: 'skipped', sessionId, reason: inspected.reason };

  const { header, directory } = inspected;
  const archived = new Set(deps.workspaceRegistry.archivedSessionIds ?? []);
  const pinned = new Set(deps.workspaceRegistry.pinnedSessionIds ?? []);
  const wasArchived = archived.has(sessionId);
  const wasPinned = pinned.has(sessionId);
  let copy;
  let backup;
  try {
    const { events, inheritedEventCount } = await readStoredSession(
      deps.sessionPersistence, sessionId, options.signal,
    );
    copy = await createCopy(
      deps.sessionPersistence, target, header, events, inheritedEventCount, options.signal,
    );
    refreshProjectionCache(deps.sessionProjectionCache, copy.newHeader, inheritedEventCount, events, options.warn);
    if (options.keepOriginal !== true) backup = await moveSessionAside(directory, sessionId, options.stamp);
    await target.attachSession(copy.newId);
    if (source !== undefined) await source.detachSession(sessionId);

    // Carry the original's archive and pin state to the copy so a migration does
    // not resurface a deliberately hidden conversation or lose a pin.
    if (wasArchived) {
      try {
        await deps.workspaceRegistry.archiveSession(copy.newId);
      } catch (error) {
        options.warn(`the copy was attached, but copying its archived state failed: ${errorMessage(error)}`);
      }
    } else if (wasPinned) {
      try {
        await deps.workspaceRegistry.pinSession(copy.newId);
      } catch (error) {
        options.warn(`the copy was attached, but copying its pinned state failed: ${errorMessage(error)}`);
      }
    }

    let original = 'kept';
    if (options.keepOriginal === true) {
      try {
        await deps.workspaceRegistry.archiveSession(sessionId);
        original = 'archived';
      } catch (error) {
        options.warn(`the copy was attached, but archiving the original failed: ${errorMessage(error)}`);
        original = 'kept-unarchived';
      }
    } else {
      original = 'moved-to-backup';
      try {
        await deps.workspaceRegistry.unarchiveSession(sessionId);
      } catch {
        // A stale archive entry for a now-absent log is harmless; it was already removed from the store.
      }
      try {
        await deps.workspaceRegistry.unpinSession(sessionId);
      } catch {
        // Same for a stale pin entry.
      }
    }

    return {
      status: 'migrated',
      sourceSessionId: sessionId,
      newSessionId: copy.newId,
      title: titleFromEvents(events),
      sourceWorkspaceId: source?.id ?? null,
      original,
      backupPath: backup?.destination ?? null,
    };
  } catch (error) {
    if (backup !== undefined) {
      try {
        await rename(backup.destination, directory);
      } catch (restoreError) {
        options.warn(`could not restore the original log to ${directory}: ${errorMessage(restoreError)}`);
      }
    }
    if (copy !== undefined) {
      try {
        await target.detachSession(copy.newId);
      } catch {
        // The copy may never have been attached.
      }
      await discardSession(deps.sessionPersistence, copy.newId);
    }
    return { status: 'failed', sessionId, reason: errorMessage(error) };
  }
}

/** Resolve the requested Sessions and the Workspace currently owning each one. */
function selectEntries(workspaces, request) {
  const explicit = Array.isArray(request.sessionIds) ? request.sessionIds : undefined;
  if (explicit !== undefined) {
    const unique = [...new Set(explicit)];
    return unique.map(sessionId => ({ sessionId, source: undefined }));
  }
  const source = resolveWorkspace(workspaces, request.sourceWorkspace);
  if (source === undefined) {
    throw new MigrationRequestError('provide sessionIds, or a sourceWorkspace whose sessions should all migrate');
  }
  return source.sessionIds.map(sessionId => ({ sessionId, source }));
}

/**
 * Migrate the requested Sessions into the target Workspace.
 * @param {object} deps - Workspace, persistence, projection-cache, and Session-store services.
 * @param {object} request - validated request fields.
 * @param {object} options - cancellation, warning sink, and test-injectable clock.
 * @returns {Promise<object>} per-Session outcomes and the backup roots used.
 */
export async function migrateSessions(deps, request, options = {}) {
  const signal = options.signal;
  const warn = options.warn ?? (() => {});
  const workspaces = deps.workspaceRegistry.list();
  const target = resolveWorkspace(workspaces, request.targetWorkspace);
  if (target === undefined) {
    throw new MigrationRequestError(`unknown target workspace: ${String(request.targetWorkspace)}`);
  }
  if (await target.status() !== 'ok') {
    throw new MigrationRequestError(`target workspace directory is unavailable: ${target.path}`);
  }

  const entries = selectEntries(workspaces, request).map(entry => ({
    ...entry,
    source: entry.source ?? owningWorkspace(workspaces, entry.sessionId, target),
  }));
  if (entries.length === 0) throw new MigrationRequestError('no sessions were selected for migration');
  if (entries.length > MAX_SESSIONS_PER_CALL) {
    throw new MigrationRequestError(`at most ${MAX_SESSIONS_PER_CALL} sessions can be migrated in one call`);
  }

  const dryRun = request.dryRun === true;
  const keepOriginal = request.keepOriginal === true;
  const stamp = backupStamp(options.now ?? new Date());
  const result = {
    target: { id: target.id, title: target.title, path: target.path },
    dryRun,
    planned: [],
    migrated: [],
    skipped: [],
    failed: [],
    backupRoots: [],
  };

  for (const entry of entries) {
    if (target.sessionIds.includes(entry.sessionId)) {
      result.skipped.push({ sessionId: entry.sessionId, reason: 'the session already belongs to the target workspace' });
      continue;
    }
    if (dryRun) {
      const inspected = await inspectSession(deps, entry.sessionId, target, {
        ...request,
        includeSubagentSessions: request.includeSubagentSessions === true,
        signal,
      });
      if (!inspected.ok) {
        result.skipped.push({ sessionId: entry.sessionId, reason: inspected.reason });
        continue;
      }
      result.planned.push({
        sourceSessionId: entry.sessionId,
        sourceWorkspaceId: entry.source?.id ?? null,
        title: titleFromEvents((await readStoredSession(deps.sessionPersistence, entry.sessionId, signal)).events),
        original: keepOriginal ? 'archived' : 'moved-to-backup',
      });
      continue;
    }

    const outcome = await migrateOne(deps, entry, target, {
      signal,
      keepOriginal,
      includeSubagentSessions: request.includeSubagentSessions === true,
      stamp,
      warn,
    });
    if (outcome.status === 'migrated') {
      result.migrated.push(outcome);
      if (outcome.backupPath !== null) {
        const root = dirname(outcome.backupPath);
        if (!result.backupRoots.includes(root)) result.backupRoots.push(root);
      }
    } else if (outcome.status === 'skipped') {
      result.skipped.push({ sessionId: outcome.sessionId, reason: outcome.reason });
    } else {
      result.failed.push({ sessionId: outcome.sessionId, reason: outcome.reason });
    }
  }

  return result;
}

/** Validate model-supplied migration arguments. */
function parseMigrationRequest(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('migration arguments must be an object');
  }
  const allowed = new Set([
    'targetWorkspace', 'sourceWorkspace', 'sessionIds', 'keepOriginal', 'dryRun', 'includeSubagentSessions',
  ]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) throw new TypeError(`unknown migration argument: ${key}`);
  }
  if (typeof args.targetWorkspace !== 'string' || args.targetWorkspace.trim() === '') {
    throw new TypeError('targetWorkspace must be a non-empty workspace id or directory path');
  }
  const request = { targetWorkspace: args.targetWorkspace.trim() };
  if (args.sourceWorkspace !== undefined) {
    if (typeof args.sourceWorkspace !== 'string' || args.sourceWorkspace.trim() === '') {
      throw new TypeError('sourceWorkspace must be a non-empty workspace id or directory path');
    }
    request.sourceWorkspace = args.sourceWorkspace.trim();
  }
  if (args.sessionIds !== undefined) {
    if (!Array.isArray(args.sessionIds)) throw new TypeError('sessionIds must be an array of session ids');
    if (args.sessionIds.length === 0) throw new TypeError('sessionIds must not be empty');
    if (args.sessionIds.length > MAX_SESSIONS_PER_CALL) {
      throw new TypeError(`at most ${MAX_SESSIONS_PER_CALL} session ids are allowed in one call`);
    }
    for (const sessionId of args.sessionIds) {
      if (typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw new TypeError('sessionIds must contain non-empty strings');
      }
    }
    request.sessionIds = args.sessionIds.map(sessionId => sessionId.trim());
  }
  if (request.sessionIds === undefined && request.sourceWorkspace === undefined) {
    throw new TypeError('provide sessionIds, or a sourceWorkspace whose sessions should all migrate');
  }
  for (const key of ['keepOriginal', 'dryRun', 'includeSubagentSessions']) {
    if (args[key] === undefined) continue;
    if (typeof args[key] !== 'boolean') throw new TypeError(`${key} must be a boolean`);
    request[key] = args[key];
  }
  return request;
}

/** Shared operations behind both the Agent tools and the authenticated UI routes. */
function createOperations(services) {
  const deps = () => ({
    workspaceRegistry: services.workspaceRegistry,
    sessionPersistence: services.sessionPersistence,
    sessionProjectionCache: services.get('sessionProjectionCache'),
    sessions: services.get('sessions'),
    warn: services.warn,
  });
  return {
    list: () => collectInventory(deps()),
    migrate: (request, options = {}) => migrateSessions(deps(), request, { ...options, warn: services.warn }),
  };
}

/** Build the two tool definitions over the shared operations. */
function buildTools(operations) {
  return [
    {
      name: LIST_TOOL,
      description: LIST_DESCRIPTION,
      parameters: LIST_PARAMETERS,
      output: LIST_OUTPUT,
      execute: async () => operations.list(),
      presentCall: () => ({ card: 'generic', title: 'List workspace sessions', kind: 'read' }),
    },
    {
      name: MIGRATE_TOOL,
      description: MIGRATE_DESCRIPTION,
      parameters: MIGRATE_PARAMETERS,
      output: MIGRATE_OUTPUT,
      execute: async (args, exec) => operations.migrate(parseMigrationRequest(args), { signal: exec?.signal }),
      presentCall: () => ({ card: 'generic', title: 'Migrate workspace sessions', kind: 'other' }),
    },
  ];
}

/** One JSON response with the safety headers every browser-facing route uses. */
function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** Read one bounded JSON request body from a Connection fetch request. */
async function readJsonBody(request) {
  const reader = request.body?.getReader();
  if (reader === undefined) throw new TypeError('missing JSON body');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_API_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError('request too large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Map one operation failure onto the route status and a stable error code. */
function errorResponse(error) {
  if (error instanceof RangeError) {
    return json({ error: { code: 'too_large', message: 'The migration request is too large.' } }, 413);
  }
  if (error instanceof TypeError || error instanceof SyntaxError) {
    return json({ error: { code: 'invalid_request', message: error.message } }, 400);
  }
  if (error instanceof MigrationRequestError) {
    return json({ error: { code: 'migration_rejected', message: error.message } }, 400);
  }
  return json({ error: { code: 'migration_failed', message: errorMessage(error) } }, 500);
}

/**
 * Register the migration tools and the two authenticated UI routes on the Host.
 * @param {object} ctx - Cordis context with the Tool, Workspace, persistence, and Connection services.
 */
export function apply(ctx) {
  const services = {
    workspaceRegistry: ctx.workspaceRegistry,
    sessionPersistence: ctx.sessionPersistence,
    get: serviceName => ctx.get(serviceName),
    warn: message => ctx.logger?.warn?.(`workspace-session-migration: ${message}`),
  };
  const operations = createOperations(services);
  for (const definition of buildTools(operations)) ctx.tools.register(definition);

  if (ctx.connection?.fetch?.register === undefined) return;
  const registerRoute = (route) => {
    try {
      ctx.connection.fetch.register(route);
    } catch (error) {
      ctx.logger?.warn?.(`workspace-session-migration: could not register ${route.path}: ${errorMessage(error)}`);
    }
  };
  registerRoute({
    path: `${API_PREFIX}state`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        return json(await operations.list());
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
  registerRoute({
    path: `${API_PREFIX}migrate`,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: async request => {
      try {
        const body = await readJsonBody(request);
        return json(await operations.migrate(parseMigrationRequest(body), { signal: request.signal }));
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
}
