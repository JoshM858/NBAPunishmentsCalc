// Checks against an anonymised capture of a real ESPN league (npm run capture refreshes it).
// The league is TOTAL_SEASON_POINTS: no matchup feed, one useless matchup period, season total in `points`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel, dayFromRoster, parseEntry, parseLeague } from '../public/logic.js';
import { loadLeague, loadSeasonDays } from '../public/pipeline.js';

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const real = load('real-league.json');
const { sp: entrySP, entries } = load('real-entries.json');
const SEASON = 2027;

// Raw row shapes: a day's response also carries the player's previous game, and appliedStatTotal adds them up.
{
  const edwards = entries.find((e) => e.playerPoolEntry.player.fullName === 'Anthony Edwards');
  assert.equal(edwards.playerPoolEntry.appliedStatTotal, 92, 'ESPN’s appliedStatTotal covers two games (23 + 69)');
  const p = parseEntry(edwards, SEASON);
  assert.deepEqual(p.bySP, { 6: 23, [entrySP]: 69 });
  assert.equal(p.slot, 1);

  const day = dayFromRoster({ seasonId: SEASON, teams: [{ id: 1, roster: { entries } }] }, entrySP, SEASON).get(1);
  assert.equal(day.pts, 69, 'only the requested day counts, and only from a starting slot');
  assert.deepEqual(day.players.map((x) => [x.name, x.pts, x.active]), [['Anthony Edwards', 69, true]], 'benched players’ earlier games are ignored');
}

// The whole league through the same pipeline the page uses
const pro = load('pro-2027.json');
const src = {
  config: async () => ({ configured: true, season: SEASON, hideTeams: [] }),
  pro: async () => pro,
  league: async (views, { sp } = {}) => (sp ? real.days[sp] : real.league),
  now: () => Date.parse(real.capturedAt),
};
const ctx = await loadLeague(src);
const league = parseLeague(real.league, SEASON);
assert.equal(league.activeSlots, 10, '7 position slots + 3 UTIL; bench (12) and IR (13) don’t score');
assert.deepEqual(league.matchupPeriods, { 1: [1] });
assert.equal(ctx.weeks.source, 'calendar', 'ESPN’s single matchup period is not a week');
assert.equal(ctx.source, 'roster', 'the schedule feed has no daily points for this league type');
assert.equal(ctx.weeks[1].sps[0], 8, 'week 2 starts Tuesday 27 Oct');
assert.equal(ctx.weeks[0].sps.at(-1), 7, 'week 1 ends Monday 26 Oct');
assert.equal(ctx.league.currentSP, real.cur);

const { check, shame } = await loadSeasonDays(ctx, src);
assert.equal(check.length, real.expectedChecked);
for (const c of check) assert.ok(c.ok, `${c.name}: ESPN ${c.espn} vs rebuilt ${c.ours}`);
assert.ok(check.every((c) => c.basis === 'finished days'), 'ESPN’s `points` covers finished days; today is still in progress');

// Weeks restart from 0: week 2 so far is only Tue-Wed of that week, not the season total
const model = buildModel({ ...ctx, now: src.now() });
assert.equal(model.week.id, 2);
assert.equal(model.week.dayNumber, 2, 'Tue 27 and Wed 28 Oct');
for (const r of model.rows) {
  assert.ok(r.weekPts < r.seasonTotal, `${r.name} week ${r.weekPts} vs season ${r.seasonTotal}`);
  const days = [8, 9].map((sp) => ctx.daily.get(r.id).get(sp) ?? 0);
  assert.ok(Math.abs(days.reduce((a, b) => a + b, 0) - r.weekPts) < 0.05);
}
assert.equal(shame.length, 1, 'week 1 is the only finished week');
const w1 = shame[0];
let sum = 0;
for (const sp of ctx.weeks[0].sps) sum += ctx.daily.get(w1.losers[0].id).get(sp) ?? 0;
assert.ok(Math.abs(sum - w1.losers[0].pts) < 0.05);

console.log('All real-data tests passed');
for (const w of shame) console.log(`Week ${w.week} (${w.label}) last place: team ${w.losers.map((l) => `${l.id} on ${l.pts}`)}, top ${w.top.pts}`);
