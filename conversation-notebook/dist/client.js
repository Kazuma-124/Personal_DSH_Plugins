// Built, standalone DSH client artifact.
(() => {
// Shared asynchronous state. Durable acknowledgements alone mark a note saved.
function createNotesStore(api) {
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

function noteEditorState(state) {
  const failure = ['readError', 'saveError', 'conflict'].includes(state.status);
  return {
    failure,
    readOnly: ['loading', 'readError', 'retrying', 'conflict'].includes(state.status),
    retryVisible: ['readError', 'saveError', 'retrying'].includes(state.status),
    retryDisabled: state.status === 'retrying',
  };
}

// Read values only inside this plugin's old namespace. Keep the originals as a backup.
async function migrateLegacyNotes(getStorage, prefix, api) {
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



window.__ModuleLoader__.load({
  id: '@dsh-local/view-e1727a2d-8dfb-4483-8fd4-2a5078b2229e',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ID = '@dsh-local/view-e1727a2d-8dfb-4483-8fd4-2a5078b2229e:notebook';
    const NS = 'conversationNotebookE1727a2d';
    const dictionaries = {
      zh: {
        title: '对话记事本', description: '此对话的独立笔记，手动编辑并自动保存。',
        scope: '仅属于当前对话', placeholder: '从这里开始，记下你的想法…',
        label: '当前对话的笔记', empty: '空白笔记 · 输入后自动保存', saved: '已保存到磁盘',
        loading: '正在读取笔记并迁移旧数据…', saving: '正在保存…',
        saveError: '保存失败。当前内容尚未保存，请保留此页面并重试。',
        readError: '无法读取笔记或迁移旧数据。请重试，以免覆盖已有内容。',
        conflict: '另一窗口已更新此笔记。当前草稿已保留，请先复制草稿，再加载最新版本。',
        reload: '加载最新版本', confirmReload: '加载最新版本将替换当前草稿。请确认已复制需要保留的文字。',
        migrationError: '部分旧笔记尚未迁移，请重试。迁移完成前请勿清除浏览器数据。',
        migrationUnavailable: '无法访问浏览器旧数据。磁盘笔记可正常使用；若以前有旧笔记，请先恢复浏览器存储访问。',
        migrationRetry: '重试旧笔记迁移', migrationRunning: '正在迁移旧笔记，请暂勿清除浏览器数据…',
        retry: '重试', retrying: '正在重试…', persistence: '保存在本机磁盘，清除浏览器数据不会删除已保存的笔记',
      },
      en: {
        title: 'Conversation notebook', description: 'A separate note for this conversation. Edit manually; changes save automatically.',
        scope: 'Only for this conversation', placeholder: 'Start here. Write down your thoughts…',
        label: 'Note for the current conversation', empty: 'Blank note · Saves as you type', saved: 'Saved to disk',
        loading: 'Loading notes and migrating old data…', saving: 'Saving…',
        saveError: 'Could not save. Keep this page open and retry to preserve your draft.',
        readError: 'Could not read the note or migrate old data. Retry to protect existing content.',
        conflict: 'Another window updated this note. Your draft is retained. Copy it before loading the latest version.',
        reload: 'Load latest version', confirmReload: 'Loading the latest version replaces this draft. Copy any text you want to keep first.',
        migrationError: 'Some old notes still need migration. Retry before clearing browser data.',
        migrationUnavailable: 'Old browser storage is inaccessible. Disk notes work; restore browser storage access if you have old notes.',
        migrationRetry: 'Retry old note migration', migrationRunning: 'Migrating old notes. Please keep browser data until migration completes…',
        retry: 'Retry', retrying: 'Retrying…', persistence: 'Stored on this device’s disk; clearing browser data does not delete saved notes',
      },
    };
    function NotebookIcon({ size = 16, className } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': true, className, style: { flexShrink: 0 } },
      h('rect', { x: 5, y: 3, width: 15, height: 18, rx: 2, stroke: 'currentColor', strokeWidth: 1.5 }),
      h('path', { d: 'M8 3v18M3 7h4M3 12h4M3 17h4M11 8h6M11 12h6M11 16h4',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }));
    }
    const css = `
      .cn-e1727a2d { display:flex; flex-direction:column; height:100%; min-height:0; min-width:0;
        color:var(--dsw-alias-label-primary); background:transparent; font:inherit; }
      .cn-e1727a2d-head { display:flex; align-items:center; min-height:38px; box-sizing:border-box;
        padding:8px 16px; border-bottom:0.5px solid var(--dsw-alias-border-l3);
        font-size:12px; color:var(--dsw-alias-label-secondary); }
      .cn-e1727a2d-editor { flex:1 1 auto; width:100%; min-height:120px; min-width:0; box-sizing:border-box;
        resize:none; border:0; border-radius:0; outline-offset:-3px; padding:16px;
        background:transparent; color:var(--dsw-alias-label-primary);
        font-family:inherit; font-size:14px; line-height:1.75; }
      .cn-e1727a2d-editor[aria-invalid="true"] { border:1px solid var(--dsw-alias-state-error-primary); }
      .cn-e1727a2d-error, .cn-e1727a2d-hint.cn-e1727a2d-error { color:var(--dsw-alias-state-error-primary); }
      .cn-e1727a2d-retry:disabled { cursor:wait; opacity:0.6; }
      .cn-e1727a2d-editor::placeholder { color:var(--dsw-alias-label-secondary); opacity:0.8; }
      .cn-e1727a2d-editor:focus-visible { outline:2px solid var(--dsw-alias-label-secondary); }
      .cn-e1727a2d-footer { flex:0 0 auto; display:flex; flex-wrap:wrap; align-items:center; gap:8px;
        padding:10px 16px; border-top:0.5px solid var(--dsw-alias-border-l3);
        font-size:12px; line-height:1.5; color:var(--dsw-alias-label-secondary); }
      .cn-e1727a2d-hint { padding:0 16px 10px; font-size:11px; color:var(--dsw-alias-label-secondary); }
      .cn-e1727a2d-retry { font:inherit; color:var(--dsw-alias-label-primary); cursor:pointer;
        border:1px solid var(--dsw-alias-border-l3); border-radius:6px; padding:4px 10px;
        background:var(--dsw-alias-bg-layer-2); }
      .cn-e1727a2d-retry:focus-visible { outline:2px solid var(--dsw-alias-label-secondary); outline-offset:2px; }
    `;
    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        ctx.effect(() => {
          async function request(action, input) {
            const response = await window.fetch('/api/conversation-notebook/' + action, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(input), cache: 'no-store', signal: AbortSignal.timeout(30000),
            });
            const result = await response.json();
            if (!response.ok) throw Object.assign(new Error(result.error?.message || 'Notebook request failed'), { code: result.error?.code });
            if (!Object.hasOwn(result, 'record')) throw new Error('Invalid notebook response');
            return result.record;
          }
          const backend = {
            read: sessionId => request('read', { sessionId }),
            write: (sessionId, text, revision) => request('write', { sessionId, text, revision }),
            importLegacy: (sessionId, text) => request('import', { sessionId, text }),
          };
          let migration;
          let migrationStatus = 'running';
          const migrationListeners = new Set();
          const setMigrationStatus = value => { migrationStatus = value; for (const notify of migrationListeners) notify(); };
          function ensureMigrated() {
            if (!migration) {
              setMigrationStatus('running');
              migration = migrateLegacyNotes(() => window.localStorage, ID + ':v1:session:', backend)
                .then(result => { setMigrationStatus(result.status); return result; })
                .catch(error => { migration = null; setMigrationStatus('error'); throw error; });
            }
            return migration;
          }
          const notes = createNotesStore({ ...backend, read: async sessionId => {
            try { await ensureMigrated(); }
            catch (error) {
              // A failed old note blocks only its own editor. Other notes remain usable.
              if (!error.failedIds || error.failedIds.includes(sessionId)) throw error;
            }
            return backend.read(sessionId);
          } });
          // Migrate every owned old key, including unopened and archived notes.
          // A failure remains retryable when the editor next loads.
          ensureMigrated().catch(() => {});
          const disposeLocale = ctx.locale.register(NS, dictionaries);
          const boundT = ctx.locale.bind(NS);
          const t = boundT;
          function Body(props) {
            const { sessionId } = props;
            const t = props.t ?? boundT;
            const subscribe = React.useCallback(listener => notes.subscribe(sessionId, listener), [sessionId]);
            const snapshot = React.useCallback(() => notes.get(sessionId), [sessionId]);
            const state = React.useSyncExternalStore(subscribe, snapshot, snapshot);
            const { failure, readOnly, retryVisible, retryDisabled } = noteEditorState(state);
            const migrationState = React.useSyncExternalStore(
              React.useCallback(notify => { migrationListeners.add(notify); return () => migrationListeners.delete(notify); }, []),
              () => migrationStatus, () => migrationStatus);
            return h('section', { className: 'cn-e1727a2d', 'aria-label': t('title') },
              h('style', null, css),
              h('div', { className: 'cn-e1727a2d-head' }, t('scope')),
              h('textarea', {
                // Remount on session changes so selection/undo cannot leak between notes.
                key: sessionId, className: 'cn-e1727a2d-editor', 'aria-label': t('label'),
                placeholder: t('placeholder'), value: state.text, readOnly, 'aria-invalid': failure,
                'aria-busy': ['loading', 'retrying', 'saving'].includes(state.status),
                spellCheck: true, onChange: event => notes.save(sessionId, event.target.value),
              }),
              h('div', { className: 'cn-e1727a2d-footer' },
                h('span', { className: failure ? 'cn-e1727a2d-error' : undefined,
                  role: failure ? 'alert' : 'status', 'aria-live': failure ? 'assertive' : 'polite' }, t(state.status)),
                retryVisible && h('button', { type: 'button', className: 'cn-e1727a2d-retry', disabled: retryDisabled,
                  onClick: () => notes.retry(sessionId) }, t(retryDisabled ? 'retrying' : 'retry')),
                state.status === 'conflict' && h('button', { type: 'button', className: 'cn-e1727a2d-retry',
                  onClick: () => { if (window.confirm(t('confirmReload'))) notes.reload(sessionId); } }, t('reload'))),
              state.status === 'readError' && h('div', { className: 'cn-e1727a2d-hint cn-e1727a2d-error' }, t('readError')),
              state.text === '' && h('div', { className: 'cn-e1727a2d-hint' }, t('persistence')),
              migrationState !== 'done' && h('div', { className: 'cn-e1727a2d-hint', role: 'status', 'aria-live': 'polite' },
                t(migrationState === 'running' ? 'migrationRunning' : migrationState === 'unavailable' ? 'migrationUnavailable' : 'migrationError'),
                migrationState !== 'running' && h('button', { type: 'button', className: 'cn-e1727a2d-retry',
                  onClick: () => { migration = null; ensureMigrated().then(() => {
                    if (notes.get(sessionId).status === 'readError') notes.retry(sessionId);
                  }).catch(() => {}); } }, t('migrationRetry'))));
          }
          function Title(props) {
            const t = props.t ?? boundT;
            return h(React.Fragment, null, h(NotebookIcon), h('span', { style: { marginInlineStart: 6 } }, t('title')));
          }
          const disposeType = ctx.sidebarRightTabs.register({
            id: ID, kind: ID, title: () => t('title'),
            guide: [{ id: ID + ':entry', order: 50, title: () => t('title'),
              description: () => t('description'), icon: NotebookIcon }],
          });
          const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
            { name: 'sidebar.right.pane.tab', key: ID, locale: NS }, Body));
          const disposeTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
            { name: 'sidebar.right.pane.tab.title', key: ID, locale: NS }, Title));
          const beforeUnload = event => {
            if (notes.hasUnsaved()) { event.preventDefault(); event.returnValue = ''; }
          };
          window.addEventListener('beforeunload', beforeUnload);
          return () => {
            // Stop listeners before touching tabs; close only this plugin's exact kind.
            window.removeEventListener('beforeunload', beforeUnload);
            for (const tab of ctx.sidebarRight.openTabs.getSnapshot()) {
              if (tab.kind === ID) {
                try { ctx.sidebarRight.closeIn(tab.sessionId, tab.tabId); }
                catch { /* One stale or failing tab must not block remaining cleanup. */ }
              }
            }
            disposeTitle();
            disposeBody();
            disposeType();
            disposeLocale();
            notes.dispose();
          };
        });
      },
    };
  },
});

})();
