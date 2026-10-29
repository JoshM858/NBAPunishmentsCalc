// Builds the GitHub Pages site: public/ plus data/snapshot.json (league, pro schedule, per-day rosters,
// per-day team totals). Reads LEAGUE_ID, SEASON, ESPN_S2, ESPN_SWID from the environment or .env.
// Usage: node scripts/build-snapshot.mjs [--out _site] [--cache .cache/days.json]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/env.js';
import { createDirectSource } from '../src/direct-source.js';
import { buildModel, slimLeague, slimPro } from '../public/logic.js';
import { createSnapshotSource, SNAPSHOT_VERSION } from '../public/sources.js';
import { historyOf, loadLeague, loadSeasonDays } from '../public/pipeline.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = resolve(arg('out', '_site'));
const cacheFile = resolve(arg('cache', '.cache/days.json'));

function fail(message) {
  console.error(process.env.GITHUB_ACTIONS ? `::error title=Snapshot failed::${message}` : `Error: ${message}`);
  process.exit(1);
}

const { env } = loadEnv();
if (!env.LEAGUE_ID) fail('LEAGUE_ID is not set. On GitHub add it under Settings > Secrets and variables > Actions > Variables. Locally put it in .env.');

try {
  const src = createDirectSource(env);
  const cfg = await src.config();
  const season = cfg.season;

  // Days older than yesterday are final, so keep them between runs.
  let cache = { leagueId: env.LEAGUE_ID, season, days: {} };
  if (existsSync(cacheFile)) {
    try {
      const old = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (old.leagueId === env.LEAGUE_ID && old.season === season) cache = old;
    } catch {}
  }

  const days = {};
  let leagueSlim = null;
  let proRaw = null;
  let cur = Infinity;
  let recording = true;
  const rec = {
    ...src,
    pro: async () => (proRaw = await src.pro()),
    async league(views, opts = {}) {
      const { sp } = opts;
      if (!sp) {
        const raw = await src.league(views, opts);
        cur = raw.scoringPeriodId;
        return (leagueSlim = slimLeague(raw, season, { sp: cur, full: true }));
      }
      const final = sp < cur - 1; // yesterday can still change overnight, so it is never cached
      let day = final ? cache.days[sp] : null;
      if (!day) {
        day = slimLeague(await src.league(views, { ...opts, past: final }), season, { sp, full: false });
        if (final) cache.days[sp] = day;
      }
      if (recording) days[sp] = day;
      return day;
    },
  };

  const ctx = await loadLeague(rec);
  if (ctx.unconfigured) fail('LEAGUE_ID is not set.');
  recording = false;
  const { check } = await loadSeasonDays(ctx, rec);

  // Hidden teams stay out of the published files too.
  const visible = new Set(ctx.league.teams.map((t) => t.id));
  const onlyVisible = (raw) => ({ ...raw, teams: raw.teams.filter((t) => visible.has(t.id)) });
  const history = historyOf(ctx);
  for (const sp of Object.keys(history)) history[sp] = Object.fromEntries(Object.entries(history[sp]).filter(([tid]) => visible.has(Number(tid))));
  leagueSlim = onlyVisible(leagueSlim);
  const owners = new Set(leagueSlim.teams.flatMap((t) => t.owners || []));
  leagueSlim.members = (leagueSlim.members || []).filter((m) => owners.has(m.id));
  leagueSlim.schedule = (leagueSlim.schedule || []).filter((m) => visible.has(m.home?.teamId) && (!m.away || visible.has(m.away.teamId)));
  for (const sp of Object.keys(days)) days[sp] = onlyVisible(days[sp]);

  const snapshot = {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    config: { configured: true, season, hideTeams: [], platform: 'static' }, // hidden teams are already removed below
    league: leagueSlim,
    pro: slimPro(proRaw),
    days,
    history,
  };
  const text = JSON.stringify(snapshot);

  // Never publish credentials.
  for (const secret of [env.ESPN_S2, env.ESPN_SWID]) {
    const bare = String(secret || '').replace(/[{}"']/g, '').trim();
    if (bare.length >= 8 && text.includes(bare)) fail('A login cookie value ended up in the snapshot. Nothing was written.');
  }

  // The published data must give the same answer as the live data.
  const again = await loadLeague(createSnapshotSource(snapshot));
  const weekOf = (c) => buildModel({ ...c, now: 0 }).rows.map((r) => `${r.id}:${r.weekPts}`).join();
  if (weekOf(again) !== weekOf(ctx)) fail('The snapshot does not reproduce the live weekly points. Nothing was written.');

  rmSync(outDir, { recursive: true, force: true });
  cpSync(`${root}public`, outDir, { recursive: true });
  // Tell the page it is the static site so it doesn't probe for a server that isn't there.
  const html = readFileSync(`${outDir}/index.html`, 'utf8');
  if (!html.includes('<meta charset="utf-8">')) fail('index.html has no charset meta to mark as static.');
  writeFileSync(`${outDir}/index.html`, html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="pw-mode" content="static">'));
  mkdirSync(`${outDir}/data`, { recursive: true });
  writeFileSync(`${outDir}/data/snapshot.json`, text);
  writeFileSync(`${outDir}/.nojekyll`, '');
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(cache));

  const model = buildModel({ ...ctx, now: Date.now() });
  const bad = check.filter((c) => !c.ok);
  console.log(`${model.leagueName}: week ${model.week.id} (${model.week.label}), ${ctx.league.teams.length} teams, ${ctx.source} method, weeks from ${ctx.weeks.source}.`);
  console.log(`Wrote ${outDir}/data/snapshot.json (${(text.length / 1024).toFixed(0)} KB, ${Object.keys(days).length} day rosters, ${Object.keys(history).length} days of history).`);
  if (bad.length) {
    const msg = `${bad.length} team(s) don’t match ESPN’s season total: ${bad.map((b) => `${b.name} ESPN ${b.espn} vs rebuilt ${b.ours}`).join('; ')}`;
    console.log(process.env.GITHUB_ACTIONS ? `::warning title=Totals check::${msg}` : `Warning: ${msg}`);
  } else console.log('Totals check: every team’s rebuilt total matches ESPN’s season total.');
} catch (err) {
  fail(err.message);
}
