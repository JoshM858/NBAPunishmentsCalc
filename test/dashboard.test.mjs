// The single-file Cloudflare Worker must still build and serve the whole site.
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
const env = { LEAGUE_ID: '424242', SEASON: '2027' };
const ctx = { waitUntil() {} };
const fake = installFakeEspn();
const hit = (path) => worker.fetch(new Request(`https://example.workers.dev${path}`), env, ctx);

const page = await hit('/');
assert.equal(page.status, 200);
assert.match(await page.text(), /Punishment Watch/);
for (const f of ['app.js', 'logic.js', 'pipeline.js', 'sources.js', 'trade.js', 'trade-ui.js', 'demo.js', 'styles.css']) assert.equal((await hit(`/${f}`)).status, 200, f);
assert.equal((await hit('/data/snapshot.json')).status, 404);
assert.equal((await hit('/api/config')).status, 200);
const league = await hit('/api/league?view=mRoster&view=mTeam&fresh=1');
assert.equal(league.status, 200);
assert.equal((await league.json()).teams.length, 10);

// Every module the page imports must be served, or the page fails to load
const imports = new Set();
for (const f of ['app.js', 'logic.js', 'pipeline.js', 'sources.js', 'trade.js', 'trade-ui.js']) {
  for (const m of (await (await hit(`/${f}`)).text()).matchAll(/from '\.\/([\w.-]+)'/g)) imports.add(m[1]);
}
assert.ok(imports.has('trade.js') && imports.size >= 5, [...imports].join());
for (const f of imports) assert.equal((await hit(`/${f}`)).status, 200, `${f} is imported but not served`);

// The free-agent route works through the bundled worker too
fake.restore();
const stub = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ players: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
assert.deepEqual(await (await hit('/api/free-agents?fresh=1')).json(), { players: [] });
globalThis.fetch = stub;

fake.restore();
rmSync(`${root}.cache/dashboard-test`, { recursive: true, force: true });
console.log('Dashboard worker tests passed');
