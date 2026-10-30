// The local server end to end: static files, and the sign-in cookie making the round trip.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = 18000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, [`${root}src/server.js`], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PW_ENV_FILE: '/nonexistent/none.env', PORT: String(port), LEAGUE_ID: '424242', SEASON: '2027', TEAM_PINS: '1=482913,2=193846', SESSION_SECRET: 'test-secret' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${port}`;

try {
  for (let i = 0; i < 40 && !log.includes('running at'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes('running at'), log);

  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/trade.js`)).status, 200);
  assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 403);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.equal(cfg.pins, true);
  assert.equal(cfg.platform, 'local');
  assert.ok(!JSON.stringify(cfg).includes('482913'));

  const bad = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamId: 1, pin: '999999' }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamId: 1, pin: '482913' }) });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /pw_team=1\./);
  assert.match(setCookie, /HttpOnly/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()).teamId, 1, 'the cookie comes back through the server');
  assert.equal((await (await fetch(`${base}/api/me`)).json()).teamId, null);
  assert.equal((await fetch(`${base}/api/login`)).status, 405);
  const out = await fetch(`${base}/api/logout`, { method: 'POST' });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  // a huge body is cut off rather than buffered
  const huge = await fetch(`${base}/api/login`, { method: 'POST', body: 'x'.repeat(50_000) });
  assert.ok([400, 401, 403].includes(huge.status), `huge body: ${huge.status}`);
} finally {
  child.kill();
}
console.log('All server tests passed');
