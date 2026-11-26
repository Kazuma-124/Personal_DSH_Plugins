/**
 * Apply the globally selected catalog instruction through the shared backend
 * summarize hook. Agent presets have isolated compaction realms but share the
 * backend class. Selecting official:current delegates to the original method;
 * other entries replace only the instruction in that same implementation.
 * @module @kazuma-124/dsh-compaction-prompts
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createCatalogStore } from './catalog-store.js'
import { captureOfficialPrompt, summarizeWithPrompt } from './official-prompt.js'
import { registerPromptInterface } from './prompt-interface.js'

import { readActivePrompt, resolvePromptRoot } from './prompt-store.js'

/** Plugin name shown in host diagnostics. */
export const name = 'compaction-prompts'

/** Wait for the authenticated HTTP carrier before mounting settings routes. */
export const inject = ['connection']

/** Marker key that makes the prototype patch idempotent across reloads. */
const PATCH_STATE = Symbol.for('@kazuma-124/dsh-compaction-prompts/patch')

/** Environment variable that turns a missing prompt into a compaction failure. */
export const STRICT_ENVIRONMENT_VARIABLE = 'DSH_COMPACTION_PROMPTS_STRICT'

/** Values accepted as "on" for {@link STRICT_ENVIRONMENT_VARIABLE}. */
const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

/**
 * Whether an unusable `active/` must fail the compaction instead of falling
 * back to the built-in instruction.
 * @param environment - process environment to read.
 * @returns true when the strict switch is on.
 */
export function strictMode(environment = process.env) {
  const raw = environment[STRICT_ENVIRONMENT_VARIABLE]
  return typeof raw === 'string' && TRUTHY.has(raw.trim().toLowerCase())
}

/**
 * Where the running installation keeps its packages. The Desktop build exposes
 * the CLI environment variable; the packaged layout is the fallback.
 * @returns candidate installation anchors, most specific first.
 */
function installAnchorCandidates() {
  const candidates = []
  const configured = process.env.DSH_INSTALL_DIR
  if (typeof configured === 'string' && configured.length > 0) candidates.push(configured)
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    candidates.push(join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh'))
  }
  return candidates
}

/**
 * Load the compaction backend and LLM helpers from the running installation.
 *
 * Importing by resolved file URL keeps the module instance identical to the one
 * agent presets instantiate; a separately installed copy would receive the
 * patch without ever borrowing it.
 *
 * @returns the engine class and the LLM helpers used by the summary call.
 * @throws When no candidate anchor resolves both packages.
 */
export async function loadOfficialModules() {
  const failures = []
  for (const anchor of installAnchorCandidates()) {
    try {
      const fromInstall = createRequire(join(anchor, 'package.json'))
      const basicPath = fromInstall.resolve('@deepseek-ai/dsh-compaction-basic')
      const llmPath = fromInstall.resolve('@deepseek-ai/dsh-llm')
      const [basic, llm] = await Promise.all([
        import(pathToFileURL(basicPath).href),
        import(pathToFileURL(llmPath).href),
      ])
      const Engine = basic.BasicCompactionEngine ?? basic.default
      if (typeof Engine !== 'function') throw new Error('BasicCompactionEngine export is missing')
      if (typeof Engine.prototype.summarize !== 'function') throw new Error('summarize hook is missing')
      const backendPackage = JSON.parse(readFileSync(join(dirname(basicPath), '..', 'package.json'), 'utf8'))
      return { Engine, llm, version: backendPackage.version }
    } catch (error) {
      failures.push(`${anchor}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`cannot load the compaction backend (${failures.join('; ')})`)
}

/** Raised when the summary request ends in a terminal provider failure. */
function terminalFailure(llm, finish) {
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    return llm.LlmError.fromFailure(finish.failure)
  }
  if (finish.kind === 'max-tokens') {
    const error = new Error('summarization truncated at the token cap (incomplete checkpoint)')
    error.code = 'MAX_TOKENS'
    return error
  }
  return undefined
}

/**
 * Run the auxiliary summary request with a caller-supplied instruction.
 *
 * The conversation prefix is replayed verbatim so the provider's warm prefix
 * cache still applies; only the trailing instruction differs from the built-in
 * request.
 *
 * @param ctx - context of the engine running the compaction, which owns `llm`.
 * @param config - resolved backend configuration (summary target and cap).
 * @param instruction - prompt read from `active/`.
 * @param input - replayed conversation prefix to condense.
 * @param agent - supplies routed-model history, fallback model, and session id.
 * @param signal - optional cancellation forwarded to the adapter.
 * @param llm - LLM helpers from the running installation.
 * @returns the text-only summary plus the exact request envelope.
 */
export async function summarizeWithInstruction(ctx, config, instruction, input, agent, signal, llm) {
  const latest = agent.session.requestHeader()?.config
  const configured = typeof config?.summarizationProvider === 'string' && config.summarizationProvider.length > 0
    ? { provider: config.summarizationProvider, model: config.summarizationModel }
    : undefined
  const agentTarget = typeof agent.options?.provider === 'string' && agent.options.provider.length > 0
    && typeof agent.options?.model === 'string' && agent.options.model.length > 0
    ? { provider: agent.options.provider, model: agent.options.model }
    : undefined
  const target = configured ?? latest ?? agentTarget
  if (target === undefined) {
    throw new Error(
      'no provider/model available for summarization: route one request, or set summarizationProvider and summarizationModel',
    )
  }

  const messages = [
    ...input.messages,
    { role: 'user', content: [{ type: 'text', text: instruction }] },
  ]
  const options = {
    provider: target.provider,
    model: target.model,
    messages,
    toolHistory: typeof agent.session.toolHistory === 'function' ? agent.session.toolHistory() : undefined,
    ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
    maxTokens: config.maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
    ...(signal === undefined ? {} : { signal }),
  }

  const assembler = new llm.BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  const failure = terminalFailure(llm, assembler.finish)
  if (failure !== undefined) throw failure

  const rawOutput = assembler.blocks()
  if (llm.contentHasImage(rawOutput)) {
    throw new llm.LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
  }
  const summary = rawOutput.filter(block => block.type === 'text')
  if (!summary.some(block => block.text.trim().length > 0)) {
    throw new Error('summarization produced no text summary content')
  }
  const usage = assembler.usage
  return {
    summary,
    rawOutput,
    llmStreamCall: true,
    provider: options.provider,
    model: options.model,
    maxTokens: options.maxTokens,
    ...(usage === undefined ? {} : { usage }),
  }
}

/**
 * Apply the catalog selection through the official `summarize` hook.
 * The file-backed path remains available to callers that omit the catalog.
 * @param Engine - the backend class agent presets instantiate.
 * @param llm - LLM helpers from the running installation.
 * @param ctx - host context used for logging.
 * @param state - mutable counters and the last prompt decision.
 * @param root - layout root resolved for this process.
 * @param strict - whether an unusable `active/` fails the compaction.
 * @returns a disposer that restores the original hook.
 */
export function patchEngine(Engine, llm, ctx, state, root, strict = false, catalog) {
  const prototype = Engine.prototype
  if (prototype[PATCH_STATE] !== undefined) {
    state.patch = 'already-patched'
    return () => {}
  }
  const original = prototype.summarize
  if (typeof original !== 'function') throw new Error('summarize hook is missing')

  const patched = async function summarize(input, agent, signal) {
    state.calls += 1
    let prompt
    try {
      prompt = catalog ? catalog.readSelected() : readActivePrompt(root)
    } catch (error) {
      state.readErrors += 1
      state.lastReadError = error instanceof Error ? error.message : String(error)
    }
    if (prompt?.kind === 'official') {
      state.fallbacks += 1
      state.active = prompt
      const result = await original.call(this, input, agent, signal)
      state.lastUsed = { id: 'official:current', name: 'DSH official', at: new Date().toISOString() }
      state.lastReadError = undefined
      return result
    }
    if (catalog && (prompt === undefined || prompt.kind !== 'ok')) {
      state.rejected += 1
      throw new Error(`Compaction prompt unavailable: ${state.lastReadError ?? 'invalid selection'}`)
    }
    if (prompt === undefined || prompt.kind !== 'ok') {
      const reason = prompt?.reason ?? state.lastReadError ?? 'active/ 无法读取'
      if (strict) {
        state.rejected += 1
        state.active = prompt
        throw new Error(
          `compaction prompt: ${reason}；严格模式下不压缩，请把提示词放进 ${root} 的 active/ 目录。`,
        )
      }
      state.fallbacks += 1
      state.active = prompt
      return original.call(this, input, agent, signal)
    }
    state.custom += 1
    state.active = prompt
    for (const warning of prompt.warnings) {
      const key = `${prompt.path}:${prompt.modifiedMs}:${warning}`
      if (state.reported.has(key)) continue
      state.reported.add(key)
      ctx.logger.warn(`compaction prompt: ${warning}`)
    }
    const result = await summarizeWithPrompt(original, this, input, agent, signal, prompt.text)
    state.lastUsed = { id: prompt.id ?? prompt.name, name: prompt.name, at: new Date().toISOString() }
    state.lastReadError = undefined
    return result
  }
  Object.defineProperty(patched, 'name', { value: 'summarize' })
  Object.defineProperty(prototype, PATCH_STATE, {
    value: { patched, original },
    configurable: true,
  })
  prototype.summarize = patched
  state.patch = 'installed'
  return () => {
    if (prototype.summarize === patched) prototype.summarize = original
    delete prototype[PATCH_STATE]
    state.patch = 'restored'
  }
}

/**
 * Mount the catalog-backed summary hook and the settings/tool interface.
 * Catalog failures remain visible and reject compaction until repaired;
 * incompatible official backends leave the hook unavailable.
 * @param ctx - host context.
 */
export async function apply(ctx) {
  const root = resolvePromptRoot()
  let initializedCatalog
  const getCatalog = () => initializedCatalog ??= createCatalogStore(root)
  // Failed initialization is not cached, so repairing the catalog needs no reload.
  const catalog = Object.fromEntries(
    ['list', 'select', 'readSelected', 'syncOfficial', 'addCustom', 'updateCustom', 'removePrompt', 'installedSnapshotId'].map(method => [
      method, (...args) => getCatalog()[method](...args),
    ]),
  )
  const state = {
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

  let syncOfficial
  try {
    const { Engine, llm, version } = await loadOfficialModules()
    const text = await captureOfficialPrompt(Engine)
    syncOfficial = async () => {
      try {
        const result = catalog.syncOfficial({ text, version })
        state.lastReadError = undefined
        return result
      } catch (error) {
        state.lastReadError = error instanceof Error ? error.message : String(error)
        throw error
      }
    }
    try {
      await syncOfficial()
    } catch (error) {
      ctx.logger.error(`compaction prompt catalog: ${error instanceof Error ? error.message : String(error)}`)
    }
    ctx.effect(
      () => patchEngine(Engine, llm, ctx, state, root, false, catalog),
      'compaction prompt summarize hook',
    )
  } catch (error) {
    ctx.logger.error(`compaction prompt: ${error instanceof Error ? error.message : String(error)}`)
    state.patch = 'unavailable'
    state.lastReadError = error instanceof Error ? error.message : String(error)
  }

  registerPromptInterface(ctx, catalog, state, syncOfficial)
}
