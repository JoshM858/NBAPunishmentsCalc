// Runs the site in Cloudflare's real Workers runtime (workerd, via `wrangler dev --local`) and checks it, once as the
// single-file bundle you paste into the dashboard and once as the Wrangler deploy. Needs `npm install` for wrangler,
// LEAGUE_ID in .env, and internet (it talks to the real ESPN). Usage: npm run check:cloudflare
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/env.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { env } = loadEnv();
if (!existsSync(`${root}node_modules/.bin/wrangler`)) {
  console.error('Wrangler is not installed. Run: npm install');
  process.exit(1);
}
if (!env.LEAGUE_ID) {
  console.error('Set LEAGUE_ID in .env first.');
  process.exit(1);
}
mkdirSync(`${root}.cache`, { recursive: true });
const bundle = `${root}.cache/worker-check.js`;
const built = spawnSync(process.execPath, [`${root}scripts/build-dashboard.mjs`, bundle], { encoding: 'utf8' });
if (built.status !== 0) throw new Error(built.stderr);

// Made-up PINs for the check only: your real ones are never used here
const vars = { LEAGUE_ID: env.LEAGUE_ID, SEASON: env.SEASON || '2027', HIDE_TEAMS: env.HIDE_TEAMS || '', TEAM_PINS: '1=482913', SESSION_SECRET: 'check-only-secret', ...(env.ESPN_S2 && env.ESPN_SWID ? { ESPN_S2: env.ESPN_S2, ESPN_SWID: env.ESPN_SWID } : {}) };
const varFlags = Object.entries(vars).filter(([, v]) => v).flatMap(([k, v]) => ['--var', `${k}:${v}`]);
let failures = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

async function run(label, port, configArgs) {
  console.log(`\n${label}`);
  const child = spawn(`${root}node_modules/.bin/wrangler`, ['dev', ...configArgs, '--local', '--ip', '127.0.0.1', '--port', String(port), ...varFlags], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 80 && !log.includes('Ready on'); i++) await new Promise((r) => setTimeout(r, 500));
    if (!log.includes('Ready on')) throw new Error(`Workers runtime did not start:\n${log.slice(-600)}`);
    const get = async (path) => {
      const t = performance.now();
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      const text = await res.text();
      return { res, text, ms: performance.now() - t };
    };
    const home = await get('/');
    check(home.res.status === 200 && home.text.includes('Punishment Watch'), 'serves the page');
    const imports = new Set();
    for (const f of ['app.js', 'logic.js', 'pipeline.js', 'sources.js', 'trade.js', 'trade-ui.js']) for (const m of (await get(`/${f}`)).text.matchAll(/from '\.\/([\w.-]+)'/g)) imports.add(m[1]);
    const missing = [];
    for (const f of imports) if ((await get(`/${f}`)).res.status !== 200) missing.push(f);
    check(!missing.length, `serves every module the page imports (${[...imports].join(', ')})`);
    check((await get('/data/snapshot.json')).res.status === 404, 'no snapshot here (that is the GitHub version)');
    const cfg = JSON.parse((await get('/api/config')).text);
    check(cfg.configured && cfg.leagueId === env.LEAGUE_ID && cfg.platform === 'cloudflare', 'config reports the league');
    check(!JSON.stringify(cfg).includes(env.ESPN_S2 || '\u0000'), 'config never shows the cookies');
    const q = '/api/league?view=mTeam&view=mRoster&view=mSettings&view=mStatus&view=mMatchupScore&fresh=1';
    const first = await get(q);
    check(first.res.status === 200 && JSON.parse(first.text).teams?.length > 0, `live league from ESPN (${first.ms.toFixed(0)} ms)`);
    const again = await get(q.replace('&fresh=1', ''));
    const second = await get(q.replace('&fresh=1', ''));
    check(second.res.status === 200 && second.ms < Math.max(60, first.ms / 2), `Workers cache serves repeats (${again.ms.toFixed(0)} then ${second.ms.toFixed(0)} ms)`);
    check(JSON.parse((await get('/api/pro-schedule')).text).settings?.proTeams?.length > 20, 'NBA schedule');
    const fa = JSON.parse((await get('/api/free-agents')).text);
    check(fa.players?.length > 10 && fa.players[0].eligibleSlots, `free agents (${fa.players?.length})`);
    const inj = JSON.parse((await get('/api/injuries')).text);
    check(inj.players?.length > 0 && inj.players[0].playerId, `injury report (${inj.players?.length}, trimmed)`);
    const sb = JSON.parse((await get('/api/scoreboard?date=20261028')).text);
    check(Array.isArray(sb.events), 'scoreboard');
    check((await get('/api/scoreboard?date=oops')).res.status === 400, 'rejects a bad scoreboard date');
    check((await get('/api/nope')).res.status === 404, 'unknown API route is a 404');

    // Team PINs, which use Web Crypto for the signed cookie
    const login = (body) => fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', body: JSON.stringify(body) });
    check(cfg.pins === true && !JSON.stringify(cfg).includes('482913'), 'PINs are on and never shown');
    check((await login({ teamId: 1, pin: '000000' })).status === 401, 'a wrong PIN is refused');
    const ok = await login({ teamId: 1, pin: '482913' });
    const setCookie = ok.headers.get('set-cookie') || '';
    check(ok.status === 200 && /pw_team=1\./.test(setCookie) && /HttpOnly/.test(setCookie), 'the right PIN signs in with a HttpOnly cookie');
    const meWith = async (cookie) => (await (await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie } })).json()).teamId;
    check((await meWith(setCookie.split(';')[0])) === 1, 'the cookie identifies the team');
    check((await meWith(setCookie.split(';')[0].replace('pw_team=1.', 'pw_team=2.'))) === null, 'a tampered cookie is refused');
    check((await fetch(`http://127.0.0.1:${port}/api/config`, { method: 'POST' })).status === 405, 'POST is refused');
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    child.kill('SIGKILL');
  }
}

writeFileSync(`${root}.cache/wrangler-bundle.jsonc`, JSON.stringify({ name: 'bundle-check', main: bundle, compatibility_date: '2026-06-01' }));
await run('The single file you paste into the Cloudflare dashboard (dist/worker-dashboard.js)', 8811, ['-c', `${root}.cache/wrangler-bundle.jsonc`]);
await run('The Wrangler deploy (wrangler.jsonc: src/worker.js serving public/)', 8812, ['-c', `${root}wrangler.jsonc`]);
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed in the Workers runtime. (Cloudflare\'s free-plan CPU limit is not enforced locally.)');
process.exit(failures ? 1 : 0);
