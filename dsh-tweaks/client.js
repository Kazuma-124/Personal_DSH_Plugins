// Browser half of the package: small quality-of-life tweaks for the DSH web
// interface. Each tweak is independent; they share this package because all of
// them adjust the same interface.
//
// - One control on every plugin page of the Plugins manager that reveals the
//   package directory in the host's file manager.
// - A per-Session "mark as unread" reminder: the Session row menu sets a mark,
//   the row shows an unread dot while the mark exists, and opening that Session
//   clears it. Marks live in this browser's storage because the Session
//   Controller keeps no durable per-Session flag for a personal reminder.
window.__ModuleLoader__.load({
  id: '@kazuma-124/dsh-tweaks',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = '@kazuma-124/dsh-tweaks';
    const UNREAD_ICON_KEY = 'tweaks.unread';
    /** Browser storage key; the version suffix leaves room for a format change. */
    const UNREAD_STORAGE_KEY = 'dsh.tweaks.unread.v1';
    /** Marks written under the package's former name are carried over once. */
    const LEGACY_UNREAD_STORAGE_KEY = 'dsh.plugin-actions.unread.v1';
    /** Upper bound for stored ids, so a long-lived or corrupted store stays small. */
    const MAX_UNREAD_SESSIONS = 500;
    const MAX_SESSION_ID_LENGTH = 200;
    const dictionaries = {
      zh: {
        reveal: '打开所在文件夹',
        opening: '正在打开…',
        revealFailed: '无法打开该插件的文件夹。内置插件没有可打开的目录。',
        markUnread: '标为未读',
        clearUnread: '取消未读标记',
        markedNotice: '已标为未读',
        clearedNotice: '已取消未读标记',
        unreadBadge: '未读',
        unreadStoreFailed: '无法保存未读状态。',
      },
      en: {
        reveal: 'Open containing folder',
        opening: 'Opening…',
        revealFailed: 'Could not open this plugin folder. Built-in plugins have no folder to open.',
        markUnread: 'Mark as unread',
        clearUnread: 'Clear unread mark',
        markedNotice: 'Marked as unread',
        clearedNotice: 'Unread mark cleared',
        unreadBadge: 'Unread',
        unreadStoreFailed: 'Could not save the unread state.',
      },
    };

    const actionsStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    };
    const actionButtonStyle = {
      font: 'inherit',
      fontSize: 13,
      lineHeight: 1.4,
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-layer-2)',
      border: '1px solid var(--dsw-alias-border-l3)',
      borderRadius: 6,
      padding: '4px 10px',
      cursor: 'pointer',
    };
    const noteStyle = {
      fontSize: 12,
      lineHeight: 1.5,
      color: 'var(--dsw-alias-label-secondary)',
    };
    // The trailing cell centers one 10px marker; the dot itself matches the
    // size and color of the row's own finished-but-unviewed status dot.
    const unreadMarkerStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 'none',
      width: 10,
      height: 20,
    };
    const unreadDotStyle = {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'var(--dsw-alias-state-success-primary)',
    };

    function readStoredMarks(key) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter(sessionId => typeof sessionId === 'string'
            && sessionId.length > 0
            && sessionId.length <= MAX_SESSION_ID_LENGTH)
          .slice(-MAX_UNREAD_SESSIONS);
      } catch {
        return [];
      }
    }

    function readUnreadMarks() {
      const current = readStoredMarks(UNREAD_STORAGE_KEY);
      if (current.length > 0) return current;
      const legacy = readStoredMarks(LEGACY_UNREAD_STORAGE_KEY);
      if (legacy.length === 0) return [];
      try {
        window.localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(legacy));
        window.localStorage.removeItem(LEGACY_UNREAD_STORAGE_KEY);
      } catch { /* keep the legacy copy readable when the new key cannot be written */ }
      return legacy;
    }

    function createUnreadMarks() {
      let ids = new Set(readUnreadMarks());
      const listeners = new Set();
      const publish = () => {
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch { /* one failing listener must not break the others */ }
        }
      };
      const persist = () => {
        try {
          window.localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify([...ids]));
          return true;
        } catch {
          return false;
        }
      };
      return {
        has: sessionId => ids.has(sessionId),
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        /**
         * Set or clear one Session's mark and persist the result.
         * @returns whether the browser storage accepted the write; the in-memory value changes either way.
         */
        set(sessionId, marked) {
          if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
          if (marked === ids.has(sessionId)) return true;
          if (marked) {
            ids.add(sessionId);
            if (ids.size > MAX_UNREAD_SESSIONS) ids = new Set([...ids].slice(-MAX_UNREAD_SESSIONS));
          } else {
            ids.delete(sessionId);
          }
          const persisted = persist();
          publish();
          return persisted;
        },
      };
    }

    const unreadMarks = createUnreadMarks();

    /** Menu glyph for the reminder: a ring around a filled dot. */
    function UnreadIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        fill: 'none',
        'aria-hidden': true,
      },
        h('circle', { cx: 8, cy: 8, r: 6, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('circle', { cx: 8, cy: 8, r: 2.4, fill: 'currentColor' }));
    }

    /** Open-ish sessions, read from the Session list snapshot. */
    function openSessionIds(sessions) {
      if (sessions === undefined) return new Set();
      const list = sessions.list.getSnapshot();
      const open = new Set();
      for (const sessionId of list.ids ?? []) {
        const row = list.byId?.[sessionId];
        if (row && (row.retainedBy?.mainView ?? 0) > 0) open.add(sessionId);
      }
      return open;
    }

    /**
     * Trailing-row reminder: shows the unread dot while the Session is marked,
     * is not the conversation currently open in the main area, and carries no
     * host unread dot of its own.
     */
    function UnreadMark({ sessionId, t, useSessionStatus, useSessionRetainInfo }) {
      const marked = React.useSyncExternalStore(unreadMarks.subscribe, () => unreadMarks.has(sessionId));
      // Both standard hooks arrived in DSH releases this plugin permits; read
      // them defensively so an older composition loses the marker, not the row.
      const open = typeof useSessionRetainInfo === 'function'
        ? useSessionRetainInfo(sessionId, info => (info?.retainedBy.mainView ?? 0) > 0)
        : false;
      const hostUnread = typeof useSessionStatus === 'function'
        ? useSessionStatus(statuses => statuses.get(sessionId)?.completionUnread === true)
        : false;
      if (!marked || open || hostUnread) return null;
      const label = t('unreadBadge');
      return h('span', {
        style: unreadMarkerStyle,
        'data-session-unread-mark': '',
        role: 'img',
        'aria-label': label,
      }, h('span', { style: unreadDotStyle }));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries));

        // A mark is dropped when its Session *enters* the main view, so the
        // reminder survives a restart that restores that Session as the open
        // conversation and is consumed when the user opens it again. Sessions
        // already open on the first snapshot are only recorded, not cleared.
        ctx.inject(['sessions'], sessionCtx => {
          sessionCtx.effect(() => {
            let openSessions = null;
            const reconcile = () => {
              const list = sessionCtx.sessions.list.getSnapshot();
              if (list.phase !== 'ready') return;
              const current = openSessionIds(sessionCtx.sessions);
              if (openSessions === null) {
                openSessions = current;
                return;
              }
              for (const sessionId of current) {
                if (!openSessions.has(sessionId)) unreadMarks.set(sessionId, false);
              }
              openSessions = current;
            };
            const dispose = sessionCtx.sessions.list.subscribe(reconcile);
            reconcile();
            return dispose;
          });
        });

        // Archived Sessions keep no row indicator in the host, so a mark on one
        // is dropped instead of waiting invisibly. The same set hides the menu
        // entry for archived rows.
        let archivedSessionIds = () => [];
        ctx.inject(['workspaces'], workspaceCtx => {
          archivedSessionIds = () => {
            const state = workspaceCtx.workspaces.list.getSnapshot();
            return state.phase === 'ready' && Array.isArray(state.archivedSessionIds)
              ? state.archivedSessionIds
              : [];
          };
          workspaceCtx.effect(() => {
            const reconcile = () => {
              for (const sessionId of archivedSessionIds()) unreadMarks.set(sessionId, false);
            };
            reconcile();
            return workspaceCtx.workspaces.list.subscribe(reconcile);
          });
        });

        // The menu service supplies both the row menu entry and the shared
        // notice; without it the marks are still readable but not editable.
        ctx.inject(['contextMenus'], menuCtx => {
          const t = menuCtx.locale.bind(NS);
          const notify = (text, success) => {
            if (typeof menuCtx.contextMenus.notify === 'function') menuCtx.contextMenus.notify(text, success);
          };
          menuCtx.effect(() => menuCtx.contextMenus.register({
            id: 'tweaks-mark-unread',
            target: 'session',
            // After the pin/rename/fork group, before the identification group.
            order: 350,
            resolve(target) {
              if (archivedSessionIds().includes(target.sessionId)) return [];
              const marked = unreadMarks.has(target.sessionId);
              return [{
                id: marked ? 'clear-unread-mark' : 'mark-unread',
                label: t(marked ? 'clearUnread' : 'markUnread'),
                icon: { key: UNREAD_ICON_KEY },
                run: () => {
                  const next = !marked;
                  // The row marker hides while the pointer rests on the row, so
                  // the shared notice confirms the change the moment it is made.
                  if (unreadMarks.set(target.sessionId, next)) {
                    notify(t(next ? 'markedNotice' : 'clearedNotice'), true);
                  } else {
                    notify(t('unreadStoreFailed'), false);
                  }
                },
              }];
            },
          }));
        });

        ctx.effect(() => {
          const disposed = { current: false };

          function RevealAction(props) {
            const t = props.t;
            const subject = props.subject;
            const pkg = subject && (subject.kind === 'bundle' || subject.kind === 'row') ? subject.pkg : null;
            const [state, setState] = React.useState('idle');
            if (!pkg) return null;
            const reveal = async () => {
              setState('opening');
              try {
                const response = await window.fetch('/api/tweaks/reveal', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ packageName: pkg.name }),
                  cache: 'no-store',
                  signal: AbortSignal.timeout(15000),
                });
                if (!response.ok) throw new Error('reveal failed');
                if (!disposed.current) setState('done');
              } catch {
                if (!disposed.current) setState('failed');
              }
            };
            return h('div', { style: actionsStyle },
              h('button', {
                type: 'button',
                style: { ...actionButtonStyle, opacity: state === 'opening' ? 0.6 : 1 },
                disabled: state === 'opening',
                onClick: reveal,
              }, state === 'opening' ? t('opening') : t('reveal')),
              state === 'failed' && h('span', { style: noteStyle, role: 'status' }, t('revealFailed')));
          }

          const disposeActions = ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
            name: 'plugins.detail.actions',
            id: 'tweaks-reveal',
            order: 20,
            locale: NS,
          }, RevealAction));

          const disposeUnread = ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
            name: 'sidebar.session.row.trailing',
            id: 'tweaks-unread',
            order: 20,
            locale: NS,
          }, UnreadMark));

          const disposeIcon = ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({
            name: 'contextMenu.icon',
            key: UNREAD_ICON_KEY,
          }, UnreadIcon));

          return () => {
            disposed.current = true;
            disposeIcon();
            disposeUnread();
            disposeActions();
          };
        });
      },
    };
  },
});
