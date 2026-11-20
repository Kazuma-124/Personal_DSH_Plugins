import { createNotesStore, noteEditorState } from './notes-store.js';

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
