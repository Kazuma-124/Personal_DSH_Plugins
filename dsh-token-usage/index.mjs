import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createCollector } from './collector.mjs';

export const name = 'token-usage';
export const inject = ['webServer'];
export function apply(ctx, config = {}) {
  const collector = createCollector({ dataDir: config.dataDir || join(homedir(), '.dsh') });
  let pending;
  const snapshot = () => {
    if (!pending) pending = Promise.resolve().then(() => collector.collect()).finally(() => { pending = undefined; });
    return pending;
  };
  for (const path of ['/token-usage', '/api/token-usage']) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler: async (req, res) => {
      // This dashboard reads local usage only. Never publish it to remote peers.
      const ip = req.socket?.remoteAddress;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) { res.writeHead(403); res.end('Local access only'); return; }
      if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host && req.headers.origin !== 'https://' + req.headers.host) { res.writeHead(403); res.end('Origin rejected'); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
      try {
        const isData = path === '/api/token-usage';
        const body = isData ? JSON.stringify(await snapshot()) : await readFile(new URL('./dashboard.html', import.meta.url), 'utf8');
        res.writeHead(200, { 'Content-Type': isData ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'; connect-src 'self'; img-src 'self' data:" });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: '读取用量失败：' + error.message }));
      }
    } }), 'token-usage: ' + path);
  }
}
