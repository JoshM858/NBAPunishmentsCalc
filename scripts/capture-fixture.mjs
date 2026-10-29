// Saves an anonymised copy of your real league as test fixtures (team/owner names replaced, NBA player
// names kept), so the tests keep checking against what ESPN really sends. Usage: npm run capture
import { writeFileSync } from 'node:fs';
import { loadEnv } from '../src/env.js';
import { createDirectSource } from '../src/direct-source.js';
import { slimLeague } from '../public/logic.js';
import { LIVE_VIEWS, loadLeague, loadSeasonDays, neededDays } from '../public/pipeline.js';

const { env } = loadEnv();
const src = createDirectSource(env);
const cfg = await src.config();
const season = cfg.season;
const ctx = await loadLeague(src, { forceRoster: true, fresh: true });
const cur = ctx.league.currentSP;

const raw = await src.league(LIVE_VIEWS, { fresh: true });
const league = slimLeague(raw, season, { sp: cur, full: true });
const alias = new Map(league.teams.map((t, i) => [t.id, i + 1]));
for (const t of league.teams) {
  const n = alias.get(t.id);
  Object.assign(t, { name: `Team ${n}`, abbrev: `T${n}`, location: undefined, nickname: undefined, logo: null, owners: [`{OWNER-${n}}`] });
}
league.members = league.teams.map((t) => ({ id: t.owners[0], firstName: `Owner ${alias.get(t.id)}`, displayName: `owner${alias.get(t.id)}` }));
league.settings.name = 'Real League (anonymised)';

const days = {};
for (let sp = ctx.league.firstSP; sp < cur; sp++) {
  if (ctx.pro.spDate.has(sp)) days[sp] = slimLeague(await src.league(['mRoster'], { sp }), season, { sp, full: false });
}
const { check } = await loadSeasonDays(ctx, src);
writeFileSync(new URL('../test/fixtures/real-league.json', import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), cur, league, days, expectedChecked: check.length }));

// A few untouched roster entries from a day response, to pin ESPN's raw row shapes.
const dayRaw = await src.league(['mRoster'], { sp: Math.max(ctx.league.firstSP, cur - 2) });
const entries = dayRaw.teams[0].roster.entries.slice(0, 4).map((e) => {
  const p = e.playerPoolEntry.player;
  return { ...e, playerPoolEntry: { ...e.playerPoolEntry, player: { ...p, stats: p.stats.filter((s) => s.seasonId === season).map((s) => ({ ...s, stats: s.stats?.['42'] != null ? { 42: s.stats['42'] } : undefined })) } } };
});
writeFileSync(new URL('../test/fixtures/real-entries.json', import.meta.url), JSON.stringify({ sp: Math.max(ctx.league.firstSP, cur - 2), entries }));
console.log(`Saved test/fixtures/real-league.json (${Object.keys(days).length} days, ${league.teams.length} teams) and real-entries.json`);
