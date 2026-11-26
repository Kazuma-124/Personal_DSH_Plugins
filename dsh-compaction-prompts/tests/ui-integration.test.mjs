import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { createCatalogStore } from '../catalog-store.js'
import { captureOfficialPrompt } from '../official-prompt.js'
import { createPromptOperations, registerPromptInterface, API_PATH } from '../prompt-interface.js'
import { apply, loadOfficialModules, patchEngine } from '../index.js'

test('captures the installed official instruction without a model request; the catalog controls actual summaries', async () => {
  const { Engine, llm, version } = await loadOfficialModules()
  const official = await captureOfficialPrompt(Engine)
  assert.match(official, /Primary Request and Intent/u)
  assert.ok(version)
  const root = mkdtempSync(join(tmpdir(), 'prompt-runtime-'))
  const catalog = createCatalogStore(root)
  const initial = catalog.syncOfficial({ text: official, version })
  const snapshot = initial.items.find(item => item.kind === 'official-snapshot')
  const state = { calls: 0, custom: 0, fallbacks: 0, rejected: 0, readErrors: 0, reported: new Set() }
  let captured
  const ctx = { logger: { warn() {} }, llm: { async *stream(options) { captured = options; yield { type: 'text-delta', index: 0, text: 'checkpoint' } } } }
  const dispose = patchEngine(Engine, llm, ctx, state, root, false, catalog)
  const receiver = { ctx, config: { summarizationProvider: '', summarizationModel: '', maxTokens: 128, modelPolicies: [{ provider: 'fake', model: 'fake', summarizationProvider: 'summary-provider', summarizationModel: 'summary-model', maxTokens: 42 }] } }
  const agent = { options: { provider: 'fake', model: 'fake' }, session: { id: 'test', requestHeader: () => undefined, toolHistory: () => [] } }
  const summarize = () => Engine.prototype.summarize.call(receiver, { messages: [] }, agent)
  try {
    await summarize()
    assert.equal(captured.messages.at(-1).content[0].text, official)
    catalog.select(snapshot.id)
    catalog.syncOfficial({ text: 'Changed official instruction', version: 'future' })
    await summarize()
    assert.equal(captured.messages.at(-1).content[0].text, official)
    assert.equal(state.custom, 1)
    assert.equal(captured.provider, 'summary-provider')
    assert.equal(captured.model, 'summary-model')
    assert.equal(captured.maxTokens, 42)
    assert.equal(catalog.list().selectedId, snapshot.id)
    assert.equal(await captureOfficialPrompt(Engine), official)
    writeFileSync(join(root, 'catalog.json'), '{broken')
    await assert.rejects(summarize)
    assert.equal(state.rejected, 1)
    assert.equal(state.fallbacks, 1)
  } finally { dispose(); rmSync(root, { recursive: true, force: true }) }
})

test('settings routes and tools use the same global selection; invalid input cannot change it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prompt-api-'))
  try {
    const catalog = createCatalogStore(root)
    catalog.syncOfficial({ text: 'Official', version: 'test' })
    const state = { patch: 'installed' }
    const operations = createPromptOperations(catalog, state)
    let route, tool
    const ctx = {
      get(key) { return key === 'connection' ? { fetch: { register(value) { route = value; return () => {} } } } : key === 'tools' ? { register(value) { tool = value; return () => {} } } : undefined },
      effect(callback) { callback() },
    }
    registerPromptInterface(ctx, catalog, state)
    assert.equal(route.path, API_PATH)
    const initial = await (await route.fetch(new Request('http://localhost' + API_PATH))).json()
    const snapshot = initial.items.find(item => item.kind === 'official-snapshot')
    assert.equal(initial.installedSnapshotId, snapshot.id)
    await tool.execute({ action: 'select', id: snapshot.id })
    assert.equal((await operations()).selectedId, snapshot.id)
    for (const body of ['null', '{', '{"action":"unknown"}', '{"action":"select","id":"../file"}', '{"action":"list","extra":true}']) {
      assert.ok((await route.fetch(new Request('http://localhost' + API_PATH, { method: 'POST', body }))).status >= 400)
      assert.equal(catalog.list().selectedId, snapshot.id)
    }
    const large = await route.fetch(new Request('http://localhost' + API_PATH, { method: 'POST', body: ' '.repeat(400 * 1024 + 1) }))
    assert.equal(large.status, 413)
    state.patch = 'unavailable'
    await assert.rejects(() => operations({ action: 'select', id: 'official:current' }), /unavailable/)
    assert.equal(catalog.list().selectedId, snapshot.id)
    const added = await (await route.fetch(new Request('http://localhost' + API_PATH, { method: 'POST', body: JSON.stringify({ action: 'add', name: 'Pasted prompt', text: 'Custom instruction' }) }))).json()
    assert.equal(added.selectedId, snapshot.id)
    const pasted = added.items.find(item => item.name === 'Pasted prompt')
    assert.ok(pasted)
    const edited = await (await route.fetch(new Request('http://localhost' + API_PATH, { method: 'POST', body: JSON.stringify({ action: 'update', id: pasted.id, name: 'Pasted prompt', text: 'Edited instruction' }) }))).json()
    assert.equal(edited.items.find(item => item.name === 'Pasted prompt').text, 'Edited instruction')
    assert.equal(edited.selectedId, snapshot.id)
    const deleted = await (await route.fetch(new Request('http://localhost' + API_PATH, { method: 'POST', body: JSON.stringify({ action: 'delete', id: edited.items.find(item => item.name === 'Pasted prompt').id }) }))).json()
    assert.equal(deleted.items.some(item => item.name === 'Pasted prompt'), false)
    for (const body of [
      JSON.stringify({ action: 'update', id: 'official:current', name: 'X', text: 'Y' }),
      JSON.stringify({ action: 'delete', id: 'official:current' }),
      JSON.stringify({ action: 'delete' }),
      JSON.stringify({ action: 'update', id: 'official:current' }),
    ]) {
      const response = await route.fetch(new Request('http://localhost' + API_PATH, { method: 'POST', body }))
      assert.ok(response.status >= 400)
      assert.equal(catalog.list().selectedId, snapshot.id)
    }
    assert.equal(tool.parameters.type, 'object')
    assert.deepEqual(tool.parameters.properties.action.enum, ['list', 'select', 'sync', 'add', 'update', 'delete'])
    assert.equal(tool.output.schema.type, 'object')
    const protectedDelete = await route.fetch(new Request('http://localhost' + API_PATH, { method: 'POST', body: JSON.stringify({ action: 'delete', id: initial.installedSnapshotId }) }))
    assert.equal(protectedDelete.status, 400)
    assert.ok(catalog.list().items.some(item => item.id === initial.installedSnapshotId))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('startup rejects a damaged catalog and recovers after repair without reloading', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prompt-startup-'))
  const clean = mkdtempSync(join(tmpdir(), 'prompt-clean-'))
  const previousRoot = process.env.DSH_COMPACTION_PROMPTS_DIR
  const disposers = []
  let route, tool
  try {
    process.env.DSH_COMPACTION_PROMPTS_DIR = root
    writeFileSync(join(root, 'catalog.json'), '{broken')
    await apply({
      logger: { info() {}, warn() {}, error() {} },
      effect(fn) { const dispose = fn(); if (dispose) disposers.push(dispose) },
      get(key) { return key === 'connection' ? { fetch: { register(value) { route = value; return () => {} } } } : key === 'tools' ? { register(value) { tool = value; return () => {} } } : undefined },
    })
    const { Engine } = await loadOfficialModules()
    await assert.rejects(() => Engine.prototype.summarize.call({}, {}, {}), /Compaction prompt unavailable/)
    assert.equal((await route.fetch(new Request('http://localhost' + API_PATH))).status, 500)
    createCatalogStore(clean)
    writeFileSync(join(root, 'catalog.json'), readFileSync(join(clean, 'catalog.json')))
    const repaired = await tool.execute({ action: 'sync' })
    assert.equal(repaired.status, 'installed')
    assert.equal(repaired.readError, null)
    assert.ok(repaired.items.some(item => item.kind === 'official-snapshot'))
  } finally {
    for (const dispose of disposers.reverse()) dispose()
    if (previousRoot === undefined) delete process.env.DSH_COMPACTION_PROMPTS_DIR
    else process.env.DSH_COMPACTION_PROMPTS_DIR = previousRoot
    rmSync(root, { recursive: true, force: true })
    rmSync(clean, { recursive: true, force: true })
  }
})

test('client contributes one independent settings section with a localized label and scoped styles', () => {
  let module, entry, component, css
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { module = value.factory(() => ({ createElement(type, _props, ...children) { if (type === 'style') css = children[0] }, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: initial => ({ current: initial }), useEffect() {} })) } } },
    styles: { insert(value) { css = value; return () => {} } },
  })
  let language = 'zh'
  module.apply({
    locale: { getLocale: () => ({ active: language }) },
    effect(fn) { fn() },
    slots: { inject(name, fn) { assert.equal(name, 'settings.section'); fn() }, register(value, render) { entry = value; component = render; return () => {} } },
  })
  assert.equal(entry.id, 'compaction-prompts')
  assert.equal(entry.label(), '压缩提示词')
  language = 'en'
  assert.equal(entry.label(), 'Compaction prompts')
  assert.equal(typeof component, 'function')
  component()
  assert.match(css, /\.compaction-prompts/)
})
