import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

export const MAX_NOTE_BYTES = 16 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 1024) {
    throw new TypeError('sessionId must be a string of 1–1024 characters');
  }
}

function validateText(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (Buffer.byteLength(text, 'utf8') > MAX_NOTE_BYTES) {
    throw new RangeError('text exceeds the 16 MiB UTF-8 limit');
  }
}

function validateRevision(revision) {
  if (revision !== null && (typeof revision !== 'string' || !UUID.test(revision))) {
    throw new TypeError('expectedRevision must be null or a UUID revision');
  }
}

function validateRecord(record, sessionId) {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || record.version !== 1 || record.sessionId !== sessionId
      || typeof record.revision !== 'string' || !UUID.test(record.revision)
      || typeof record.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(record.updatedAt))
      || new Date(record.updatedAt).toISOString() !== record.updatedAt) {
      throw new Error('Invalid note record structure or session ID');
    }
    validateText(record.text);
  } catch (cause) {
    throw Object.assign(new Error('Invalid or damaged note record', { cause }), { code: 'invalid_record' });
  }
  return record;
}

/**
 * Files live under root/notes. The caller owns root and its permissions.
 * Operations serialize per session in this instance. Writes/imports also acquire
 * an exclusive per-session file lock across instances/processes (10s timeout).
 * Only provably dead PIDs may be recovered, under an exclusive global reaper
 * lock. Malformed locks, live/reused PIDs and abandoned reaper locks time out;
 * age alone never authorizes removal. This assumes a local filesystem honoring
 * exclusive creation and atomic rename, and processes sharing the PID namespace.
 * No conversation content is read, and records are never automatically removed.
 */
export function createDiskStore(root) {
  if (typeof root !== 'string' || !root.trim() || root.includes('\0')) {
    throw new TypeError('root must be a nonempty filesystem path');
  }
  const storageRoot = resolve(root);
  const directory = join(storageRoot, 'notes');
  const pending = new Map();
  const pathFor = sessionId => join(directory, `${createHash('sha256').update(sessionId).digest('hex')}.json`);

  function serialize(sessionId, operation) {
    validateSessionId(sessionId);
    const result = (pending.get(sessionId) ?? Promise.resolve()).then(operation);
    const settled = result.catch(() => {});
    pending.set(sessionId, settled);
    settled.then(() => {
      if (pending.get(sessionId) === settled) pending.delete(sessionId);
    });
    return result;
  }

  const lockDirectory = join(storageRoot, 'locks');

  async function readOwner(path) {
    try {
      const owner = JSON.parse(await fs.readFile(path, 'utf8'));
      return owner && Number.isSafeInteger(owner.pid) && owner.pid > 0
        && typeof owner.token === 'string' && UUID.test(owner.token) ? owner : null;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  function isDead(pid) {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      if (error.code === 'EPERM') return false;
      throw error;
    }
  }

  async function recoverDeadOwner(path) {
    const candidate = await readOwner(path);
    if (!candidate || !isDead(candidate.pid)) return;
    const reaperPath = join(lockDirectory, '.reaper');
    let reaper;
    try {
      reaper = await fs.open(reaperPath, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') return;
      throw error;
    }
    try {
      // All reapers serialize here. Re-read after acquiring the reaper lock so
      // an old observation cannot remove a replacement owner's new lock.
      const current = await readOwner(path);
      if (current && current.token === candidate.token && current.pid === candidate.pid && isDead(current.pid)) {
        await fs.unlink(path);
      }
    } finally {
      try { await reaper.close(); } finally { await fs.unlink(reaperPath); }
    }
  }

  async function withLock(sessionId, operation) {
    await fs.mkdir(lockDirectory, { recursive: true });
    const digest = createHash('sha256').update(sessionId).digest('hex');
    const path = join(lockDirectory, `${digest}.lock`);
    const token = randomUUID();
    const deadline = Date.now() + 10_000;
    let handle;
    while (!handle) {
      try {
        handle = await fs.open(path, 'wx', 0o600);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) {
          throw Object.assign(new Error('Timed out waiting for note lock; owner may still be active or require manual recovery'), { code: 'lock_timeout' });
        }
        await recoverDeadOwner(path);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, token }), 'utf8');
      await handle.sync();
      return await operation();
    } finally {
      // The live owner cannot be reaped. Close then remove only our own lock;
      // also clean up if writing its metadata failed before it was complete.
      try { await handle.close(); } finally { await fs.unlink(path); }
    }
  }

  async function readRecord(sessionId, path = pathFor(sessionId)) {
    let text;
    try {
      text = await fs.readFile(path, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A dangling symlink is an existing, unreadable entry, not an empty note.
      try {
        await fs.lstat(path);
      } catch (statError) {
        if (statError.code === 'ENOENT') return null;
        throw statError;
      }
      throw error;
    }
    let record;
    try {
      record = JSON.parse(text);
    } catch (cause) {
      throw Object.assign(new Error('Invalid note JSON', { cause }), { code: 'invalid_record' });
    }
    return validateRecord(record, sessionId);
  }

  async function commit(sessionId, text, path = pathFor(sessionId), targetDirectory = directory) {
    const record = { version: 1, sessionId, text, revision: randomUUID(), updatedAt: new Date().toISOString() };
    const temporary = `${path}.${randomUUID()}.tmp`;
    let handle;
    let created = false;
    try {
      await fs.mkdir(targetDirectory, { recursive: true });
      handle = await fs.open(temporary, 'wx', 0o600);
      created = true;
      await handle.writeFile(JSON.stringify(record), 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporary, path);
      return record;
    } finally {
      try {
        if (handle) await handle.close();
      } finally {
        if (created) {
          // After rename the temporary entry no longer exists.
          await fs.unlink(temporary).catch(error => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      }
    }
  }

  return {
    async read(sessionId) {
      return serialize(sessionId, () => readRecord(sessionId));
    },
    // null means “create only if absent”; an existing record requires its UUID.
    async write(sessionId, text, expectedRevision) {
      validateText(text);
      validateRevision(expectedRevision);
      return serialize(sessionId, () => withLock(sessionId, async () => {
        const current = await readRecord(sessionId);
        if ((current?.revision ?? null) !== expectedRevision) {
          throw Object.assign(new Error('Note revision conflict'), { code: 'conflict' });
        }
        return commit(sessionId, text);
      }));
    },
    async importLegacy(sessionId, text) {
      validateText(text);
      return serialize(sessionId, () => withLock(sessionId, async () => {
        const current = await readRecord(sessionId);
        if (!current) return commit(sessionId, text);
        if (current.text === text) return current;
        // Preserve a conflicting browser value before acknowledging migration.
        // Hash a structured tuple so different ID/text splits cannot collide.
        const backupDirectory = join(storageRoot, 'legacy-backups');
        const digest = createHash('sha256').update(JSON.stringify([sessionId, text])).digest('hex');
        const backupPath = join(backupDirectory, `${digest}.json`);
        const backup = await readRecord(sessionId, backupPath);
        if (backup && backup.text !== text) {
          throw Object.assign(new Error('Legacy backup content mismatch'), { code: 'invalid_record' });
        }
        if (!backup) await commit(sessionId, text, backupPath, backupDirectory);
        return { ...current, legacyBackup: true };
      }));
    },
  };
}
