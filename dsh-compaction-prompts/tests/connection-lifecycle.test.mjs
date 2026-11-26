import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { test } from 'node:test'
import * as plugin from '../index.js'
import { API_PATH, registerPromptInterface } from '../prompt-interface.js'

const fromInstall = createRequire(join(process.env.DSH_INSTALL_DIR, 'package.json'))
const { Context } = await import(pathToFileURL(fromInstall.resolve('@deepseek-ai/cordis')).href)
const { HostConnectionService } = await import(pathToFileURL(fromInstall.resolve('@deepseek-ai/dsh-client-connection')).href)

test('late Connection activates the real plugin and dispatches its settings route; disposal removes it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prompt-connection-'))
  const previousRoot = process.env.DSH_COMPACTION_PROMPTS_DIR
  process.env.DSH_COMPACTION_PROMPTS_DIR = root
  const ctx = new Context()
  let connection, provider
  const consumer = ctx.plugin(plugin)
  try {
    await consumer
    assert.equal(connection, undefined)
    assert.deepEqual(plugin.inject, ['connection'])
    provider = ctx.plugin({ apply(c) { connection = new HostConnectionService(c, [], {}) } })
    await provider
    await consumer
    const handler = connection.createSharedFetchHandler('/api')
    const request = () => new Request('http://localhost' + API_PATH)
    assert.equal(handler.requestBodyMode({ method: 'GET', url: new URL('http://localhost' + API_PATH) }), 'buffered')
    assert.equal(handler.requestBodyMode({ method: 'POST', url: new URL('http://localhost' + API_PATH) }), 'buffered')
    const response = await handler.fetch(request(), connection.browserPeer)
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.status, 'installed')
    assert.equal(result.selectedId, 'official:current')
    assert.ok(result.items.some(item => item.kind === 'official-snapshot'))
    await provider.dispose()
    await consumer
    assert.equal((await handler.fetch(request(), connection.browserPeer)).status, 404)
  } finally {
    await consumer.dispose()
    if (provider) await provider.dispose()
    if (previousRoot === undefined) delete process.env.DSH_COMPACTION_PROMPTS_DIR
    else process.env.DSH_COMPACTION_PROMPTS_DIR = previousRoot
    rmSync(root, { recursive: true, force: true })
  }
})

test('missing Connection cannot silently skip settings registration', () => {
  assert.throws(() => registerPromptInterface({ get() {} }, {}, {}), /Connection service is required/)
})

for (const [status, body, expected] of [
  [404, 'not found', /设置接口不存在.*HTTP 404.*重启 DSH/u],
  [502, '<html>upstream unavailable</html>', /无效响应.*HTTP 502/u],
]) {
  test(`client explains HTTP ${status} plain-text responses without a JSON parser error`, async () => {
    let module, component, effect
    const updates = []
    const react = {
      createElement() {},
      useState(initial) { return [typeof initial === 'function' ? initial() : initial, value => updates.push(value)] },
      useRef: initial => ({ current: initial }),
      useEffect(callback) { effect = callback },
    }
    vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
      window: {
        __ModuleLoader__: { load(value) { module = value.factory(() => react) } },
        fetch: async () => new Response(body, { status }),
        addEventListener() {}, removeEventListener() {}, setInterval() {}, clearInterval() {},
      },
      document: { hidden: false },
    })
    module.apply({
      locale: { getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} },
      slots: { inject(_key, callback) { callback() }, register(_entry, page) { component = page } },
    })
    component()
    const cleanup = effect()
    await new Promise(resolve => setImmediate(resolve))
    cleanup()
    assert.ok(updates.some(value => typeof value === 'string' && expected.test(value)), JSON.stringify(updates))
    assert.ok(!updates.some(value => typeof value === 'string' && value.includes('Unexpected token')))
  })
}
