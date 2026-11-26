window.__ModuleLoader__.load({
  id: '@kazuma-124/dsh-compaction-prompts',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const words = {
      zh: { title: '压缩提示词', intro: '选择一个提示词用于所有会话的后续压缩。切换后自动保存，正在进行的压缩保持原选择。', loading: '正在读取提示词…', refresh: '刷新列表', sync: '同步当前官方版本', current: 'DSH 官方 · 跟随当前版本', follow: '使用当前安装的 DSH 官方实现，升级后自动跟随。', snapshot: '官方快照', custom: '自定义', selected: '已启用', saved: '已保存，将用于后续压缩。', failed: '操作失败：', retry: '重试', preview: '查看提示词', empty: '尚无内容', history: '官方内容更新时自动新增快照，历史版本与当前选择会保留。', unavailable: '压缩钩子不可用，暂时无法切换。', version: '版本', syncing: '正在保存…', synced: '当前官方内容已同步。', added: '提示词已加入列表，请单选以启用。', add: '添加自定义提示词', promptName: '名称', promptBody: '提示词全文（最多 64 KiB）', addSave: '保存到列表', lastUsed: '最近一次压缩使用', neverUsed: '尚未完成压缩', syncingOfficial: '正在同步官方内容…', edit: '编辑', del: '删除', saveEdit: '保存修改', cancel: '取消', confirmDelete: '确定删除“{name}”？', edited: '修改已保存，将在后续压缩中使用。', deleted: '提示词已删除。', deleteSelected: '已删除当前提示词，选择已改为跟随官方。', historySnapshots: '官方历史快照', protectedSnapshot: '当前安装版本，不可删除', missingApi: '设置接口不存在（HTTP 404）。请重启 DSH 加载插件后重试。', invalidResponse: '设置接口返回了无效响应' },
      en: { title: 'Compaction prompts', intro: 'Choose one prompt for future compactions across all sessions. Changes save automatically; compactions already in progress keep their original choice.', loading: 'Loading prompts…', refresh: 'Refresh list', sync: 'Sync installed official version', current: 'DSH official · Follow current version', follow: 'Uses the installed DSH official implementation and follows upgrades.', snapshot: 'Official snapshot', custom: 'Custom', selected: 'Active', saved: 'Saved for future compactions.', failed: 'Operation failed: ', retry: 'Retry', preview: 'View prompt', empty: 'No content yet', history: 'New official content creates a snapshot automatically. History and your selection are preserved.', unavailable: 'The compaction hook is unavailable. Switching is disabled.', version: 'Version', syncing: 'Saving…', synced: 'Installed official content synchronized.', added: 'Prompt added. Select it to activate.', add: 'Add custom prompt', promptName: 'Name', promptBody: 'Prompt text (up to 64 KiB)', addSave: 'Save to list', lastUsed: 'Last completed compaction used', neverUsed: 'No completed compaction yet', syncingOfficial: 'Synchronizing official content…', edit: 'Edit', del: 'Delete', saveEdit: 'Save changes', cancel: 'Cancel', confirmDelete: 'Delete “{name}”?', edited: 'Changes saved for future compactions.', deleted: 'Prompt deleted.', deleteSelected: 'Deleted the active prompt; selection now follows the official version.', historySnapshots: 'Official version history', protectedSnapshot: 'Installed version; cannot be deleted', missingApi: 'Settings endpoint not found (HTTP 404). Restart DSH to load the plugin, then retry.', invalidResponse: 'The settings endpoint returned an invalid response' },
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const text = () => words[ctx.locale.getLocale().active.startsWith('zh') ? 'zh' : 'en']
        const css = `
          .compaction-prompts { color:var(--dsw-alias-label-primary); padding:24px; max-width:840px; margin:auto; box-sizing:border-box; }
          .compaction-prompts h2 { font-size:20px; margin:0 0 12px; }
          .compaction-prompts p { line-height:1.6; color:var(--dsw-alias-label-secondary); }
          .compaction-prompts .cp-actions { display:flex; gap:10px; flex-wrap:wrap; margin:18px 0; }
          .compaction-prompts button { font:inherit; color:inherit; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); padding:7px 12px; border-radius:7px; cursor:pointer; }
          .compaction-prompts button:disabled { opacity:.55; cursor:wait; }
          .compaction-prompts button:focus-visible,.compaction-prompts input:focus-visible,.compaction-prompts summary:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:3px; }
          .compaction-prompts fieldset { border:0; margin:0; padding:0; min-width:0; }
          .compaction-prompts legend { font-weight:600; margin-bottom:12px; }
          .compaction-prompts .cp-card { border:1px solid var(--dsw-alias-border-l1); border-radius:10px; padding:14px; margin-bottom:12px; background:var(--dsw-alias-bg-layer-1); overflow-wrap:anywhere; }
          .compaction-prompts .cp-card[data-active=true] { border-color:var(--dsw-alias-brand-primary); }
          .compaction-prompts label { display:flex; align-items:flex-start; gap:10px; cursor:pointer; line-height:1.5; }
          .compaction-prompts input { margin-top:4px; accent-color:var(--dsw-alias-brand-primary); }
          .compaction-prompts .cp-name { flex:1; min-width:0; font-weight:600; }
          .compaction-prompts form label { display:block; margin:12px 0; }
          .compaction-prompts form input,.compaction-prompts textarea { display:block; width:100%; box-sizing:border-box; margin-top:6px; padding:8px; color:inherit; font:inherit; background:var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l2); border-radius:6px; }
          .compaction-prompts textarea { resize:vertical; }
          .compaction-prompts small { color:var(--dsw-alias-label-secondary); display:block; margin:8px 0; }
          .compaction-prompts .cp-badge { color:var(--dsw-alias-brand-primary); font-size:12px; white-space:nowrap; }
          .compaction-prompts summary { cursor:pointer; font-size:13px; color:var(--dsw-alias-label-secondary); padding:6px 0; }
          .compaction-prompts pre { max-height:320px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.6 monospace; padding:12px; border-radius:6px; background:var(--dsw-alias-bg-base); }
          .compaction-prompts .cp-error { color:var(--dsw-alias-state-error-primary); }
          .compaction-prompts .cp-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
          .compaction-prompts .cp-row button { padding:5px 10px; font-size:13px; }
          .compaction-prompts .cp-edit { border-top:1px solid var(--dsw-alias-border-l1); margin-top:12px; padding-top:4px; }
          .compaction-prompts .cp-history { margin-top:16px; }
          .compaction-prompts .cp-history > summary { font-weight:600; color:var(--dsw-alias-label-primary); }
          .compaction-prompts .cp-note { font-size:12px; color:var(--dsw-alias-label-secondary); align-self:center; }
          @media(max-width:480px) { .compaction-prompts { padding:16px; } }
        `
        function Page() {
          const [locale, setLocale] = React.useState(text)
          const [data, setData] = React.useState(null)
          const [busy, setBusy] = React.useState('')
          const [name, setName] = React.useState('')
          const [body, setBody] = React.useState('')
          const [editing, setEditing] = React.useState(null)
          const deletingSelected = React.useRef(false)
          const failedOperation = React.useRef(null)
          const hasData = React.useRef(false)
          const [error, setError] = React.useState('')
          const [notice, setNotice] = React.useState(false)
          const generation = React.useRef(0)
          const locked = React.useRef(false)
          const mounted = React.useRef(true)
          async function load(action = 'list', id, custom) {
            if (locked.current && (action === 'list' || locked.current !== 'list')) return
            const ticket = ++generation.current
            const mutation = action !== 'list'
            locked.current = action
            if (mutation || !hasData.current) setBusy(action)
            if (mutation) setNotice(false)
            try {
              const response = await window.fetch('/api/compaction-prompts', mutation ? {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...(id ? { id } : {}), ...custom }),
              } : { cache: 'no-store' })
              if (response.status === 404) throw new Error(text().missingApi)
              const responseText = await response.text()
              let result
              try { result = JSON.parse(responseText) } catch {
                throw new Error(`${text().invalidResponse} (HTTP ${response.status}): ${responseText.slice(0, 160)}`)
              }
              if (!response.ok) throw new Error(result?.error || `HTTP ${response.status}`)
              if (!result || !Array.isArray(result.items)) throw new Error(`${text().invalidResponse} (HTTP ${response.status})`)
              if (!mounted.current || generation.current !== ticket) return
              setData(result)
              hasData.current = true
              if (mutation || !failedOperation.current || failedOperation.current.action === 'list') {
                setError('')
                failedOperation.current = null
              }
              if (mutation) {
                failedOperation.current = null
                setNotice(action)
                if (action === 'add') { setName(''); setBody('') }
                if (action === 'update') setEditing(null)
                if (action === 'delete') {
                  setNotice(deletingSelected.current ? 'deleteSelected' : 'delete')
                  deletingSelected.current = false
                }
              }
            } catch (failure) {
              if (mounted.current && generation.current === ticket) {
                if (mutation || !failedOperation.current) {
                  failedOperation.current = { action, id, custom }
                  setError(failure instanceof Error ? failure.message : String(failure))
                }
              }
            } finally {
              if (generation.current === ticket) locked.current = false
              if (mounted.current && generation.current === ticket) setBusy('')
            }
          }
          React.useEffect(() => {
            mounted.current = true
            const unsubscribe = ctx.locale.subscribe(() => setLocale(text()))
            load()
            const refresh = () => { if (!document.hidden) load() }
            window.addEventListener('focus', refresh)
            const timer = window.setInterval(refresh, 15000)
            return () => { mounted.current = false; generation.current++; unsubscribe(); window.removeEventListener('focus', refresh); window.clearInterval(timer) }
          }, [])
          const t = locale
          const listedItems = data ? data.items.filter(item => item.kind !== 'official-snapshot' || item.id === data.selectedId) : []
          const historyItems = data ? data.items.filter(item => item.kind === 'official-snapshot' && item.id !== data.selectedId) : []
          const card = item => h('div', { className: 'cp-card', key: item.id, 'data-active': item.id === data.selectedId },
            h('label', null,
              h('input', { type: 'radio', name: 'compaction-prompt', checked: item.id === data.selectedId, value: item.id, onChange: () => load('select', item.id) }),
              h('span', { className: 'cp-name' }, item.id === 'official:current' ? t.current : item.name),
              item.id === data.selectedId && h('span', { className: 'cp-badge' }, t.selected)),
            h('small', null, item.id === 'official:current' ? `${t.follow} ${t.version} ${item.version || '—'}` : item.kind === 'official-snapshot' ? `${t.snapshot} · ${t.version} ${item.version || '—'} · ${item.id.slice(-8)} · ${new Date(item.createdAt).toLocaleString()}` : t.custom),
            h('details', null, h('summary', null, t.preview), h('pre', null, item.text || t.empty)),
            item.kind === 'custom' && editing && editing.id === item.id && h('form', { className: 'cp-edit', onSubmit: event => { event.preventDefault(); load('update', editing.id, { name: editing.name, text: editing.text }) } },
              h('label', null, t.promptName, h('input', { type: 'text', value: editing.name, maxLength: 120, required: true, disabled: Boolean(busy), onChange: event => setEditing({ id: editing.id, name: event.target.value, text: editing.text }) })),
              h('label', null, t.promptBody, h('textarea', { value: editing.text, rows: 8, required: true, disabled: Boolean(busy), onChange: event => setEditing({ id: editing.id, name: editing.name, text: event.target.value }) })),
              h('div', { className: 'cp-row' },
                h('button', { type: 'submit', disabled: Boolean(busy) || !editing.name.trim() || !editing.text.trim() }, t.saveEdit),
                h('button', { type: 'button', disabled: Boolean(busy), onClick: () => setEditing(null) }, t.cancel))),
            !(item.kind === 'custom' && editing && editing.id === item.id) && (item.kind === 'custom' || (item.kind === 'official-snapshot' && item.id !== data.installedSnapshotId)) && h('div', { className: 'cp-row' },
              item.kind === 'custom' && h('button', { type: 'button', disabled: Boolean(busy), onClick: () => setEditing({ id: item.id, name: item.name, text: item.text }) }, t.edit),
              h('button', { type: 'button', disabled: Boolean(busy), onClick: () => { if (typeof window.confirm === 'function' && !window.confirm(t.confirmDelete.replace('{name}', item.name))) return; deletingSelected.current = item.id === data.selectedId; load('delete', item.id) } }, t.del)),
            item.id === data.installedSnapshotId && h('div', { className: 'cp-row' }, h('span', { className: 'cp-note' }, t.protectedSnapshot)))
          return h('section', { className: 'compaction-prompts', 'aria-busy': Boolean(busy) },
            h('style', null, css),
            h('h2', null, t.title), h('p', null, t.intro),
            h('div', { className: 'cp-actions' },
              h('button', { type: 'button', disabled: Boolean(busy), onClick: () => load() }, t.refresh),
              h('button', { type: 'button', disabled: Boolean(busy), onClick: () => load('sync') }, t.sync)),
            error && h('p', { role: 'alert', className: 'cp-error' }, t.failed + error, ' ', h('button', { type: 'button', disabled: Boolean(busy), onClick: () => { const retry = failedOperation.current; if (retry) load(retry.action, retry.id, retry.custom); else load() } }, t.retry)),
            h('div', { role: 'status', 'aria-live': 'polite' }, busy === 'list' ? t.loading : busy === 'sync' ? t.syncingOfficial : busy ? t.syncing : notice === 'sync' ? t.synced : notice === 'add' ? t.added : notice === 'update' ? t.edited : notice === 'delete' ? t.deleted : notice === 'deleteSelected' ? t.deleteSelected : notice ? t.saved : ''),
            !data && !error && h('p', null, t.loading),
            data && data.status !== 'installed' && h('p', { role: 'alert', className: 'cp-error' }, t.unavailable, ' ', data.error),
            data && h('fieldset', { disabled: Boolean(busy) || data.status !== 'installed' },
              h('legend', null, t.title),
              ...listedItems.map(card),
              historyItems.length > 0 && h('details', { className: 'cp-history' },
                h('summary', null, `${t.historySnapshots} · ${historyItems.length}`),
                ...historyItems.map(card))),
            data && h('p', null, data.lastUsed ? `${t.lastUsed}: ${data.lastUsed.name} · ${new Date(data.lastUsed.at).toLocaleString()}` : t.neverUsed),
            data && data.readError && h('p', { role: 'alert', className: 'cp-error' }, data.readError),
            h('details', null, h('summary', null, t.add),
              h('form', { onSubmit: event => { event.preventDefault(); load('add', undefined, { name, text: body }) } },
                h('label', null, t.promptName, h('input', { type: 'text', value: name, maxLength: 120, required: true, disabled: Boolean(busy), onChange: event => setName(event.target.value) })),
                h('label', null, t.promptBody, h('textarea', { value: body, rows: 8, required: true, disabled: Boolean(busy), onChange: event => setBody(event.target.value) })),
                h('button', { type: 'submit', disabled: Boolean(busy) || !name.trim() || !body.trim() }, t.addSave))),
            h('p', null, t.history))
        }
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'compaction-prompts', order: 25, label: () => text().title,
        }, Page))
      },
    }
  },
})
