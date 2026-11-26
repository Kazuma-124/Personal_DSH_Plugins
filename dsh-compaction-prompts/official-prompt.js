/** Capture the installed backend's instruction without making a model request. */
export async function captureOfficialPrompt(Engine) {
  const marker = Symbol.for('@kazuma-124/dsh-compaction-prompts/patch')
  const original = Engine.prototype[marker]?.original ?? Engine.prototype.summarize
  const stopped = new Error('instruction captured')
  let instruction
  const receiver = {
    config: { summarizationProvider: '', summarizationModel: '', maxTokens: 1, modelPolicies: [] },
    ctx: { llm: { stream(options) {
      const message = options.messages.at(-1)
      if (message?.role !== 'user' || !Array.isArray(message.content)) throw new Error('Unsupported official instruction format')
      instruction = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      throw stopped
    } } },
  }
  const agent = { options: { provider: 'capture', model: 'capture' }, session: {
    id: 'instruction-capture', requestHeader: () => undefined, toolHistory: () => [],
  } }
  try {
    await original.call(receiver, { messages: [] }, agent)
  } catch (error) {
    if (error !== stopped) throw error
  }
  if (typeof instruction !== 'string' || instruction.trim().length === 0) throw new Error('Official instruction could not be captured')
  return instruction
}

/** Preserve the official model policy and request assembly, replacing only its instruction. */
export function summarizeWithPrompt(original, engine, input, agent, signal, text) {
  const llm = new Proxy(engine.ctx.llm, {
    get(target, key) {
      if (key !== 'stream') return Reflect.get(target, key, target)
      return (options, ...rest) => {
        const last = options.messages.at(-1)
        if (last?.role !== 'user' || !Array.isArray(last.content) || last.content.some(block => block.type !== 'text')) {
          throw new Error('Unsupported official instruction format')
        }
        return target.stream({ ...options, messages: [
          ...options.messages.slice(0, -1), { ...last, content: [{ type: 'text', text }] },
        ] }, ...rest)
      }
    },
  })
  const ctx = new Proxy(engine.ctx, { get: (target, key) => key === 'llm' ? llm : Reflect.get(target, key, target) })
  const receiver = Object.create(engine)
  Object.defineProperty(receiver, 'ctx', { value: ctx })
  return original.call(receiver, input, agent, signal)
}
