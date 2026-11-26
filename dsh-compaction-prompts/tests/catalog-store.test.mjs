import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it, mock } from 'node:test'
import { CATALOG_FILENAME, OFFICIAL_CURRENT_ID, createCatalogStore } from '../catalog-store.js'

const roots = []
function temporaryRoot() {
  const root = fs.mkdtempSync(join(tmpdir(), 'dsh-prompt-catalog-'))
  roots.push(root)
  return root
}
function legacy(root, folder, name, text) {
  fs.mkdirSync(join(root, folder), { recursive: true })
  fs.writeFileSync(join(root, folder, name), text)
}
const disk = root => JSON.parse(fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8'))
const save = (root, document) => fs.writeFileSync(join(root, CATALOG_FILENAME), JSON.stringify(document))
const snapshots = store => store.list().items.filter(item => item.kind === 'official-snapshot')

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

it('persists exactly one default selection and always provides official current', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  assert.deepEqual(store.list(), {
    selectedId: 'official:current',
    items: [{ id: 'official:current', name: 'Official current', kind: 'official', text: '' }],
  })
  assert.deepEqual(store.readSelected(), { kind: 'official' })
  assert.equal(disk(root).selectedId, OFFICIAL_CURRENT_ID)
  assert.deepEqual(createCatalogStore(root).list(), store.list())
})

it('migrates valid md/txt files and selects the first valid sorted active file', () => {
  const root = temporaryRoot()
  legacy(root, 'active', '00-empty.md', '  \n')
  legacy(root, 'active', '01-large.txt', 'x'.repeat(65537))
  legacy(root, 'active', '02-bad.md', Buffer.from([0xc3, 0x28]))
  legacy(root, 'active', 'a.TXT', '\uFEFF中文\r\n<compacted-summary>')
  legacy(root, 'active', 'b.md', 'second active')
  legacy(root, 'presets', 'a.md', 'preset')
  legacy(root, 'presets', 'boundary.txt', 'x'.repeat(65536))
  legacy(root, 'presets', 'ignored.json', '{}')
  fs.mkdirSync(join(root, 'presets', 'directory.md'))
  const store = createCatalogStore(root)
  assert.deepEqual(store.list().items.map(item => item.name), ['Official current', 'a.TXT', 'b.md', 'a.md', 'boundary.txt'])
  const selected = store.readSelected()
  assert.equal(selected.name, 'a.TXT')
  assert.equal(selected.text, '中文\r\n<compacted-summary>')
  assert.equal(selected.bytes, Buffer.byteLength(selected.text))
  assert.deepEqual(selected.warnings, [])
  assert.equal(fs.readFileSync(join(root, 'active', 'a.TXT'), 'utf8').startsWith('\uFEFF'), true)
  const original = store.list()
  fs.rmSync(join(root, 'active'), { recursive: true })
  fs.rmSync(join(root, 'presets'), { recursive: true })
  assert.deepEqual(createCatalogStore(root).list(), original)
  assert.deepEqual(store.readSelected(), selected)
})

it('keeps the default when only presets are available and produces stable distinct legacy ids', () => {
  const rootsToCompare = [temporaryRoot(), temporaryRoot()]
  for (const root of rootsToCompare) {
    legacy(root, 'presets', 'same.md', 'same content')
    legacy(root, 'presets', 'other.md', 'same content')
  }
  const left = createCatalogStore(rootsToCompare[0]).list()
  const right = createCatalogStore(rootsToCompare[1]).list()
  assert.equal(left.selectedId, OFFICIAL_CURRENT_ID)
  assert.deepEqual(left, right)
  assert.notEqual(left.items[1].id, left.items[2].id)
})

it('deduplicates official content with SHA256 and never edits historical snapshots', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  const first = store.syncOfficial({ text: 'Official first', version: '1.0' })
  const originalSnapshot = snapshots(store)[0]
  assert.equal(originalSnapshot.id, `official:sha256:${createHash('sha256').update('Official first').digest('hex')}`)
  assert.equal(first.selectedId, OFFICIAL_CURRENT_ID)
  assert.equal(typeof originalSnapshot.createdAt, 'string')
  store.select(originalSnapshot.id)
  const selected = store.readSelected()
  store.syncOfficial({ text: 'Official second', version: '2.0' })
  assert.equal(snapshots(store).length, 2)
  assert.deepEqual(snapshots(store)[0], originalSnapshot)
  assert.deepEqual(store.readSelected(), selected)
  store.syncOfficial({ text: 'Official first', version: '3.0' })
  assert.equal(snapshots(store).length, 2)
  assert.deepEqual(snapshots(store)[0], originalSnapshot)
  assert.equal(store.list().items[0].version, '3.0')
  assert.deepEqual(createCatalogStore(root).readSelected(), selected)
  store.select(OFFICIAL_CURRENT_ID)
  assert.deepEqual(store.readSelected(), { kind: 'official' })
})

it('preserves a custom selection across official updates and separate store instances', () => {
  const root = temporaryRoot()
  legacy(root, 'presets', 'custom.md', 'custom instruction')
  const first = createCatalogStore(root)
  const second = createCatalogStore(root)
  const custom = first.list().items.find(item => item.kind === 'custom')
  first.select(custom.id)
  assert.equal(second.readSelected().id, custom.id)
  second.syncOfficial({ text: 'official', version: '1' })
  assert.equal(first.readSelected().id, custom.id)
  second.select(OFFICIAL_CURRENT_ID)
  assert.deepEqual(first.readSelected(), { kind: 'official' })
})

it('adds custom prompts with normalized names and exact bodies without selecting them', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  const text = '  中文正文\r\n<compacted-summary>\n  '
  const result = store.addCustom({ name: '  中文提示词  ', text })
  const item = result.items.find(item => item.kind === 'custom')
  assert.equal(result.selectedId, OFFICIAL_CURRENT_ID)
  assert.equal(item.name, '中文提示词')
  assert.equal(item.text, text)
  assert.equal(item.id, `custom:sha256:${createHash('sha256').update(`中文提示词\n${text}`).digest('hex')}`)
  assert.equal(typeof item.createdAt, 'string')
  assert.deepEqual(createCatalogStore(root).list(), result)
  store.select(item.id)
  assert.deepEqual(store.readSelected(), { kind: 'ok', id: item.id, name: item.name, text, bytes: Buffer.byteLength(text), warnings: [] })
  store.addCustom({ name: '另一个', text: 'another body' })
  assert.equal(store.readSelected().id, item.id)
})

it('deduplicates custom prompts by normalized name and exact text', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  const first = store.addCustom({ name: 'Name', text: 'Body' })
  const before = fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8')
  assert.deepEqual(store.addCustom({ name: '  Name  ', text: 'Body' }), first)
  assert.equal(fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8'), before)
  const changedName = store.addCustom({ name: 'Other', text: 'Body' })
  const changedText = store.addCustom({ name: 'Name', text: 'Body ' })
  assert.equal(changedName.items.length, 3)
  assert.equal(changedText.items.length, 4)
  assert.equal(new Set(changedText.items.map(item => item.id)).size, 4)
})

it('enforces custom name and byte limits while retaining compatible legacy names', () => {
  const root = temporaryRoot()
  legacy(root, 'active', `${'a'.repeat(121)}.md`, 'legacy content')
  const store = createCatalogStore(root)
  const selectedId = store.list().selectedId
  store.addCustom({ name: 'a'.repeat(120), text: 'x'.repeat(65536) })
  store.addCustom({ name: 'Unicode', text: '中'.repeat(21845) })
  const before = fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8')
  for (const input of [null, {}, { name: '', text: 'ok' }, { name: '  ', text: 'ok' }, { name: 42, text: 'ok' }, { name: 'a'.repeat(121), text: 'ok' }, { name: '\ud800', text: 'ok' }, { name: 'ok', text: '' }, { name: 'ok', text: ' \r\n ' }, { name: 'ok', text: '\ud800' }, { name: 'ok', text: '中'.repeat(21846) }, { name: 'ok', text: 'x'.repeat(65537) }, { name: 'ok', text: 'ok', selected: true }]) {
    assert.throws(() => store.addCustom(input))
  }
  assert.equal(fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8'), before)
  assert.equal(store.readSelected().id, selectedId)
})

it('detects custom prompt content or name tampering from its hash', () => {
  for (const field of ['name', 'text', 'id']) {
    const root = temporaryRoot()
    const store = createCatalogStore(root)
    store.addCustom({ name: 'Original', text: 'Original body' })
    const document = disk(root)
    document.items.find(item => item.kind === 'custom')[field] = 'changed'
    save(root, document)
    assert.throws(() => store.list(), /invalid custom id/u)
    assert.throws(() => store.addCustom({ name: 'New', text: 'New body' }))
  }
})

it('returns detached objects so callers cannot mutate stored state', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  const result = store.syncOfficial({ text: 'Official', version: '1' })
  result.items[0].text = 'changed'
  result.selectedId = 'unknown'
  const listed = store.list()
  listed.items.splice(0)
  assert.equal(store.list().items[0].text, 'Official')
  assert.equal(store.list().selectedId, OFFICIAL_CURRENT_ID)
})

it('rejects invalid ids and official input without changing the document', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  const before = fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8')
  for (const id of ['../outside.txt', 'official:missing', null, ['official:current']]) {
    assert.throws(() => store.select(id))
  }
  for (const input of [null, {}, { text: '', version: '1' }, { text: ' ', version: '1' }, { text: 'ok', version: 1 }, { text: '\ud800', version: '1' }, { text: 'x'.repeat(65537), version: '1' }, { text: 'ok', version: '1', path: '../escape' }]) {
    assert.throws(() => store.syncOfficial(input))
  }
  assert.equal(fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8'), before)
})

it('strictly rejects malformed JSON and invalid schemas instead of replacing them', () => {
  const corruptions = [
    document => ({ ...document, schemaVersion: 2 }),
    document => ({ ...document, extra: true }),
    document => ({ ...document, selectedId: ['official:current'] }),
    document => ({ ...document, selectedId: 'missing' }),
    document => ({ ...document, items: [] }),
    document => ({ ...document, items: [...document.items, document.items[0]] }),
    document => { document.items[0].kind = 'custom'; return document },
    document => { document.items[0].text = 5; return document },
    document => { document.items[0].text = 'unsnapshotted'; return document },
    document => { document.items[0].createdAt = 'tomorrow'; return document },
    document => { document.items[0].createdAt = '2026-02-30T00:00:00.000Z'; return document },
    document => { document.items[0].version = null; return document },
    document => { document.items[0].path = '../escape'; return document },
    document => { document.items.push({ id: '../escape', name: 'bad', kind: 'custom', text: 'bad' }); return document },
  ]
  for (const corrupt of corruptions) {
    const root = temporaryRoot()
    const store = createCatalogStore(root)
    save(root, corrupt(disk(root)))
    const before = fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8')
    assert.throws(() => store.list())
    assert.throws(() => store.readSelected())
    assert.throws(() => createCatalogStore(root))
    assert.equal(fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8'), before)
  }
  for (const text of ['{', 'null', '[]', '{"schemaVersion":1,}', '{"schemaVersion":1,"selectedId":"missing","selectedId":"official:current","items":[{"id":"official:current","name":"Official","kind":"official","text":""}]}', '{"schemaVersion":1,"selectedId":"official:current","items":[{"id":"official:current","name":"Official","kind":"custom","kind":"official","text":""}]}', Buffer.from([0xff])]) {
    const root = temporaryRoot()
    fs.writeFileSync(join(root, CATALOG_FILENAME), text)
    assert.throws(() => createCatalogStore(root))
  }
})

it('throws when a selected item or catalog disappears instead of silently switching', () => {
  const root = temporaryRoot()
  legacy(root, 'active', 'custom.md', 'custom instruction')
  const store = createCatalogStore(root)
  const document = disk(root)
  document.items = document.items.filter(item => item.id !== document.selectedId)
  save(root, document)
  assert.throws(() => store.readSelected(), /selected prompt is missing/u)
  assert.throws(() => store.syncOfficial({ text: 'Official', version: '1' }))
  assert.throws(() => store.select(OFFICIAL_CURRENT_ID))
  fs.unlinkSync(join(root, CATALOG_FILENAME))
  assert.throws(() => store.readSelected(), /ENOENT/u)
})

it('accepts prompt text containing JSON punctuation and escaped quotes', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  const text = String.raw`Summarize {"nested": [{"key":"value", "key":"another"}]} with \\slashes and \"quotes\".`
  store.syncOfficial({ text, version: '1' })
  store.select(snapshots(store)[0].id)
  assert.equal(store.readSelected().text, text)
})

it('detects tampered official snapshots by their content hashes', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  store.syncOfficial({ text: 'Official', version: '1' })
  const document = disk(root)
  document.items.find(item => item.kind === 'official-snapshot').text = 'tampered'
  save(root, document)
  assert.throws(() => store.list(), /invalid official snapshot/u)
})

it('keeps disk and observed state unchanged when the atomic rename fails', () => {
  const root = temporaryRoot()
  legacy(root, 'presets', 'custom.md', 'custom')
  const store = createCatalogStore(root)
  const customId = store.list().items.find(item => item.kind === 'custom').id
  const before = fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8')
  const observed = store.list()
  const intercepted = mock.method(fs, 'renameSync', () => { throw new Error('simulated rename failure') })
  syncBuiltinESMExports()
  try {
    assert.throws(() => store.select(customId), /simulated rename failure/u)
    assert.throws(() => store.syncOfficial({ text: 'Official', version: '1' }), /simulated rename failure/u)
    assert.throws(() => store.addCustom({ name: 'New prompt', text: 'New body' }), /simulated rename failure/u)
    assert.throws(() => store.updateCustom({ id: customId, name: 'Renamed', text: 'custom' }), /simulated rename failure/u)
    assert.throws(() => store.removePrompt(customId), /simulated rename failure/u)
  } finally {
    intercepted.mock.restore()
    syncBuiltinESMExports()
  }
  assert.equal(fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8'), before)
  assert.deepEqual(store.list(), observed)
  assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith('.tmp')), [])
  store.select(customId)
  assert.equal(store.readSelected().id, customId)
})

it('edits a custom prompt, keeps its creation time, and moves the selection to the new id', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  const original = store.addCustom({ name: 'Draft', text: 'First body' }).items.find(item => item.kind === 'custom')
  store.select(original.id)
  const updated = store.updateCustom({ id: original.id, name: '  Final  ', text: 'Second body' })
  const item = updated.items.find(entry => entry.kind === 'custom')
  assert.equal(item.name, 'Final')
  assert.equal(item.text, 'Second body')
  assert.equal(item.createdAt, original.createdAt)
  assert.notEqual(item.id, original.id)
  assert.equal(updated.selectedId, item.id)
  assert.deepEqual(store.readSelected(), { kind: 'ok', id: item.id, name: 'Final', text: 'Second body', bytes: 11, warnings: [] })
  assert.deepEqual(createCatalogStore(root).list(), updated)
})

it('rejects official, unknown, invalid, and colliding edits without touching the catalog', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  const first = store.addCustom({ name: 'First', text: 'One' }).items.find(item => item.kind === 'custom')
  store.addCustom({ name: 'Second', text: 'Two' })
  const before = fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8')
  assert.throws(() => store.updateCustom({ id: OFFICIAL_CURRENT_ID, name: 'X', text: 'Y' }), /Only custom prompts/u)
  assert.throws(() => store.updateCustom({ id: `custom:sha256:${'0'.repeat(64)}`, name: 'X', text: 'Y' }), /Unknown prompt id/u)
  assert.throws(() => store.updateCustom({ id: first.id, name: 'Second', text: 'Two' }), /already has this name and text/u)
  assert.throws(() => store.updateCustom({ id: first.id, name: '', text: 'One' }))
  assert.throws(() => store.updateCustom({ id: first.id, name: 'First', text: 'One', extra: true }))
  assert.equal(fs.readFileSync(join(root, CATALOG_FILENAME), 'utf8'), before)
  assert.equal(store.list().selectedId, OFFICIAL_CURRENT_ID)
})

it('deletes custom prompts and falls back to the official prompt when the active one is removed', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  const snapshot = store.syncOfficial({ text: 'Official', version: '1' }).items.find(item => item.kind === 'official-snapshot')
  const item = store.addCustom({ name: 'Temporary', text: 'Body' }).items.find(entry => entry.kind === 'custom')
  store.select(item.id)
  const removed = store.removePrompt(item.id)
  assert.equal(removed.selectedId, OFFICIAL_CURRENT_ID)
  assert.equal(removed.items.some(entry => entry.id === item.id), false)
  assert.deepEqual(store.readSelected(), { kind: 'official' })
  assert.deepEqual(createCatalogStore(root).list(), removed)
  const kept = store.addCustom({ name: 'Kept', text: 'Kept body' }).items.find(entry => entry.kind === 'custom')
  assert.equal(store.removePrompt(kept.id).selectedId, OFFICIAL_CURRENT_ID)
  assert.throws(() => store.removePrompt(OFFICIAL_CURRENT_ID), /installed official option cannot be deleted/u)
  assert.throws(() => store.removePrompt(snapshot.id), /installed official version cannot be deleted/u)
  assert.throws(() => store.removePrompt(kept.id), /Unknown prompt id/u)
})

it('deletes older official snapshots when selected and keeps the installed snapshot protected', () => {
  const root = temporaryRoot()
  const store = createCatalogStore(root)
  const older = store.syncOfficial({ text: 'Old official', version: '0.1.0' }).items.find(item => item.kind === 'official-snapshot')
  store.syncOfficial({ text: 'New official', version: '0.2.0' })
  const installed = store.installedSnapshotId()
  assert.equal(store.list().items.filter(item => item.kind === 'official-snapshot').length, 2)
  assert.notEqual(older.id, installed)
  store.select(older.id)
  const removed = store.removePrompt(older.id)
  assert.equal(removed.selectedId, OFFICIAL_CURRENT_ID)
  assert.equal(removed.items.some(item => item.id === older.id), false)
  assert.equal(store.list().items.some(item => item.id === installed), true)
  assert.throws(() => store.removePrompt(installed), /installed official version cannot be deleted/u)
  assert.equal(store.installedSnapshotId(), installed)
})

it('refuses directory and symbolic-link catalog paths and legacy directory escapes', t => {
  const root = temporaryRoot()
  fs.mkdirSync(join(root, CATALOG_FILENAME))
  assert.throws(() => createCatalogStore(root), /not a regular file/u)
  const outside = temporaryRoot()
  const linkedRoot = temporaryRoot()
  try {
    fs.symlinkSync(outside, join(linkedRoot, 'active'), 'junction')
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.diagnostic('Symbolic-link creation is unavailable; directory path rejection was verified')
      return
    }
    throw error
  }
  assert.throws(() => createCatalogStore(linkedRoot), /unsafe/u)
})
