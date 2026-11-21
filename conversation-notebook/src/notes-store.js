// Shared asynchronous state. Durable acknowledgements alone mark a note saved.
export function createNotesStore(api) {
  const entries = new Map();
  let disposed = false;
  function emit(row) { if (!disposed) for (const listener of row.listeners) listener(); }
  function set(row, status) { row.state = { text: row.state.text, status }; emit(row); }
  function entry(id) {
    let row = entries.get(id);
    if (!row) {
      row = { state: { text: '', status: 'loading' }, listeners: new Set(), revision: null, generation: 0, dirty: false, pending: null };
      entries.set(id, row);
      row.pending = load(id, row);
    }
    return row;
  }
  async function load(id, row) {
    await Promise.resolve();
    try {
      const record = await api.read(id);
      row.revision = record?.revision ?? null;
      row.state = { text: record?.text ?? '', status: record?.text ? 'saved' : 'empty' };
    } catch { set(row, 'readError'); }
    finally { row.pending = null; emit(row); }
  }
  async function drain(id, row) {
    // Run after pending is installed, including when a transport throws synchronously.
    await Promise.resolve();
    while (row.dirty) {
      const generation = row.generation;
      const text = row.state.text;
      set(row, 'saving');
      try {
        const record = await api.write(id, text, row.revision);
        row.revision = record.revision;
        if (generation === row.generation) {
          row.dirty = false;
          set(row, text === '' ? 'empty' : 'saved');
        }
      } catch (error) {
        set(row, error?.code === 'conflict' ? 'conflict' : 'saveError');
        break;
      }
    }
    row.pending = null;
  }
  const store = {
    get: id => entry(id).state,
    subscribe(id, listener) { const row = entry(id); row.listeners.add(listener); return () => row.listeners.delete(listener); },
    ready(id) { const row = entry(id); return row.pending ?? Promise.resolve(); },
    save(id, text) {
      const row = entry(id);
      if (['loading', 'readError', 'retrying', 'conflict'].includes(row.state.status)) return;
      row.state = { text, status: 'saving' };
      row.generation++;
      row.dirty = true;
      emit(row);
      if (!row.pending) row.pending = drain(id, row);
    },
    retry(id) {
      const row = entry(id);
      if (row.pending) return row.pending;
      if (row.state.status === 'conflict') return Promise.resolve();
      const reading = row.state.status === 'readError';
      set(row, 'retrying');
      row.pending = Promise.resolve().then(() => reading ? load(id, row) : drain(id, row));
      return row.pending;
    },
    // Conflicts require an explicit reload; never silently replace a newer note.
    reload(id) {
      const row = entry(id);
      if (row.pending) return row.pending;
      row.dirty = false;
      set(row, 'loading');
      row.pending = load(id, row);
      return row.pending;
    },
    hasUnsaved() { return [...entries.values()].some(row => row.dirty); },
    dispose() {
      disposed = true;
      // Already queued saves continue so closing a sidebar does not discard edits.
      for (const row of entries.values()) row.listeners.clear();
      entries.clear();
    },
  };
  return store;
}

export function noteEditorState(state) {
  const failure = ['readError', 'saveError', 'conflict'].includes(state.status);
  return {
    failure,
    readOnly: ['loading', 'readError', 'retrying', 'conflict'].includes(state.status),
    retryVisible: ['readError', 'saveError', 'retrying'].includes(state.status),
    retryDisabled: state.status === 'retrying',
  };
}

// Read values only inside this plugin's old namespace. Keep the originals as a backup.
export async function migrateLegacyNotes(getStorage, prefix, api) {
  let storage;
  try { storage = getStorage(); } catch { return { status: 'unavailable', count: 0 }; }
  const notes = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const id = decodeURIComponent(key.slice(prefix.length));
      const text = storage.getItem(key);
      if (text !== null) notes.push([id, text]);
    }
  } catch { throw new Error('Cannot read existing browser notes'); }
  let count = 0;
  const failedIds = [];
  for (const [id, text] of notes) {
    try { await api.importLegacy(id, text); count++; }
    catch { failedIds.push(id); }
  }
  if (failedIds.length) throw Object.assign(new Error('Some browser notes could not be migrated'), { failedIds, count });
  return { status: 'done', count };
}
