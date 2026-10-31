// The single-file Cloudflare Worker must still build and serve the whole site.
import { crawlSite } from './crawl.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installFakeEspn } from './fake-espn.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = `${root}.cache/dashboard-test/worker.js`;
mkdirSync(`${root}.cache/dashboard-test`, { recursive: true });
const built = spawnSync(process.execPath, [`${root}scripts/build-dashboard.mjs`, out], { encoding: 'utf8' });
assert.equal(built.status, 0, built.stderr);

const worker = (await import(pathToFileURL(out))).default;
const env = { LEAGUE_ID: '424242', SEASON: '2027', HIDE_TEAMS: '' };
const ctx = { waitUntil() {} };
const fake = installFakeEspn();
const hit = (path) => worker.fetch(new Request(`https://example.workers.dev${path}`), env, ctx);

const page = await hit('/');
assert.equal(page.status, 200);
assert.match(await page.text(), /NBA Punishments/);
for (const f of ['app.js', 'logic.js', 'pipeline.js', 'sources.js', 'trade.js', 'trade-ui.js', 'demo.js', 'css/tokens.css']) assert.equal((await hit(`/${f}`)).status, 200, f);
// Installable as an app: manifest with the right name, real PNG icons, a service worker
const manifest = await (await hit('/manifest.webmanifest')).json();
assert.equal(manifest.name, 'NBA Punishments');
assert.equal(manifest.short_name, 'NBA Punishments');
assert.equal(manifest.display, 'standalone');
for (const icon of manifest.icons) {
  const res = await hit(`/${icon.src}`);
  assert.equal(res.status, 200, icon.src);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${icon.src} is a real PNG after the bundle's base64 round trip`);
}
assert.equal((await hit('/icons/apple-touch-icon.png')).status, 200);
assert.equal((await hit('/sw.js')).status, 200);
assert.match(await (await hit('/')).text(), /apple-mobile-web-app-title" content="NBA Punishments"/);
assert.equal((await hit('/data/snapshot.json')).status, 404);
assert.equal((await hit('/api/config')).status, 200);
const league = await hit('/api/league?view=mRoster&view=mTeam&fresh=1');
assert.equal(league.status, 200);
assert.equal((await league.json()).teams.length, 10);

// Every module and stylesheet the page loads (followed transitively) must be served, or the page fails to load
const seen = await crawlSite(async (path) => {
  const r = await hit(path);
  return { status: r.status, text: await r.text() };
});
assert.ok(seen.has('/trade.js') && seen.has('/ui/dom.js') && seen.has('/pages/dashboard.js') && seen.has('/css/shell.css') && seen.size >= 15, [...seen.keys()].join());
for (const [f, status] of seen) assert.equal(status, 200, `${f} is loaded by the page but not served`);

// The free-agent route works through the bundled worker too
fake.restore();
const stub = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ players: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
assert.deepEqual(await (await hit('/api/free-agents?fresh=1')).json(), { players: [] });
globalThis.fetch = stub;

fake.restore();
rmSync(`${root}.cache/dashboard-test`, { recursive: true, force: true });
console.log('Dashboard worker tests passed');
