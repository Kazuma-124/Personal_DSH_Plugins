import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDiskStore, MAX_NOTE_BYTES } from './disk-store.js';

export const inject = ['connection'];
export const API_PATH = '/api/conversation-notebook/';
export function defaultDataDirectory() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'conversation-notebook');
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
async function inputOf(request) {
  // JSON may expand each UTF-8 control character into a six-byte escape.
  const limit = MAX_NOTE_BYTES * 6 + 8192;
  const reader = request.body?.getReader();
  if (!reader) throw new TypeError('Missing JSON body');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RangeError('Request too large'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Connection owns authentication, owner admission and route lifecycle on both
// Desktop and Web. No public webServer route or model tool exposes these notes.
export function apply(ctx) {
  const store = createDiskStore(defaultDataDirectory());
  registerNotebookRoutes(ctx, store);
}

export function registerNotebookRoutes(ctx, store) {
  for (const action of ['read', 'write', 'import']) {
    ctx.connection.fetch.register({
      path: API_PATH + action, methods: ['POST'], requestBody: 'streaming',
      fetch: async request => {
        try {
          const input = await inputOf(request);
          const allowed = action === 'read' ? ['sessionId'] : action === 'write' ? ['sessionId', 'text', 'revision'] : ['sessionId', 'text'];
          if (!input || typeof input !== 'object' || Array.isArray(input)
            || Object.keys(input).some(key => !allowed.includes(key))
            || allowed.some(key => !Object.hasOwn(input, key))) throw new TypeError('Invalid note request');
          const record = action === 'read' ? await store.read(input.sessionId)
            : action === 'write' ? await store.write(input.sessionId, input.text, input.revision)
              : await store.importLegacy(input.sessionId, input.text);
          return json({ record });
        } catch (error) {
          const code = error?.code === 'conflict' ? 'conflict'
            : error instanceof SyntaxError || error instanceof TypeError ? 'invalid_request'
              : error instanceof RangeError ? 'too_large' : 'storage_error';
          const status = code === 'conflict' ? 409 : code === 'invalid_request' ? 400 : code === 'too_large' ? 413 : 500;
          return json({ error: { code, message: code === 'conflict' ? 'This note changed in another window.'
            : code === 'storage_error' ? 'Cannot read or save the note on disk.' : 'Invalid or oversized note request.' } }, status);
        }
      },
    });
  }
}
