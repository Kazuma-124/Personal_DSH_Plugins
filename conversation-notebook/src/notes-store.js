// Only plugin-owned keys are accessed. No conversation content is read.
export function createNotesStore(getStorage, prefix) {
  const entries = new Map();
  const pendingRetries = new Map();
  const keyOf = sessionId => prefix + encodeURIComponent(sessionId);
  function entry(sessionId) {
    let row = entries.get(sessionId);
    if (!row) {
      row = { listeners: new Set(), state: { text: '', status: 'empty' } };
      entries.set(sessionId, row);
      load(sessionId, row);
    }
    return row;
  }
  function emit(row) { for (const listener of row.listeners) listener(); }
  function load(sessionId, row) {
    try {
      const text = getStorage().getItem(keyOf(sessionId));
      row.state = { text: text ?? '', status: text ? 'saved' : 'empty' };
    } catch {
      row.state = { ...row.state, status: 'readError' };
    }
  }
  function save(sessionId, text) {
    const row = entry(sessionId);
    // A failed read must never allow replacing an unknown existing note.
    if (row.state.status === 'readError' || row.state.status === 'retrying') return;
    try {
      getStorage().setItem(keyOf(sessionId), text);
      row.state = { text, status: text === '' ? 'empty' : 'saved' };
    } catch {
      // Keep the current draft visible and explicitly report that it is unsaved.
      row.state = { text, status: 'saveError' };
    }
    emit(row);
  }
  return {
    get: sessionId => entry(sessionId).state,
    subscribe(sessionId, listener) {
      const row = entry(sessionId);
      row.listeners.add(listener);
      return () => row.listeners.delete(listener);
    },
    save,
    retry(sessionId) {
      const row = entry(sessionId);
      if (row.state.status === 'retrying') return pendingRetries.get(sessionId)?.promise;
      const previous = row.state.status;
      row.state = { ...row.state, status: 'retrying' };
      emit(row);
      // Yield one task so the retry state and disabled button reach the UI.
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const timer = setTimeout(() => {
        pendingRetries.delete(sessionId);
        if (previous === 'saveError') {
          row.state = { ...row.state, status: 'saveError' };
          save(sessionId, row.state.text);
        } else { load(sessionId, row); emit(row); }
        resolve();
      }, 0);
      pendingRetries.set(sessionId, { timer, resolve, promise });
      return promise;
    },
    onStorage(event) {
      if (!event.key?.startsWith(prefix)) return;
      // Read only notes that this plugin already has open, never enumerate storage.
      for (const [sessionId, row] of entries) {
        if (keyOf(sessionId) !== event.key || row.state.status === 'saveError' || row.state.status === 'retrying') continue;
        load(sessionId, row);
        emit(row);
      }
    },
    dispose() {
      for (const retry of pendingRetries.values()) { clearTimeout(retry.timer); retry.resolve(); }
      pendingRetries.clear();
      for (const row of entries.values()) row.listeners.clear();
      entries.clear();
    },
  };
}

// Shared state-to-control semantics, testable without a DOM or renderer.
export function noteEditorState(state) {
  const failure = state.status === 'readError' || state.status === 'saveError';
  const retrying = state.status === 'retrying';
  return {
    failure,
    readOnly: state.status === 'readError' || retrying,
    retryVisible: failure || retrying,
    retryDisabled: retrying,
  };
}
