export const API_PATH = '/api/compaction-prompts'

/** Shared operations used by the settings page and model-facing tool. */
export function createPromptOperations(catalog, state, syncOfficial) {
  return async (args = {}) => {
    const action = args.action ?? 'list'
    if (action === 'select') {
      if (state.patch !== 'installed') throw new Error('Prompt switching is unavailable: compaction hook is not installed')
      if (typeof args.id !== 'string' || args.id.length > 200) throw new TypeError('A prompt id is required')
      catalog.select(args.id)
    } else if (action === 'sync') {
      if (!syncOfficial) throw new Error('The installed official instruction is unavailable')
      await syncOfficial()
    } else if (action === 'add') {
      catalog.addCustom({ name: args.name, text: args.text })
    } else if (action === 'update') {
      if (typeof args.id !== 'string' || args.id.length === 0 || args.id.length > 200) throw new TypeError('A prompt id is required')
      catalog.updateCustom({ id: args.id, name: args.name, text: args.text })
    } else if (action === 'delete') {
      if (typeof args.id !== 'string' || args.id.length === 0 || args.id.length > 200) throw new TypeError('A prompt id is required')
      catalog.removePrompt(args.id)
    } else if (action !== 'list') throw new TypeError('Unknown action')
    return {
      ...catalog.list(),
      installedSnapshotId: catalog.installedSnapshotId(),
      status: state.patch,
      lastUsed: state.lastUsed ?? null,
      readError: state.lastReadError ?? null,
      error: state.patch === 'installed' ? null : state.lastReadError ?? 'Compaction hook unavailable',
    }
  }
}

export function registerPromptInterface(ctx, catalog, state, syncOfficial) {
  const operate = createPromptOperations(catalog, state, syncOfficial)
  const connection = ctx.get('connection')
  if (!connection) throw new Error('The authenticated Connection service is required for compaction prompt settings')
  ctx.effect(() => connection.fetch.register({
    path: API_PATH,
    methods: ['GET', 'POST'],
    // The HTTP bridge builds a Fetch Request body for streaming routes, and a
    // GET with a body is invalid. Buffered mode is required for a route that
    // answers both methods; the handler still enforces its own 400 KiB cap.
    requestBody: 'buffered',
    fetch: async request => {
      try {
        if (Number(request.headers.get('content-length') ?? 0) > 400 * 1024) throw new RangeError('Request too large')
        let args = { action: 'list' }
        if (request.method === 'POST') {
          const reader = request.body?.getReader()
          if (!reader) throw new TypeError('Missing JSON body')
          const chunks = []
          let length = 0
          try {
            for (;;) {
              const { value, done } = await reader.read()
              if (done) break
              length += value.byteLength
              if (length > 400 * 1024) { await reader.cancel(); throw new RangeError('Request too large') }
              chunks.push(Buffer.from(value))
            }
          } finally { reader.releaseLock() }
          try { args = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new TypeError('Invalid JSON request') }
          if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['action', 'id', 'name', 'text'].includes(key))) throw new TypeError('Invalid request')
        }
        return Response.json(await operate(args), { headers: { 'Cache-Control': 'no-store' } })
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, {
          status: error instanceof TypeError ? 400 : error instanceof RangeError ? 413 : 500,
          headers: { 'Cache-Control': 'no-store' },
        })
      }
    },
  }), 'compaction prompts settings API')
  const tools = ctx.get('tools')
  if (tools) ctx.effect(() => tools.register({
    name: 'compaction_prompt',
    description: 'List or inspect compaction prompts, add, edit, or delete a prompt, globally select one, or synchronize the installed DSH official prompt. Custom prompts can be edited and deleted; official version snapshots can be deleted except the installed version; the installed official option cannot be deleted. Selection affects future compactions across sessions.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'select', 'sync', 'add', 'update', 'delete'], description: 'Defaults to list.' },
        id: { type: 'string', description: 'Prompt id returned by list; required for select, update, and delete.' },
        name: { type: 'string', description: 'Custom prompt name, 1–120 characters; used by add and update.' },
        text: { type: 'string', description: 'Custom prompt body up to 64 KiB of UTF-8; used by add and update.' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: args => operate(args),
  }), 'compaction prompt tool')
}
