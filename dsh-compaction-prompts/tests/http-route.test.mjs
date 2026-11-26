import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import * as plugin from '../index.js'
import { API_PATH } from '../prompt-interface.js'

const fromInstall = createRequire(join(process.env.DSH_INSTALL_DIR, 'package.json'))
const load = async name => import(pathToFileURL(fromInstall.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const credentials = await load('@deepseek-ai/dsh-credentials-local')
const webServer = await load('@deepseek-ai/dsh-host-webserver')
const connection = await load('@deepseek-ai/dsh-client-connection')

test('the real HTTP carrier answers GET and guarded POST through the registered route', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prompt-http-'))
  const previousRoot = process.env.DSH_COMPACTION_PROMPTS_DIR
  process.env.DSH_COMPACTION_PROMPTS_DIR = join(root, 'prompts')
  const ctx = new Context()
  const fibers = []
  try {
    fibers.push(await ctx.plugin(credentials.default, { path: join(root, 'credentials.yaml'), watch: false }))
    fibers.push(await ctx.plugin(webServer.default, { host: '127.0.0.1', port: 0, compression: 'none' }))
    fibers.push(await ctx.plugin(connection, {}))
    fibers.push(await ctx.plugin(plugin))
    const host = ctx.get('connection')
    const origin = ctx.get('webServer').getOrigin()
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path: '/', handler: (req, res) => { host.authorizeIndex(req, res) },
    }))
    const login = await fetch(host.authenticatedUrl(`${origin}/`), { redirect: 'manual' })
    assert.equal(login.status, 303)
    const cookie = login.headers.getSetCookie()[0].split(';')[0]
    const authorized = (method, body) => fetch(origin + API_PATH, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body }),
    })
    const unauthenticated = await fetch(origin + API_PATH)
    assert.equal(unauthenticated.status, 401)
    const listed = await authorized('GET')
    assert.equal(listed.status, 200)
    const result = await listed.json()
    assert.equal(result.status, 'installed')
    assert.equal(result.selectedId, 'official:current')
    assert.ok(result.items.some(item => item.kind === 'official-snapshot'))
    assert.equal(result.installedSnapshotId, result.items.find(item => item.kind === 'official-snapshot').id)
    const added = await authorized('POST', JSON.stringify({ action: 'add', name: 'From HTTP', text: 'Custom instruction' }))
    assert.equal(added.status, 200)
    const addedItem = (await added.json()).items.find(item => item.name === 'From HTTP')
    const edited = await authorized('POST', JSON.stringify({ action: 'update', id: addedItem.id, name: 'Edited over HTTP', text: 'Edited instruction' }))
    assert.equal(edited.status, 200)
    const editedItem = (await edited.json()).items.find(item => item.name === 'Edited over HTTP')
    assert.equal(editedItem.text, 'Edited instruction')
    const removed = await authorized('POST', JSON.stringify({ action: 'delete', id: editedItem.id }))
    assert.equal(removed.status, 200)
    assert.equal((await removed.json()).items.some(item => item.name === 'Edited over HTTP'), false)
    const officialDelete = await authorized('POST', JSON.stringify({ action: 'delete', id: 'official:current' }))
    assert.equal(officialDelete.status, 400)
    const installedDelete = await authorized('POST', JSON.stringify({ action: 'delete', id: result.installedSnapshotId }))
    assert.equal(installedDelete.status, 400)
    const oversized = await authorized('POST', JSON.stringify({ action: 'add', name: 'Large', text: 'x'.repeat(400 * 1024) }))
    assert.equal(oversized.status, 413)
    const malformed = await authorized('POST', '{')
    assert.equal(malformed.status, 400)
  } finally {
    for (const fiber of fibers.reverse()) await fiber.dispose()
    if (previousRoot === undefined) delete process.env.DSH_COMPACTION_PROMPTS_DIR
    else process.env.DSH_COMPACTION_PROMPTS_DIR = previousRoot
    rmSync(root, { recursive: true, force: true })
  }
})
