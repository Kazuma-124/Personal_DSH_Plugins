// Browser half of workspace-session-migration: one sidebar page that lists
// Workspaces and their Sessions and drives the same migration operation the
// Agent tools use, through the authenticated Host route.
window.__ModuleLoader__.load({
  id: '@kazuma-124/dsh-workspace-session-migration',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = '@kazuma-124/dsh-workspace-session-migration';
    const PANEL_ID = 'workspace-session-migration';
    const API = '/api/workspace-session-migration/';

    const dictionaries = {
      zh: {
        nav: '工作区迁移',
        title: '工作区会话迁移',
        lead: '把对话复制到另一个工作区：保留标题、创建时间和全部历史，并移除原会话。DSH 无法修改已有会话的工作目录，因此新会话会获得新的 Session ID。',
        source: '源工作区',
        target: '目标工作区',
        path: '目录',
        missingDir: '目录不存在',
        sourceMissingHint: '该工作区目录已不存在；迁移只读取会话日志，仍可作为源工作区。',
        noSource: '没有包含会话的工作区。',
        noTarget: '没有可用的目标工作区；目标目录必须存在。',
        refresh: '刷新',
        selectAll: '全选可迁移',
        clear: '清除选择',
        selected: '已选',
        keepOriginal: '保留原日志并归档原会话（不移动文件）',
        keepOriginalHint: '默认把原日志移到会话根目录同级的 session-migration-backups；勾选后原会话仍可取消归档找回。',
        dryRun: '预演',
        migrate: '开始迁移',
        busy: '处理中…',
        untitled: '（无标题会话）',
        archived: '已归档',
        pinned: '已置顶',
        open: '打开中',
        needsUpgrade: '需升级格式',
        subagent: '子代理',
        reasonOpen: '会话正在 DSH 中打开，先关闭再迁移。',
        reasonFormat: '会话需要格式升级，先在 DSH 中打开一次。',
        reasonSubagent: '子代理会话默认不迁移。',
        reasonNoLog: '会话还没有落盘日志。',
        planTitle: '预演：将迁移',
        planEmpty: '预演没有产生可执行的迁移计划。',
        resultTitle: '迁移结果',
        migrated: '已迁移',
        skipped: '已跳过',
        failed: '失败',
        newSession: '新会话',
        backup: '备份位置',
        originalArchived: '原会话已归档',
        originalMoved: '原日志已移到备份',
        errorTitle: '操作失败',
        retry: '重试',
        emptySelection: '请至少选择一个会话。',
        loading: '正在读取工作区和会话…',
        note: '归档和置顶状态会复制到新会话；备份不会自动清理。',
      },
      en: {
        nav: 'Workspace migration',
        title: 'Workspace session migration',
        lead: 'Copy a conversation into another workspace with its title, creation time, and full history, then remove the original. DSH cannot change an existing session working directory, so the new session gets a new Session ID.',
        source: 'Source workspace',
        target: 'Target workspace',
        path: 'Directory',
        missingDir: 'directory missing',
        sourceMissingHint: 'This workspace directory is missing; migration reads stored session logs, so it still works as a source.',
        noSource: 'No workspace contains sessions.',
        noTarget: 'No usable target workspace; its directory must exist.',
        refresh: 'Refresh',
        selectAll: 'Select migratable',
        clear: 'Clear selection',
        selected: 'selected',
        keepOriginal: 'Keep the original log and archive the original session',
        keepOriginalHint: 'By default the original log moves to session-migration-backups beside the session root. With this checked it stays in place and can be unarchived later.',
        dryRun: 'Dry run',
        migrate: 'Migrate',
        busy: 'Working…',
        untitled: '(untitled session)',
        archived: 'Archived',
        pinned: 'Pinned',
        open: 'Open',
        needsUpgrade: 'Format upgrade',
        subagent: 'Subagent',
        reasonOpen: 'This session is open in DSH; close it before migrating.',
        reasonFormat: 'This session needs a format upgrade; open it once in DSH first.',
        reasonSubagent: 'Subagent sessions are not migrated by default.',
        reasonNoLog: 'This session has no stored log yet.',
        planTitle: 'Dry run: would migrate',
        planEmpty: 'The dry run produced no executable migration plan.',
        resultTitle: 'Migration result',
        migrated: 'Migrated',
        skipped: 'Skipped',
        failed: 'Failed',
        newSession: 'New session',
        backup: 'Backup',
        originalArchived: 'Original archived',
        originalMoved: 'Original log moved to backup',
        errorTitle: 'Operation failed',
        retry: 'Retry',
        emptySelection: 'Select at least one session.',
        loading: 'Reading workspaces and sessions…',
        note: 'Archived and pinned state is copied to the new session; backups are never deleted automatically.',
      },
    };

    const styles = {
      page: {
        height: '100%',
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: '32px 24px 56px',
        color: 'var(--dsw-alias-label-primary)',
      },
      wrap: { maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 },
      title: { margin: 0, fontSize: 20, lineHeight: 1.3, fontWeight: 600 },
      lead: { margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' },
      card: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 },
      field: { display: 'flex', flexDirection: 'column', gap: 6 },
      label: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
      select: {
        font: 'inherit',
        fontSize: 13,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        padding: '7px 9px',
      },
      hint: { fontSize: 11, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' },
      toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
      button: {
        font: 'inherit',
        fontSize: 13,
        lineHeight: 1.4,
        color: 'var(--dsw-alias-label-primary)',
        background: 'transparent',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '6px 12px',
        cursor: 'pointer',
      },
      primary: {
        font: 'inherit',
        fontSize: 13,
        lineHeight: 1.4,
        color: '#fff',
        background: 'var(--dsw-alias-brand-primary)',
        border: '1px solid var(--dsw-alias-brand-primary)',
        borderRadius: 6,
        padding: '6px 14px',
        cursor: 'pointer',
      },
      disabled: { opacity: 0.5, cursor: 'default' },
      list: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        maxHeight: 360,
        overflowY: 'auto',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      row: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      firstRow: { borderTop: 'none' },
      rowMain: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 },
      rowTitle: { fontSize: 13, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      rowHint: { fontSize: 11, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
      badges: { display: 'flex', flexWrap: 'wrap', gap: 4 },
      badge: {
        fontSize: 10,
        lineHeight: 1.6,
        padding: '0 6px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      checkboxRow: { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.6 },
      count: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      error: {
        border: '1px solid var(--dsw-alias-state-error-primary)',
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 12,
        lineHeight: 1.6,
        color: 'var(--dsw-alias-state-error-primary)',
        whiteSpace: 'pre-wrap',
      },
      success: { fontSize: 12, lineHeight: 1.7, color: 'var(--dsw-alias-state-success-primary)' },
      resultList: { display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' },
      resultItem: {
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 12,
        lineHeight: 1.6,
      },
      code: { fontFamily: 'var(--ds-font-family-code)', fontSize: 11, wordBreak: 'break-all' },
    };

    function isEligible(session) {
      return session.stored === true
        && session.open !== true
        && session.formatStatus !== 'migration-required'
        && session.subagent !== true;
    }

    function sessionTitle(session, t) {
      return typeof session.title === 'string' && session.title.trim() !== '' ? session.title : t('untitled');
    }

    /** Distinguish workspaces by title, canonical directory, and missing-directory state. */
    function workspaceOptionLabel(workspace, t) {
      const missing = workspace.status === 'ok' ? '' : ` (${t('missingDir')})`;
      return `${workspace.title} — ${workspace.path}${missing}`;
    }

    function ineligibleReason(session, t) {
      if (session.stored !== true) return t('reasonNoLog');
      if (session.open === true) return t('reasonOpen');
      if (session.formatStatus === 'migration-required') return t('reasonFormat');
      if (session.subagent === true) return t('reasonSubagent');
      return null;
    }

    function badge(text) {
      return h('span', { style: styles.badge, key: text }, text);
    }

    function SessionBadges({ session, t }) {
      const children = [];
      if (session.archived) children.push(badge(t('archived')));
      if (session.pinned) children.push(badge(t('pinned')));
      if (session.open) children.push(badge(t('open')));
      if (session.formatStatus === 'migration-required') children.push(badge(t('needsUpgrade')));
      if (session.subagent) children.push(badge(t('subagent')));
      return children.length === 0 ? null : h('div', { style: styles.badges }, children);
    }

    function ResultView({ result, t }) {
      if (!result) return null;
      if (result.dryRun) {
        const planned = Array.isArray(result.planned) ? result.planned : [];
        return h('section', { style: styles.card },
          h('h2', { style: styles.title }, `${t('planTitle')}: ${planned.length}`),
          planned.length === 0
            ? h('p', { style: styles.hint }, t('planEmpty'))
            : h('ul', { style: styles.resultList }, planned.map(item => h('li', { key: item.sourceSessionId, style: styles.resultItem },
              h('span', { style: styles.rowTitle }, item.title || t('untitled')),
              h('span', { style: { ...styles.hint, ...styles.code } }, item.sourceSessionId),
            ))),
        );
      }
      const migrated = Array.isArray(result.migrated) ? result.migrated : [];
      const skipped = Array.isArray(result.skipped) ? result.skipped : [];
      const failed = Array.isArray(result.failed) ? result.failed : [];
      return h('section', { style: styles.card },
        h('h2', { style: styles.title }, t('resultTitle')),
        h('div', { style: styles.success }, `${t('migrated')}: ${migrated.length} · ${t('skipped')}: ${skipped.length} · ${t('failed')}: ${failed.length}`),
        migrated.length > 0 && h('ul', { style: styles.resultList }, migrated.map(item => h('li', { key: item.newSessionId, style: styles.resultItem },
          h('span', { style: styles.rowTitle }, item.title || t('untitled')),
          h('span', { style: styles.hint }, `${t('newSession')}: `, h('span', { style: styles.code }, item.newSessionId)),
          item.backupPath && h('span', { style: styles.hint }, `${t('backup')}: `, h('span', { style: styles.code }, item.backupPath)),
          h('span', { style: styles.hint }, item.original === 'archived' ? t('originalArchived') : t('originalMoved')),
        ))),
        (skipped.length > 0 || failed.length > 0) && h('ul', { style: styles.resultList },
          [...skipped.map(item => ({ ...item, state: t('skipped') })), ...failed.map(item => ({ ...item, state: t('failed') }))]
            .map(item => h('li', { key: item.sessionId, style: styles.resultItem },
              h('span', { style: styles.rowTitle }, `${item.state}: `, h('span', { style: styles.code }, item.sessionId)),
              h('span', { style: styles.hint }, item.reason),
            ))),
        (result.backupRoots ?? []).length > 0 && h('div', { style: styles.hint }, `${t('backup')}: `, result.backupRoots.join(' · ')),
      );
    }

    /** Rebound in `apply` to the locale-aware translator the slot renderer uses. */
    let boundT = key => key;

    function Panel(props) {
      const t = props.t ?? boundT;
      const [state, setState] = React.useState({
        phase: 'loading',
        error: null,
        inventory: null,
        sourceId: null,
        targetId: null,
        selected: [],
        keepOriginal: false,
        busy: false,
        result: null,
      });

      const request = async (url, init) => {
        const response = await window.fetch(url, { cache: 'no-store', credentials: 'same-origin', ...init });
        let data;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        if (!response.ok) throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
        return data;
      };

      const load = async (signal) => {
        try {
          const data = await request(`${API}state`, { signal });
          setState(prev => {
            const workspaces = Array.isArray(data?.workspaces) ? data.workspaces : [];
            const hasSessions = workspace => workspace.sessionCount > 0;
            const source = workspaces.find(workspace => workspace.id === prev.sourceId && hasSessions(workspace))
              ?? workspaces.find(hasSessions) ?? null;
            const target = workspaces.find(workspace => workspace.id === prev.targetId && workspace.id !== source?.id && workspace.status === 'ok')
              ?? workspaces.find(workspace => workspace.id !== source?.id && workspace.status === 'ok') ?? null;
            const eligible = new Set((source?.sessions ?? []).filter(isEligible).map(session => session.id));
            return {
              ...prev,
              phase: 'ready',
              error: null,
              inventory: workspaces,
              sourceId: source?.id ?? null,
              targetId: target?.id ?? null,
              selected: prev.selected.filter(id => eligible.has(id)),
              busy: false,
            };
          });
        } catch (error) {
          if (error?.name === 'AbortError') return;
          setState(prev => ({ ...prev, phase: prev.inventory === null ? 'error' : 'ready', error: error.message, busy: false }));
        }
      };

      React.useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
        // The panel loads once; Refresh calls the same function.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      const workspaces = state.inventory ?? [];
      const source = workspaces.find(workspace => workspace.id === state.sourceId) ?? null;
      const target = workspaces.find(workspace => workspace.id === state.targetId) ?? null;
      const sessions = source?.sessions ?? [];
      const selectedCount = state.selected.length;
      const busy = state.busy;

      const changeSource = (id) => {
        setState(prev => ({
          ...prev,
          sourceId: id,
          targetId: prev.targetId === id ? (workspaces.find(workspace => workspace.id !== id && workspace.status === 'ok')?.id ?? null) : prev.targetId,
          selected: [],
          result: null,
          error: null,
        }));
      };
      const changeTarget = id => setState(prev => ({ ...prev, targetId: id, result: null, error: null }));
      const toggle = (id) => setState(prev => ({
        ...prev,
        selected: prev.selected.includes(id) ? prev.selected.filter(value => value !== id) : [...prev.selected, id],
        result: null,
        error: null,
      }));
      const selectAll = () => setState(prev => ({ ...prev, selected: (source?.sessions ?? []).filter(isEligible).map(session => session.id), result: null, error: null }));
      const clearSelection = () => setState(prev => ({ ...prev, selected: [], result: null, error: null }));

      const run = async (dryRun) => {
        if (target === null || state.selected.length === 0 || busy) return;
        setState(prev => ({ ...prev, busy: true, result: null, error: null }));
        try {
          const result = await request(`${API}migrate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetWorkspace: target.id,
              sessionIds: state.selected,
              keepOriginal: state.keepOriginal,
              dryRun,
            }),
          });
          setState(prev => ({ ...prev, busy: false, result, selected: dryRun ? prev.selected : [] }));
          if (!dryRun) await load(undefined);
        } catch (error) {
          setState(prev => ({ ...prev, busy: false, error: error.message }));
        }
      };

      const refresh = () => {
        setState(prev => ({ ...prev, busy: true, error: null }));
        void load(undefined);
      };

      if (state.phase === 'loading' && state.inventory === null) {
        return h('div', { style: styles.page }, h('div', { style: styles.wrap }, h('p', { style: styles.hint }, t('loading'))));
      }

      return h('div', { style: styles.page },
        h('div', { style: styles.wrap },
          h('header', null,
            h('h1', { style: styles.title }, t('title')),
            h('p', { style: styles.lead }, t('lead')),
          ),
          state.error !== null && h('div', { style: styles.error, role: 'alert' }, `${t('errorTitle')}: ${state.error}`),
          h('section', { style: styles.card },
            h('div', { style: styles.grid },
              h('label', { style: styles.field },
                h('span', { style: styles.label }, t('source')),
                h('select', {
                  style: styles.select,
                  value: state.sourceId ?? '',
                  disabled: busy,
                  onChange: event => changeSource(event.target.value),
                }, [
                  // A missing source directory never blocks selection: migration reads
                  // stored logs, not the directory. Only the target directory must exist.
                  ...workspaces.filter(workspace => workspace.sessionCount > 0).map(workspace => h('option', {
                    key: workspace.id,
                    value: workspace.id,
                  }, `${workspaceOptionLabel(workspace, t)} (${workspace.sessionCount})`)),
                ]),
                h('span', { style: styles.hint }, source === null
                  ? t('noSource')
                  : source.status === 'ok'
                    ? source.path
                    : `${source.path} — ${t('sourceMissingHint')}`),
              ),
              h('label', { style: styles.field },
                h('span', { style: styles.label }, t('target')),
                h('select', {
                  style: styles.select,
                  value: state.targetId ?? '',
                  disabled: busy,
                  onChange: event => changeTarget(event.target.value),
                }, [
                  ...workspaces.filter(workspace => workspace.id !== state.sourceId).map(workspace => h('option', {
                    key: workspace.id,
                    value: workspace.id,
                    disabled: workspace.status !== 'ok',
                  }, workspaceOptionLabel(workspace, t))),
                ]),
                h('span', { style: styles.hint }, target === null ? t('noTarget') : target.path),
              ),
            ),
            h('div', { style: styles.toolbar },
              h('button', { type: 'button', style: styles.button, disabled: busy, onClick: selectAll }, t('selectAll')),
              h('button', { type: 'button', style: styles.button, disabled: busy, onClick: clearSelection }, t('clear')),
              h('button', { type: 'button', style: styles.button, disabled: busy, onClick: refresh }, t('refresh')),
              h('span', { style: styles.count }, `${selectedCount} ${t('selected')}`),
            ),
            sessions.length === 0
              ? h('p', { style: styles.hint }, t('noSource'))
              : h('div', { style: styles.list }, sessions.map((session, index) => {
                  const reason = ineligibleReason(session, t);
                  return h('label', {
                    key: session.id,
                    style: { ...styles.row, ...(index === 0 ? styles.firstRow : {}), ...(reason !== null ? styles.disabled : {}) },
                  },
                    h('input', {
                      type: 'checkbox',
                      checked: state.selected.includes(session.id),
                      disabled: busy || reason !== null,
                      onChange: () => toggle(session.id),
                      style: { marginTop: 3 },
                    }),
                    h('div', { style: styles.rowMain },
                      h('div', { style: styles.rowTitle }, sessionTitle(session, t)),
                      h('div', { style: styles.hint }, reason ?? new Date(session.createdAt).toLocaleString()),
                      h(SessionBadges, { session, t }),
                    ),
                  );
                })),
            h('label', { style: styles.checkboxRow },
              h('input', {
                type: 'checkbox',
                checked: state.keepOriginal,
                disabled: busy,
                onChange: event => setState(prev => ({ ...prev, keepOriginal: event.target.checked })),
                style: { marginTop: 3 },
              }),
              h('span', null,
                h('span', null, t('keepOriginal')),
                h('span', { style: styles.hint }, t('keepOriginalHint')),
              ),
            ),
            h('div', { style: styles.toolbar },
              h('button', {
                type: 'button',
                style: busy || target === null || selectedCount === 0 ? { ...styles.button, ...styles.disabled } : styles.button,
                disabled: busy || target === null || selectedCount === 0,
                onClick: () => void run(true),
              }, t('dryRun')),
              h('button', {
                type: 'button',
                style: busy || target === null || selectedCount === 0 ? { ...styles.primary, ...styles.disabled } : styles.primary,
                disabled: busy || target === null || selectedCount === 0,
                onClick: () => void run(false),
              }, busy ? t('busy') : t('migrate')),
            ),
            selectedCount === 0 && h('p', { style: styles.hint }, t('emptySelection')),
            h('p', { style: styles.hint }, t('note')),
          ),
          h(ResultView, { result: state.result, t }),
        ),
      );
    }

    function Icon({ size = 20 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3, y: 5, width: 7, height: 14, rx: 1.6, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('rect', { x: 14, y: 5, width: 7, height: 14, rx: 1.6, fill: 'currentColor', opacity: 0.85 }),
        h('path', { d: 'M9 12h5m0 0-1.6-1.6M14 12l-1.6 1.6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    return {
      inject: ['slots', 'layout', 'locale'],
      apply(ctx) {
        boundT = ctx.locale.bind(NS);
        const t = boundT;
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'workspace-session-migration: dictionaries');
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Panel)), 'workspace-session-migration: panel');
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 30,
          label: () => t('nav'),
        }, Icon)), 'workspace-session-migration: navigation');
      },
    };
  },
});
