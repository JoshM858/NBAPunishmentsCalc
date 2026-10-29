import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemo } from '../public/demo.js';
import {
  parseLeague, parseProSchedule, parseEntry, buildWeeks, currentWeek, weekOf, dayLabel, spDay, parseWeekStart, dailyFromSchedule,
  dayFromRoster, buildModel, checkTotals, slimLeague, slimPro,
} from '../public/logic.js';
import { LIVE_VIEWS, loadLeague, loadSeasonDays, neededDays, historyOf } from '../public/pipeline.js';
import { createSnapshotSource } from '../public/sources.js';

const SEASON = 2027;

/* ---------- Real ESPN pro schedule (fetched from the live API, SP 1-60) ---------- */

const realPro = parseProSchedule(JSON.parse(readFileSync(new URL('./fixtures/pro-2027.json', import.meta.url), 'utf8')));
{
  // One scoring period is one US Eastern calendar day; SP 1 is the opener on Tue 20 Oct 2026.
  assert.equal(realPro.dayOffset, 20745);
  assert.equal(dayLabel(realPro, 1), 'Tue 20 Oct');
  assert.equal(dayLabel(realPro, 10), 'Thu 29 Oct');
  // Days with no games have no scoring period in ESPN's data but still get a date.
  assert.ok(!realPro.spDate.has(15) && !realPro.spDate.has(46));
  assert.equal(dayLabel(realPro, 15), 'Tue 3 Nov');
  assert.equal(dayLabel(realPro, 46), 'Fri 4 Dec');
  assert.equal(new Date(spDay(realPro, 7)).getUTCDay(), 1, 'SP 7 is a Monday');

  // This league's weeks run Tuesday to Monday (US Eastern), starting with the Tue 20 Oct opener.
  const weeks = buildWeeks({ matchupPeriods: null, firstSP: 1 }, realPro);
  assert.equal(weeks.source, 'calendar');
  assert.deepEqual(weeks[0].sps, [1, 2, 3, 4, 5, 6, 7], 'week 1 is Tue 20 to Mon 26 Oct');
  assert.deepEqual(weeks[1].sps, [8, 9, 10, 11, 12, 13, 14], 'week 2 is Tue 27 Oct to Mon 2 Nov');
  assert.deepEqual(weeks[2].sps, [15, 16, 17, 18, 19, 20, 21], 'week 3 starts on the no-game Tuesday (SP 15)');
  for (const w of weeks.slice(0, 6)) assert.equal(w.sps.length, 7);
  for (const w of weeks.slice(0, 6)) assert.equal(new Date(spDay(realPro, w.sps[0])).getUTCDay(), 2, 'weeks start on Tuesday');
  assert.equal(weekOf(weeks, 15).id, 3);
  assert.equal(weekOf(weeks, 14).id, 2, 'Monday night games belong to the week that is ending');

  // Other start days, and the old Monday-Sunday split
  const mon = buildWeeks({ matchupPeriods: null, firstSP: 1 }, realPro, { weekStart: parseWeekStart('Monday') });
  assert.deepEqual(mon[0].sps, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(mon[1].sps, [7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual([parseWeekStart('tue'), parseWeekStart('TUESDAY'), parseWeekStart('Sun'), parseWeekStart(undefined), parseWeekStart('nonsense')], [2, 2, 0, 2, 2]);
}

/* ---------- Which weeks to trust ---------- */

{
  const weekly = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i + 1, Array.from({ length: 7 }, (_, d) => i * 7 + d + 1)]));
  const espn = buildWeeks({ matchupPeriods: weekly, firstSP: 1 }, realPro);
  assert.equal(espn.source, 'espn', 'real weekly matchup periods are used');
  assert.deepEqual(espn[1].sps, [8, 9, 10, 11, 12, 13, 14]);

  const seasonLong = { 1: Array.from({ length: 174 }, (_, i) => i + 1) };
  assert.equal(buildWeeks({ matchupPeriods: seasonLong, firstSP: 1 }, realPro).source, 'calendar', 'one season-long period is not a week');
  assert.equal(buildWeeks({ matchupPeriods: {}, firstSP: 1 }, realPro).source, 'calendar');
  const daily = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, [i + 1]]));
  assert.equal(buildWeeks({ matchupPeriods: daily, firstSP: 1 }, realPro).source, 'calendar', 'one-day periods are not weeks');
}

/* ---------- Real stat-row shapes ---------- */

{
  // Row ids seen in ESPN's player data: 002027 season, 012027/022027/032027 last 7/15/30, 05<gameId> per game.
  const entry = {
    lineupSlotId: 11,
    playerPoolEntry: {
      player: {
        id: 3917376, fullName: 'Test Player', proTeamId: 13, injuryStatus: 'ACTIVE',
        stats: [
          { id: '002027', seasonId: 2027, scoringPeriodId: 0, statSourceId: 0, statSplitTypeId: 0, appliedTotal: 400, appliedAverage: 40, stats: { 42: 10 } },
          { id: '022027', seasonId: 2027, scoringPeriodId: 0, statSourceId: 0, statSplitTypeId: 2, appliedAverage: 44 },
          { id: '102027', seasonId: 2027, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedAverage: 38 },
          { id: '05401909859', seasonId: 2027, scoringPeriodId: 5, statSourceId: 0, statSplitTypeId: 5, appliedTotal: 51.5 },
          { id: '05401909860', seasonId: 2027, scoringPeriodId: 6, statSourceId: 1, statSplitTypeId: 5, appliedTotal: 40 }, // projection, not a result
          { id: '05401810176', seasonId: 2026, scoringPeriodId: 5, statSourceId: 0, statSplitTypeId: 5, appliedTotal: 99 }, // same day number, last season
          { id: '002026', seasonId: 2026, scoringPeriodId: 0, statSourceId: 0, statSplitTypeId: 0, appliedTotal: 3000, appliedAverage: 50, stats: { 42: 60 } },
        ],
      },
    },
  };
  const p = parseEntry(entry, SEASON);
  assert.deepEqual(p.bySP, { 5: 51.5 }, 'only this season’s actual per-game rows');
  assert.equal(p.seasonAvg, 40);
  assert.equal(p.seasonGP, 10);
  assert.equal(p.last15Avg, 44);
  assert.equal(p.projAvg, 38);
  assert.equal(p.slot, 11);
}

/* ---------- Full pipeline on the demo league, both data paths ---------- */

const sorted = (a) => [...a].sort((x, y) => x - y);

async function run(withSchedule) {
  const src = createDemo({ withSchedule });
  const ctx = await loadLeague(src, { forceRoster: !withSchedule });
  assert.equal(ctx.source, withSchedule ? 'schedule' : 'roster');
  const { check } = await loadSeasonDays(ctx, src);
  const model = buildModel({ ...ctx, now: src.now() });
  return { src, ctx, check, model, cur: ctx.league.currentSP };
}

const a = await run(false);
const b = await run(true);
const { league, pro, weeks } = a.ctx;

// 1. Rebuilt daily points add up to ESPN's season totals for every team, on both paths
for (const x of [a, b]) for (const row of x.check) assert.ok(row.ok, `totals mismatch ${row.name}: espn ${row.espn} ours ${row.ours}`);

// 2. Roster path and matchup-feed path agree day by day
for (const t of league.teams) for (let sp = 1; sp <= a.cur; sp++) {
  assert.ok(Math.abs((a.ctx.daily.get(t.id).get(sp) ?? 0) - (b.ctx.daily.get(t.id).get(sp) ?? 0)) < 0.05, `day ${sp} team ${t.id}`);
}

// 3. Weekly points equal the sum of that week's days (season-long totals ignored)
const m = a.model;
for (const r of m.rows) {
  let sum = 0;
  for (const sp of m.week.sps) if (sp <= a.cur) sum += a.ctx.daily.get(r.id).get(sp) ?? 0;
  assert.ok(Math.abs(sum - r.weekPts) < 0.05);
}

// 4. Odds are a probability distribution; projections are sane
assert.ok(Math.abs(m.rows.reduce((s, r) => s + r.odds, 0) - 1) < 1e-6);
for (const r of m.rows) assert.ok(r.projFinal >= r.weekPts && r.gamesLeft >= 0 && r.playersLeft <= 14);
assert.deepEqual(m.rows.map((r) => r.rank), sorted(m.rows.map((r) => r.rank)));

// 5. Recap compares yesterday vs the day before
assert.equal(m.recap.sp, a.cur - 1);
assert.ok(m.recap.best && m.recap.worst);
assert.equal(weekOf(weeks, m.recap.sp).id, 2);

// 6. Week fallback (ESPN periods ignored) with a Monday start matches the demo's ESPN-style weeks
const fw = buildWeeks({ ...league, matchupPeriods: null }, pro, { weekStart: 1 });
assert.equal(fw[0].sps.at(-1), 6, 'opening week runs to Sunday 25 Oct');
assert.deepEqual(fw.slice(0, 5).map((w) => w.sps), weeks.slice(0, 5).map((w) => w.sps));
assert.equal(m.weeksSource, 'espn');

// 7. Which days need rosters: this week so far + yesterday's week, only days with games
{
  const week = currentWeek(weeks, a.cur);
  assert.deepEqual(neededDays(weeks, a.cur, pro), week.sps.filter((sp) => sp < a.cur));
  assert.deepEqual(neededDays(weeks, 14, pro), [7, 8, 9, 10, 11, 12, 13], 'on the first day of a week the recap needs last week');
}

/* ---------- Slim snapshot data parses the same ---------- */

{
  const src = createDemo();
  const raw = await src.league(LIVE_VIEWS);
  const cur = raw.scoringPeriodId;
  const slim = slimLeague(raw, SEASON, { sp: cur, full: true });
  assert.ok(JSON.stringify(slim).length < JSON.stringify(raw).length, 'slim is smaller (far more so with real ESPN rows)');
  const full = parseLeague(raw, SEASON);
  const small = parseLeague(JSON.parse(JSON.stringify(slim)), SEASON);
  assert.deepEqual(small.matchupPeriods, full.matchupPeriods);
  assert.equal(small.activeSlots, full.activeSlots);
  assert.equal(small.name, full.name);
  for (const [i, t] of full.teams.entries()) {
    const u = small.teams[i];
    assert.deepEqual({ ...u, roster: 0 }, { ...t, roster: 0 });
    for (const [j, p] of t.roster.entries()) assert.deepEqual({ ...u.roster[j], bySP: 0 }, { ...p, bySP: 0 });
  }
  assert.deepEqual(dayFromRoster(slim, cur, SEASON), dayFromRoster(raw, cur, SEASON), 'today’s points survive slimming');

  const dayRaw = await src.league(['mRoster'], { sp: 7 });
  const daySlim = slimLeague(dayRaw, SEASON, { sp: 7, full: false });
  assert.ok(JSON.stringify(daySlim).length < 60_000);
  assert.deepEqual(dayFromRoster(daySlim, 7, SEASON), dayFromRoster(dayRaw, 7, SEASON), 'a past day survives slimming');
  assert.ok(!JSON.stringify(daySlim).includes('"members"'));

  const proRaw = await src.pro();
  assert.deepEqual([...parseProSchedule(slimPro(proRaw)).spDate], [...parseProSchedule(proRaw).spDate]);
}

/* ---------- A snapshot gives the same answer as the live source ---------- */

{
  const src = createDemo();
  const live = await loadLeague(src, { forceRoster: true });
  const need = neededDays(live.weeks, live.league.currentSP, live.pro);
  const days = {};
  for (const sp of need) days[sp] = slimLeague(await src.league(['mRoster'], { sp }), SEASON, { sp, full: false });
  const full = await loadSeasonDays(live, src);
  const snap = {
    version: 1,
    generatedAt: new Date(src.now()).toISOString(),
    config: { configured: true, season: SEASON, hideTeams: [], platform: 'static' },
    league: slimLeague(await src.league(LIVE_VIEWS), SEASON, { sp: live.league.currentSP, full: true }),
    pro: slimPro(await src.pro()),
    days,
    history: historyOf(live),
  };
  const source = createSnapshotSource(JSON.parse(JSON.stringify(snap)));
  const fromSnap = await loadLeague(source);
  const season = await loadSeasonDays(fromSnap, source);
  const rows = (c) => buildModel({ ...c, now: source.now() }).rows.map((r) => [r.id, r.weekPts, r.rank, r.projFinal, r.gamesLeft]);
  assert.deepEqual(rows(fromSnap), rows(live).map((r) => r), 'same week table');
  assert.deepEqual(season.check.map((c) => c.ok), full.check.map((c) => c.ok));
  assert.ok(season.check.every((c) => c.ok), 'totals check is green from a snapshot alone');
  assert.deepEqual(season.shame, full.shame);
  await assert.rejects(() => source.league(['mRoster'], { sp: 1 }), /doesn.t include day 1/);
}

/* ---------- checkTotals tolerates today being in or out ---------- */

{
  const teams = [{ id: 1, name: 'A', seasonTotal: 300 }];
  const daily = new Map([[1, new Map([[1, 100], [2, 200], [3, 50]])]]);
  assert.ok(checkTotals(teams, daily, 3)[0].ok, 'ESPN total without today');
  teams[0].seasonTotal = 350;
  assert.ok(checkTotals(teams, daily, 3)[0].ok, 'ESPN total with today');
  teams[0].seasonTotal = 360;
  assert.ok(!checkTotals(teams, daily, 3)[0].ok);
  // Real league: ESPN's `points` stops at yesterday while `pointsLive` includes today's games so far.
  const real = [{ id: 1, name: 'A', seasonTotal: 300, seasonLive: 352 }];
  const r = checkTotals(real, daily, 3)[0];
  assert.deepEqual([r.ok, r.basis, r.ours, r.espn], [true, 'finished days', 300, 300]);
  real[0].seasonTotal = 290; // finished-days total off by 10, but the live total matches
  assert.equal(checkTotals(real, daily, 3)[0].basis, 'including today');
  real[0].seasonLive = 500;
  assert.ok(!checkTotals(real, daily, 3)[0].ok, 'a genuine mismatch is still red');
}

console.log('All logic tests passed');
const mm = a.model;
console.log(`Week ${mm.week.id} (${mm.week.label}), day ${mm.week.dayNumber}/${mm.week.days}`);
for (const r of mm.rows) console.log(`${String(r.rank).padStart(2)} ${r.name.padEnd(24)} wk ${String(r.weekPts).padStart(6)} today ${String(r.todayPts).padStart(5)} proj ${String(r.projFinal).padStart(6)} games ${String(r.gamesLeft).padStart(2)} players ${String(r.playersLeft).padStart(2)} risk ${(r.odds * 100).toFixed(1)}%`);
console.log('Projected loser:', mm.loser.name, 'gap', mm.gap, 'to', mm.safety.name);
