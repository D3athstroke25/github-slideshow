// Serves groundswell/web and stands in for Supabase locally: /rest/v1/rpc/* runs the real SQL
// functions as `anon`, and /storage/v1/* checks uploads against the real Storage policy.
// Used by the browser tests; also handy for trying the app offline: `npm run serve`.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makePool, rpc } from './pgrpc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml' };

// Optional: pass the `gs` Edge Function's handler to serve it at /functions/v1/gs/*. Requests
// bearing GS_SERVICE_KEY run database functions as service_role, like the real service key.
export function startServer(port = 8098, { fn = null } = {}) {
  const pool = makePool();
  const files = new Map();
  const origin = `http://127.0.0.1:${port}`;
  const body = req => new Promise((res, rej) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c))); req.on('error', rej); });
  const json = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const srv = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        if (req.method !== 'POST') return json(res, 405, { message: 'POST only' });
        if (!req.headers.apikey) return json(res, 401, { message: 'No API key found in request' });
        const args = JSON.parse((await body(req)).toString() || '{}');
        const service = process.env.GS_SERVICE_KEY && req.headers.authorization === `Bearer ${process.env.GS_SERVICE_KEY}`;
        const r = await rpc(pool, url.pathname.slice('/rest/v1/rpc/'.length), args, { role: service ? 'service_role' : 'anon' });
        return json(res, r.status, r.body);
      }
      if (fn && url.pathname.startsWith('/functions/v1/gs')) {
        const data = await body(req);
        const r = await fn(new Request(origin + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : data }));
        res.writeHead(r.status, Object.fromEntries(r.headers));
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      if (url.pathname.startsWith('/storage/v1/object/public/media/')) {
        const f = files.get(decodeURIComponent(url.pathname.slice('/storage/v1/object/public/media/'.length)));
        if (!f) return json(res, 404, { message: 'Object not found' });
        res.writeHead(200, { 'Content-Type': f.type }); return res.end(f.data);
      }
      if (url.pathname.startsWith('/storage/v1/object/media/') && req.method === 'POST') {
        if (!req.headers.apikey) return json(res, 401, { message: 'No API key found in request' });
        const name = decodeURIComponent(url.pathname.slice('/storage/v1/object/media/'.length));
        const type = req.headers['content-type'];
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return json(res, 415, { message: 'mime type not supported' });
        const data = await body(req);
        if (data.length > 5242880) return json(res, 413, { message: 'Payload too large' });
        const c = await pool.connect();
        try {
          await c.query('begin'); await c.query('set local role anon');
          await c.query(`insert into storage.objects (bucket_id, name) values ('media', $1)`, [name]);
          await c.query('commit');
        } catch (e) {
          await c.query('rollback');
          return json(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
        } finally { c.release(); }
        files.set(name, { type, data });
        return json(res, 200, { Key: 'media/' + name });
      }
      let p = decodeURIComponent(url.pathname);
      if (p === '/') p = '/index.html';
      if (p === '/config.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        return res.end(`window.GS_CONFIG = { url: '${origin}', key: 'sb_publishable_local_test', appUrl: '${origin}/', payments: 'test' };`);
      }
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    } catch (e) {
      json(res, 500, { message: String(e && e.message || e) });
    }
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ origin, files, pool, close: () => new Promise(c => { srv.close(c); pool.end(); }) })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startServer(Number(process.env.PORT || 8098));
  console.log(`Groundswell running at ${s.origin}/  (database: local gs_test)`);
}
