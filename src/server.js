// Local server: serves public/ and the /api routes. Run with `npm start`; settings come from .env.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.js';
import { loadEnv } from './env.js';
import { createFileKV } from './file-kv.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const { env: loaded, hasFile } = loadEnv();
const env = { ...loaded, PLATFORM: 'local', BOARD: createFileKV(fileURLToPath(new URL('../.data/board.json', import.meta.url))) }; // the trade block is kept in .data/
const port = Number(env.PORT) || 8787;
const host = env.HOST || '127.0.0.1'; // localhost only, so nobody else on the network can use your cookies

async function serveFile(res, pathname, method) {
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = resolve(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = method === 'HEAD' ? '' : await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    send(res, 404, 'Not found');
  }
}

function send(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      let size = 0;
      if (req.method === 'POST') for await (const c of req) if ((size += c.length) < 4096) chunks.push(c); // sign-in bodies are tiny
      const init = { method: req.method, headers: { 'x-real-ip': req.socket.remoteAddress || '', ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}) } };
      if (req.method === 'POST') init.body = Buffer.concat(chunks);
      const out = await handleApi(new Request(url, init), env, { waitUntil: (p) => p?.catch?.(() => {}) });
      res.writeHead(out.status, Object.fromEntries(out.headers));
      return res.end(Buffer.from(await out.arrayBuffer()));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    await serveFile(res, url.pathname, req.method);
  } catch (err) {
    send(res, 500, `Server error: ${err.message}`);
  }
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the other program or set PORT in .env.` : err.message);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Punishment Watch running at http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`);
  if (!hasFile) console.log('No .env file found. Copy .env.example to .env and fill it in.');
  else if (!env.LEAGUE_ID) console.log('LEAGUE_ID is empty in .env, so the page will ask you to set it.');
  else console.log(`League ${env.LEAGUE_ID}, season ${env.SEASON || 'auto'}, ${env.ESPN_S2 && env.ESPN_SWID ? 'with' : 'without'} ESPN login cookies.`);
  console.log('Try /?demo for fake data.');
});
