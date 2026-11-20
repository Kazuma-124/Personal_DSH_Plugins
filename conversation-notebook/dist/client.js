// Built, standalone DSH client artifact.
(() => {
// Only plugin-owned keys are accessed. No conversation content is read.
function createNotesStore(getStorage, prefix) {
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
function noteEditorState(state) {
  const failure = state.status === 'readError' || state.status === 'saveError';
  const retrying = state.status === 'retrying';
  return {
    failure,
    readOnly: state.status === 'readError' || retrying,
    retryVisible: failure || retrying,
    retryDisabled: retrying,
  };
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
        label: '当前对话的笔记', empty: '空白笔记 · 输入后自动保存', saved: '已保存',
        saveError: '保存失败。当前内容尚未保存，请保留此页面并重试。',
        readError: '无法读取笔记。请重试，以免覆盖已有内容。',
        retry: '重试', retrying: '正在重试…', persistence: '保存在此设备的当前浏览器中',
      },
      en: {
        title: 'Conversation notebook', description: 'A separate note for this conversation. Edit manually; changes save automatically.',
        scope: 'Only for this conversation', placeholder: 'Start here. Write down your thoughts…',
        label: 'Note for the current conversation', empty: 'Blank note · Saves as you type', saved: 'Saved',
        saveError: 'Could not save. Keep this page open and retry to preserve your draft.',
        readError: 'Could not read the note. Retry before editing to protect existing content.',
        retry: 'Retry', retrying: 'Retrying…', persistence: 'Stored in this browser on this device',
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
          const notes = createNotesStore(() => window.localStorage, ID + ':v1:session:');
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
            return h('section', { className: 'cn-e1727a2d', 'aria-label': t('title') },
              h('style', null, css),
              h('div', { className: 'cn-e1727a2d-head' }, t('scope')),
              h('textarea', {
                // Remount on session changes so selection/undo cannot leak between notes.
                key: sessionId, className: 'cn-e1727a2d-editor', 'aria-label': t('label'),
                placeholder: t('placeholder'), value: state.text, readOnly, 'aria-invalid': failure,
                'aria-busy': state.status === 'retrying',
                spellCheck: true, onChange: event => notes.save(sessionId, event.target.value),
              }),
              h('div', { className: 'cn-e1727a2d-footer' },
                h('span', { className: failure ? 'cn-e1727a2d-error' : undefined,
                  role: failure ? 'alert' : 'status', 'aria-live': failure ? 'assertive' : 'polite' }, t(state.status)),
                retryVisible && h('button', { type: 'button', className: 'cn-e1727a2d-retry', disabled: retryDisabled,
                  onClick: () => notes.retry(sessionId) }, t(retryDisabled ? 'retrying' : 'retry'))),
              state.status === 'readError' && h('div', { className: 'cn-e1727a2d-hint cn-e1727a2d-error' }, t('readError')),
              state.text === '' && h('div', { className: 'cn-e1727a2d-hint' }, t('persistence')));
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
          const storageChanged = event => notes.onStorage(event);
          window.addEventListener('storage', storageChanged);
          return () => {
            // Stop listeners before touching tabs; close only this plugin's exact kind.
            window.removeEventListener('storage', storageChanged);
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
