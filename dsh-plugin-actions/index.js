import { spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const inject = ['connection'];
export const API_PATH = '/api/plugin-actions/';
const MAX_BODY_BYTES = 8192;
const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function profileDirectory() {
  if (process.env.DSH_PROFILE_DIR) return process.env.DSH_PROFILE_DIR;
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'profiles', process.env.DSH_PROFILE || 'desktop');
}

async function inputOf(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new TypeError('Missing JSON body');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError('Request too large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** The directory a bundle's files are installed in, or null when this host cannot locate them. */
export function resolvePackageDirectory(name) {
  if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) return null;
  const profile = profileDirectory();
  const candidate = (() => {
    try {
      const resolver = createRequire(join(profile, 'package.json'));
      return dirname(resolver.resolve(name + '/package.json'));
    } catch { /* fall through to the plain node_modules path */ }
    const direct = join(profile, 'node_modules', ...name.split('/'));
    try {
      if (statSync(join(direct, 'package.json')).isFile()) return direct;
    } catch { /* not installed here */ }
    return null;
  })();
  if (!candidate) return null;
  // A linked package resolves through node_modules; reveal the directory it links to.
  try {
    return realpathSync.native(candidate);
  } catch {
    return candidate;
  }
}

function openDirectory(directory) {
  const command = process.platform === 'win32' ? 'explorer.exe'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [directory], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

export function apply(ctx) {
  ctx.connection.fetch.register({
    path: API_PATH + 'reveal',
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: async request => {
      try {
        const input = await inputOf(request);
        if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).some(key => key !== 'packageName')
          || typeof input.packageName !== 'string') {
          throw new TypeError('Invalid reveal request');
        }
        const directory = resolvePackageDirectory(input.packageName);
        if (!directory) {
          return json({ error: { code: 'not_found', message: 'This host cannot locate the plugin directory.' } }, 404);
        }
        openDirectory(directory);
        return json({ directory });
      } catch (error) {
        const invalid = error instanceof SyntaxError || error instanceof TypeError;
        const status = invalid ? 400 : error instanceof RangeError ? 413 : 500;
        return json({
          error: {
            code: invalid ? 'invalid_request' : error instanceof RangeError ? 'too_large' : 'open_failed',
            message: invalid || error instanceof RangeError ? 'Invalid reveal request.' : 'Could not open the folder on this host.',
          },
        }, status);
      }
    },
  });
}
