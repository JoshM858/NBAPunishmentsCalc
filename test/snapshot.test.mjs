import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel } from '../public/logic.js';
import { loadLeague, loadSeasonDays } from '../public/pipeline.js';
import { checkSnapshot, createSnapshotSource } from '../public/sources.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = `${root}.cache/snapshot-test`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const S2 = 'AEBsecret-cookie-value-1234567890';
const SWID = '{11111111-2222-3333-4444-555555555555}';
const base = { LEAGUE_ID: '424242', SEASON: '2027', ESPN_S2: S2, ESPN_SWID: SWID };

function build(extra = {}, { out = `${work}/site`, cache = `${work}/cache.json`, log } = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...base, ...extra, ...(log ? { FAKE_ESPN_LOG: log } : {}) };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const r = spawnSync(process.execPath, ['--import', `${root}test/fake-espn-register.mjs`, `${root}scripts/build-snapshot.mjs`, '--out', out, '--cache', cache], { env, encoding: 'utf8', cwd: work });
  return { ...r, text: `${r.stdout}${r.stderr}` };
}
const read = (p) => readFileSync(p, 'utf8');
const walk = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => `${e.parentPath ?? e.path}/${e.name}`);

// 1. A private league builds with cookies, and the site folder is complete
const log1 = `${work}/calls1.log`;
let r = build({ FAKE_ESPN_MODE: 'private' }, { log: log1 });
assert.equal(r.status, 0, r.text);
assert.match(r.text, /Totals check: every team/);
for (const f of ['index.html', 'app.js', 'logic.js', 'pipeline.js', 'sources.js', 'styles.css', 'data/snapshot.json', '.nojekyll']) assert.ok(existsSync(`${work}/site/${f}`), f);
assert.ok(!existsSync(`${work}/site/.env`));

// 2. No cookie value (or .env) appears anywhere in the published files or the cache
for (const file of [...walk(`${work}/site`), `${work}/cache.json`]) {
  const text = read(file);
  assert.ok(!text.includes(S2) && !text.includes(SWID) && !text.includes('11111111-2222'), `cookie leaked into ${file}`);
}

// 3. The snapshot is self-sufficient: week table, recap data and the ESPN-totals check all work from it
const snap = checkSnapshot(JSON.parse(read(`${work}/site/data/snapshot.json`)));
assert.equal(snap.config.platform, 'static');
assert.ok(!('leagueId' in snap.config) && !('hasCookies' in snap.config));
assert.ok(Math.abs(Date.now() - Date.parse(snap.generatedAt)) < 120_000);
const source = createSnapshotSource(snap);
const ctx = await loadLeague(source);
const { check, shame } = await loadSeasonDays(ctx, source);
assert.ok(check.length === 10 && check.every((c) => c.ok), 'totals check is green from the published snapshot');
const model = buildModel({ ...ctx, now: source.now() });
assert.equal(model.week.id, 2);
assert.ok(model.recap.best && model.recap.worst, 'recap has player detail for yesterday');
assert.deepEqual(Object.keys(snap.days).map(Number), [7, 8, 9], 'rosters for finished days of this week (yesterday included)');
assert.equal(Object.keys(snap.history).length, 9, 'team totals for every finished day');
assert.ok(shame.length === 1);

// 4. A second run reuses cached days: only yesterday is fetched again
const calls1 = read(log1).trim().split('\n').filter((l) => /scoringPeriodId=\d/.test(l));
const log2 = `${work}/calls2.log`;
r = build({ FAKE_ESPN_MODE: 'private' }, { log: log2 });
assert.equal(r.status, 0, r.text);
const calls2 = read(log2).trim().split('\n').filter((l) => /scoringPeriodId=\d/.test(l));
assert.ok(calls1.length >= 9, `first run fetched every day (${calls1.length})`);
assert.deepEqual(calls2.map((l) => /scoringPeriodId=(\d+)/.exec(l)[1]), ['9'], 'second run only re-fetches yesterday');

// 5. The matchup-feed path builds too
r = build({ FAKE_ESPN_SCHEDULE: '1' }, { out: `${work}/site-feed`, cache: `${work}/cache-feed.json` });
assert.equal(r.status, 0, r.text);
assert.match(r.text, /schedule method/);
assert.ok(JSON.parse(read(`${work}/site-feed/data/snapshot.json`)).league.schedule.length > 0);

// 6. Hidden teams stay out of the published files
r = build({ HIDE_TEAMS: 'Bench Mob' }, { out: `${work}/site-hidden`, cache: `${work}/cache-hidden.json` });
assert.equal(r.status, 0, r.text);
const hidden = read(`${work}/site-hidden/data/snapshot.json`);
assert.ok(!hidden.includes('Mob'), 'hidden team name not published');
assert.equal(JSON.parse(hidden).league.teams.length, 9);
assert.ok(Object.values(JSON.parse(hidden).history).every((d) => Object.keys(d).length === 9));

// 7. Failures are loud, plain, and don't write a site
r = build({ LEAGUE_ID: '' }, { out: `${work}/fail1` });
assert.equal(r.status, 1);
assert.match(r.text, /LEAGUE_ID is not set/);
r = build({ ESPN_S2: '', ESPN_SWID: '', FAKE_ESPN_MODE: 'private' }, { out: `${work}/fail2` });
assert.equal(r.status, 1);
assert.match(r.text, /private/);
r = build({ LEAGUE_ID: '999' }, { out: `${work}/fail3` });
assert.equal(r.status, 1);
assert.match(r.text, /couldn’t find league 999/);
r = build({ ESPN_S2: 'Courtside Consequences' }, { out: `${work}/fail4`, cache: `${work}/cache-fail4.json` }); // cookie text that appears in the data
assert.equal(r.status, 1);
assert.match(r.text, /cookie value ended up in the snapshot/);
for (const d of ['fail1', 'fail2', 'fail3', 'fail4']) assert.ok(!existsSync(`${work}/${d}`), `${d} wrote nothing`);

// GitHub annotations when running in Actions
r = build({ LEAGUE_ID: '', GITHUB_ACTIONS: 'true' }, { out: `${work}/fail5` });
assert.match(r.text, /::error title=Snapshot failed::/);

rmSync(work, { recursive: true, force: true });
writeFileSync(`${root}.cache/.keep`, '');
console.log('All snapshot tests passed');
