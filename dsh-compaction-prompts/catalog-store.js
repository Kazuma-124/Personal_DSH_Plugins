/** A single-selection prompt catalog with content-addressed official history. */
import {
  closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { TextDecoder } from 'node:util'
import { MAX_PROMPT_BYTES } from './prompt-store.js'

export const CATALOG_FILENAME = 'catalog.json'
export const OFFICIAL_CURRENT_ID = 'official:current'
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex')
const snapshotId = text => `official:sha256:${hash(text)}`
const customId = (name, text) => `custom:sha256:${hash(`${name}\n${text}`)}`

function validCustomName(name) {
  if (typeof name !== 'string' || name.trim().length === 0 || name !== name.trim() || name.length > 120 || !name.isWellFormed()) fail('invalid custom name')
}
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function fail(message) {
  throw new Error(`Invalid prompt catalog: ${message}`)
}

function keys(value, required, optional = []) {
  if (!isObject(value)) fail('expected an object')
  if (required.some(key => !Object.hasOwn(value, key))) fail('missing required field')
  if (Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('unknown field')
}

function validText(text, allowEmpty = false) {
  if (typeof text !== 'string' || (!allowEmpty && text.trim().length === 0)) fail('invalid prompt text')
  // Unpaired UTF-16 surrogates cannot round-trip through UTF-8 without replacement.
  if (!text.isWellFormed() || Buffer.byteLength(text, 'utf8') > MAX_PROMPT_BYTES) fail('invalid prompt size or encoding')
}

function validate(document) {
  keys(document, ['schemaVersion', 'selectedId', 'items'])
  if (document.schemaVersion !== 1) fail('unsupported schemaVersion')
  if (typeof document.selectedId !== 'string' || !Array.isArray(document.items)) fail('invalid selection or items')
  const ids = new Set()
  let current
  for (const item of document.items) {
    keys(item, ['id', 'name', 'kind', 'text'], ['version', 'createdAt'])
    if (typeof item.id !== 'string' || ids.has(item.id)) fail('invalid or duplicate id')
    ids.add(item.id)
    if (typeof item.name !== 'string' || item.name.trim().length === 0 || !item.name.isWellFormed()) fail('invalid name')
    if (Object.hasOwn(item, 'version') && (typeof item.version !== 'string' || item.version.trim().length === 0 || !item.version.isWellFormed())) fail('invalid version')
    if (Object.hasOwn(item, 'createdAt') && (typeof item.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(item.createdAt) || !Number.isFinite(Date.parse(item.createdAt)) || new Date(item.createdAt).toISOString() !== item.createdAt)) fail('invalid createdAt')
    if (item.id === OFFICIAL_CURRENT_ID) {
      if (item.kind !== 'official') fail('invalid official current kind')
      validText(item.text, true)
      if (item.text !== '' && item.text.trim().length === 0) fail('blank official text')
      current = item
    } else if (item.kind === 'official-snapshot') {
      validText(item.text)
      if (item.id !== snapshotId(item.text) || !Object.hasOwn(item, 'createdAt')) fail('invalid official snapshot')
    } else if (item.kind === 'custom') {
      validText(item.text)
      if (!/^legacy:[a-f0-9]{64}$/u.test(item.id)) {
        validCustomName(item.name)
        if (item.id !== customId(item.name, item.text)) fail('invalid custom id')
      }
      if (Object.hasOwn(item, 'version')) fail('custom item cannot have an official version')
    } else {
      fail('invalid item kind')
    }
  }
  if (current === undefined) fail('official:current is missing')
  if (!ids.has(document.selectedId)) fail('selected prompt is missing')
  if (current.text !== '' && !ids.has(snapshotId(current.text))) fail('official current has no history snapshot')
  return document
}

function regularFile(path) {
  const stats = lstatSync(path)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Prompt catalog path is not a regular file: ${path}`)
  return stats
}

function readDocument(path) {
  regularFile(path)
  const text = decoder.decode(readFileSync(path))
  const document = JSON.parse(text)
  // JSON.parse accepts duplicate object keys; a catalog must not have ambiguous
  // selections or fields whose meaning depends on a parser's overwrite policy.
  const stack = []
  for (const [token] of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/gu)) {
    const frame = stack.at(-1)
    if (token === '{') stack.push({ names: new Set(), expectingKey: true })
    else if (token === '[') stack.push(null)
    else if (token === '}' || token === ']') stack.pop()
    else if (frame && token === ':') frame.expectingKey = false
    else if (frame && token === ',') frame.expectingKey = true
    else if (frame?.expectingKey && token.startsWith('"')) {
      const key = JSON.parse(token)
      if (frame.names.has(key)) fail('duplicate JSON object key')
      frame.names.add(key)
    }
  }
  return validate(document)
}

/** Commit a complete document by replacing the destination in the same directory. */
function atomicWrite(root, path, document) {
  validate(document)
  const temporaryPath = join(root, `.catalog-${randomUUID()}.tmp`)
  let descriptor
  let created = false
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600)
    created = true
    writeFileSync(descriptor, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporaryPath, path)
    created = false
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    if (created) unlinkSync(temporaryPath)
  }
}

function importLegacy(root) {
  const document = {
    schemaVersion: 1,
    selectedId: OFFICIAL_CURRENT_ID,
    items: [{ id: OFFICIAL_CURRENT_ID, name: 'Official current', kind: 'official', text: '' }],
  }
  for (const folder of ['active', 'presets']) {
    const directory = join(root, folder)
    let stats
    try {
      stats = lstatSync(directory)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`Legacy prompt directory is unsafe: ${directory}`)
    const entries = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(?:md|txt)$/iu.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const fileStats = regularFile(path)
      if (fileStats.size > MAX_PROMPT_BYTES) continue
      let text
      try {
        text = decoder.decode(readFileSync(path))
      } catch (error) {
        if (error instanceof TypeError && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') continue
        throw error
      }
      if (text.startsWith('\uFEFF')) text = text.slice(1)
      if (text.trim().length === 0 || Buffer.byteLength(text, 'utf8') > MAX_PROMPT_BYTES) continue
      const id = `legacy:${hash(`${folder}/${entry.name}`)}`
      document.items.push({ id, name: entry.name, kind: 'custom', text })
      if (folder === 'active' && document.selectedId === OFFICIAL_CURRENT_ID) document.selectedId = id
    }
  }
  return document
}

/**
 * Open a synchronous catalog. All operations reread the JSON so independent
 * callers observe the same global selection. Legacy files are imported only
 * when the catalog is first created; afterward the JSON owns their contents.
 * Errors propagate without changing a cached or fallback selection.
 */
export function createCatalogStore(root) {
  if (typeof root !== 'string' || root.trim().length === 0) throw new TypeError('A prompt root is required')
  const directory = resolve(root)
  const path = join(directory, CATALOG_FILENAME)
  mkdirSync(directory, { recursive: true })
  try {
    readDocument(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    atomicWrite(directory, path, importLegacy(directory))
  }
  const list = () => {
    const { selectedId, items } = readDocument(path)
    return { selectedId, items }
  }
  return {
    list,
    addCustom(input) {
      keys(input, ['name', 'text'])
      if (typeof input.name !== 'string') fail('invalid custom name')
      const name = input.name.trim()
      validCustomName(name)
      validText(input.text)
      const document = readDocument(path)
      const id = customId(name, input.text)
      if (!document.items.some(item => item.id === id)) {
        document.items.push({ id, name, kind: 'custom', text: input.text, createdAt: new Date().toISOString() })
        atomicWrite(directory, path, document)
      }
      return { selectedId: document.selectedId, items: document.items }
    },
    updateCustom(input) {
      keys(input, ['id', 'name', 'text'])
      const name = typeof input.name === 'string' ? input.name.trim() : input.name
      validCustomName(name)
      validText(input.text)
      const document = readDocument(path)
      const item = document.items.find(entry => entry.id === input.id)
      if (item === undefined) throw new TypeError('Unknown prompt id')
      if (item.kind !== 'custom') throw new TypeError('Only custom prompts can be edited')
      const id = customId(name, input.text)
      if (id === item.id) return { selectedId: document.selectedId, items: document.items }
      if (document.items.some(entry => entry.id === id)) throw new TypeError('Another prompt already has this name and text')
      item.id = id
      item.name = name
      item.text = input.text
      if (document.selectedId === input.id) document.selectedId = id
      atomicWrite(directory, path, document)
      return { selectedId: document.selectedId, items: document.items }
    },
    removePrompt(id) {
      const document = readDocument(path)
      const at = document.items.findIndex(entry => entry.id === id)
      if (at === -1) throw new TypeError('Unknown prompt id')
      const item = document.items[at]
      if (item.kind === 'official') throw new TypeError('The installed official option cannot be deleted')
      const current = document.items.find(entry => entry.id === OFFICIAL_CURRENT_ID)
      if (item.kind === 'official-snapshot' && item.id === (current.text === '' ? null : snapshotId(current.text))) {
        throw new TypeError('The installed official version cannot be deleted')
      }
      document.items.splice(at, 1)
      if (document.selectedId === id) document.selectedId = OFFICIAL_CURRENT_ID
      atomicWrite(directory, path, document)
      return { selectedId: document.selectedId, items: document.items }
    },
    installedSnapshotId() {
      const document = readDocument(path)
      const current = document.items.find(item => item.id === OFFICIAL_CURRENT_ID)
      return current.text === '' ? null : snapshotId(current.text)
    },
    syncOfficial(input) {
      keys(input, ['text', 'version'])
      validText(input.text)
      if (typeof input.version !== 'string' || input.version.trim().length === 0 || !input.version.isWellFormed()) throw new TypeError('An official version is required')
      const document = readDocument(path)
      const current = document.items.find(item => item.id === OFFICIAL_CURRENT_ID)
      const id = snapshotId(input.text)
      if (!document.items.some(item => item.id === id)) {
        document.items.push({ id, name: `Official ${input.version}`, kind: 'official-snapshot', text: input.text, version: input.version, createdAt: new Date().toISOString() })
      }
      if (current.text === input.text && current.version === input.version) return { selectedId: document.selectedId, items: document.items }
      current.text = input.text
      current.version = input.version
      atomicWrite(directory, path, document)
      return { selectedId: document.selectedId, items: document.items }
    },
    select(id) {
      const document = readDocument(path)
      if (typeof id !== 'string' || !document.items.some(item => item.id === id)) throw new Error('Unknown prompt id')
      if (document.selectedId !== id) {
        document.selectedId = id
        atomicWrite(directory, path, document)
      }
      return { selectedId: document.selectedId, items: document.items }
    },
    readSelected() {
      const document = readDocument(path)
      if (document.selectedId === OFFICIAL_CURRENT_ID) return { kind: 'official' }
      const item = document.items.find(item => item.id === document.selectedId)
      return { kind: 'ok', id: item.id, name: item.name, text: item.text, bytes: Buffer.byteLength(item.text, 'utf8'), warnings: [] }
    },
  }
}
