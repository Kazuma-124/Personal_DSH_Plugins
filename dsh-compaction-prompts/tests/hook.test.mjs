import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { loadOfficialModules, patchEngine, strictMode, summarizeWithInstruction } from '../index.js'
import { ACTIVE_DIRECTORY, ensurePromptLayout } from '../prompt-store.js'

let Engine
let llm

before(async () => {
  ({ Engine, llm } = await loadOfficialModules())
})

/** Prompt text that cannot be confused with the built-in instruction. */
const CUSTOM_PROMPT = 'CUSTOM INSTRUCTION: answer with the single word CHECKPOINT.'

/** Newest instruction handed to the fake LLM stream. */
let captured

/** Minimal host context: one streaming call plus logging. */
function fakeContext() {
  return {
    llm: {
      async *stream(options) {
        captured = options
        yield { type: 'text-delta', index: 0, text: 'HELLO' }
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  }
}

/** Resolved backend configuration accepted by the built-in implementation. */
function fakeEngineConfig() {
  return {
    thresholdRatio: 0.8,
    headroomTokens: 65536,
    retainRatio: 0.16,
    summarizationProvider: '',
    summarizationModel: '',
    maxTokens: 64,
    compactionRetries: 1,
    maxOverflowRetries: 1,
    modelPolicies: [],
    auto: true,
  }
}

/** Agent stub carrying a routed model and an empty tool history. */
function fakeAgent() {
  return {
    options: {},
    session: {
      id: 'session-test',
      requestHeader: () => ({ config: { provider: 'test-provider', model: 'test-model' } }),
      toolHistory: () => [],
    },
  }
}

/** Fresh counters in the shape `patchEngine` mutates. */
function fakeState() {
  return {
    patch: 'pending',
    calls: 0,
    custom: 0,
    fallbacks: 0,
    rejected: 0,
    readErrors: 0,
    lastReadError: undefined,
    active: undefined,
    reported: new Set(),
  }
}

const input = { messages: [{ role: 'system', content: [{ type: 'text', text: 'system prompt' }] }] }

describe('patchEngine', () => {
  let root
  let dispose
  let state

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'dsh-compaction-hook-'))
    ensurePromptLayout(root)
    writeFileSync(join(root, ACTIVE_DIRECTORY, 'custom.md'), CUSTOM_PROMPT, 'utf8')
    state = fakeState()
    dispose = patchEngine(Engine, llm, fakeContext(), state, root)
  })

  after(() => {
    dispose()
    rmSync(root, { recursive: true, force: true })
  })

  it('sends the active file as the final instruction', async () => {
    const result = await Engine.prototype.summarize.call(
      { ctx: fakeContext(), config: fakeEngineConfig() },
      input,
      fakeAgent(),
      undefined,
    )
    assert.equal(captured.messages.at(-1).content[0].text, CUSTOM_PROMPT)
    assert.equal(captured.purpose, 'compaction')
    assert.equal(result.summary[0].text, 'HELLO')
    assert.equal(result.llmStreamCall, true)
    assert.equal(state.custom, 1)
  })

  it('falls back to the built-in instruction once active/ is emptied', async () => {
    unlinkSync(join(root, ACTIVE_DIRECTORY, 'custom.md'))
    await Engine.prototype.summarize.call(
      { ctx: fakeContext(), config: fakeEngineConfig() },
      input,
      fakeAgent(),
      undefined,
    )
    assert.match(captured.messages.at(-1).content[0].text, /You are now acting as a compaction engine/u)
    assert.equal(state.fallbacks, 1)
  })

  it('restores the original hook when disposed', () => {
    const patched = Engine.prototype.summarize
    dispose()
    assert.notEqual(Engine.prototype.summarize, patched)
    assert.equal(state.patch, 'restored')
  })
})

describe('strict mode', () => {
  it('reads the switch from the environment', () => {
    assert.equal(strictMode({ DSH_COMPACTION_PROMPTS_STRICT: '1' }), true)
    assert.equal(strictMode({ DSH_COMPACTION_PROMPTS_STRICT: ' ON ' }), true)
    assert.equal(strictMode({ DSH_COMPACTION_PROMPTS_STRICT: '0' }), false)
    assert.equal(strictMode({}), false)
  })

  it('fails the compaction instead of using the built-in instruction', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-compaction-strict-'))
    ensurePromptLayout(root)
    const state = fakeState()
    const dispose = patchEngine(Engine, llm, fakeContext(), state, root, true)
    try {
      await assert.rejects(
        Engine.prototype.summarize.call(
          { ctx: fakeContext(), config: fakeEngineConfig() },
          input,
          fakeAgent(),
          undefined,
        ),
        /严格模式/u,
      )
      assert.equal(state.rejected, 1)
      assert.equal(state.fallbacks, 0)

      writeFileSync(join(root, ACTIVE_DIRECTORY, 'custom.md'), CUSTOM_PROMPT, 'utf8')
      const result = await Engine.prototype.summarize.call(
        { ctx: fakeContext(), config: fakeEngineConfig() },
        input,
        fakeAgent(),
        undefined,
      )
      assert.equal(captured.messages.at(-1).content[0].text, CUSTOM_PROMPT)
      assert.equal(result.summary[0].text, 'HELLO')
    } finally {
      dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('summarizeWithInstruction', () => {
  it('rejects a summary without text content', async () => {
    const ctx = { llm: { async *stream() { yield { type: 'text-delta', index: 0, text: '   ' } } } }
    await assert.rejects(
      summarizeWithInstruction(ctx, fakeEngineConfig(), 'x', input, fakeAgent(), undefined, llm),
      /no text summary content/u,
    )
  })

  it('surfaces provider failures instead of returning an empty summary', async () => {
    const ctx = {
      llm: {
        async *stream() {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TEST_FAILURE', message: 'boom' } } }
        },
      },
    }
    await assert.rejects(
      summarizeWithInstruction(ctx, fakeEngineConfig(), 'x', input, fakeAgent(), undefined, llm),
    )
  })

  it('fails clearly when no summary target can be resolved', async () => {
    const agent = { options: {}, session: { id: 's', requestHeader: () => undefined } }
    await assert.rejects(
      summarizeWithInstruction({ llm: { async *stream() {} } }, fakeEngineConfig(), 'x', input, agent, undefined, llm),
      /no provider\/model available/u,
    )
  })
})
