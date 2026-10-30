import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemo } from '../public/demo.js';
import {
  parseLeague, parseProSchedule, parseEntry, buildWeeks, currentWeek, weekOf, dayLabel, spDay, parseWeekStart, isDayDone, projectTeam, simulateWeek, missChance, levelSd, MODEL, injuryMap, dayInfo, gameDays, localTime, zoneName, duration, etDateKey, validTimeZone, finishedThrough, dailyFromSchedule,
  dayFromRoster, buildModel, checkTotals, slimLeague, slimPro,
} from '../public/logic.js';
import { LIVE_VIEWS, loadLeague, loadSeasonDays, neededDays, historyOf } from '../public/pipeline.js';
import { createSnapshotSource, fetchScoreboard } from '../public/sources.js';

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

/* ---------- Simulation streams: each team plays out the same whatever the others do ---------- */

{
  const game = (sp) => ({ sp, miss: 0.05, anchor: sp === 1, picked: true, w: 1 });
  const plan = (mu) => [{ mu, levelSd: 0.1, persist: 0.6, games: [1, 2, 3].map(game) }, { mu: mu * 0.8, levelSd: 0.1, persist: 0.6, games: [1, 2, 3].map(game) }];
  const x = { id: 7, current: 100, mean: 200, plan: plan(40) };
  const y = { id: 8, current: 90, mean: 190, plan: plan(38) };
  const alone = simulateWeek([x], 1500, 5).get(7);
  const together = simulateWeek([x, y], 1500, 5).get(7);
  assert.equal(alone.mean, together.mean, 'a team’s own results do not depend on who else plays');
  assert.equal(alone.sd, together.sd);
  const reordered = simulateWeek([y, x], 1500, 5);
  assert.equal(reordered.get(7).mean, alone.mean, 'nor on the order');
  assert.equal(simulateWeek([x, y], 1500, 5).get(7).odds, simulateWeek([x, y], 1500, 5).get(7).odds, 'repeatable with a seed');
  assert.notEqual(simulateWeek([x], 1500, 6).get(7).mean, alone.mean, 'a different seed gives different luck');
  // non-numeric ids get their own streams too
  const named = simulateWeek([{ ...x, id: 'a' }, { ...x, id: 'b' }], 1500, 5);
  assert.notEqual(named.get('a').mean, named.get('b').mean, 'teams with identical plans still get different luck');
  // reusing an earlier run gives exactly the same answer as running everything again, and only re-runs what changed
  const first = simulateWeek([x, y], 1500, 5);
  const y2 = { ...y, mean: 250, plan: plan(45) };
  const again = simulateWeek([x, y2], 1500, 5, first.cache);
  const fresh = simulateWeek([x, y2], 1500, 5);
  for (const id of [7, 8]) assert.deepEqual(again.get(id), fresh.get(id), 'reuse changes nothing but speed');
  assert.equal(again.cache.teams.get(7).reused, true, 'the unchanged team was not re-run');
  assert.equal(again.cache.teams.get(8).reused, false);
  assert.equal(simulateWeek([x, y2], 1500, 9, first.cache).cache.teams.get(7).reused, false, 'a different seed cannot reuse');
  assert.notEqual(again.get(8).mean, first.get(8).mean);
}

/* ---------- Injury return dates in the weekly model ---------- */

{
  const inj = injuryMap([
    { playerId: 1, status: 'Out', returnDate: '2026-11-20', type: 'Foot', detail: 'Fracture', guess: false, comment: 'c' },
    { playerId: 2, status: 'Day-To-Day', returnDate: null },
    { playerId: '3', status: 'Out', returnDate: '2027-07-01', guess: true },
  ]);
  assert.equal(inj.get(1).returnMs, Date.UTC(2026, 10, 20));
  assert.equal(inj.get(2).returnMs, null);
  assert.equal(inj.get(3).guess, true, 'string ids are accepted');
  assert.equal(injuryMap(undefined).size, 0);

  // Week with games on days 10-13 (day n is Oct 19 + n, UTC midnight)
  const sps = [10, 11, 12, 13];
  const proW = { games: new Map([[1, new Map(sps.map((sp) => [sp, { date: sp * 1e6, opp: 2 }]))]]), dayOffset: Math.round(Date.UTC(2026, 9, 19) / 86_400_000) };
  const day = (sp) => Date.UTC(2026, 9, 19) + sp * 86_400_000;
  const player = (extra) => ({ playerId: 1, proTeamId: 1, slot: 0, injury: 'OUT', seasonAvg: 40, seasonGP: 20, last15Avg: 40, projAvg: 40, ...extra });
  const opts = { week: { sps }, currentSP: 10, pro: proW, now: 0, activeSlots: 10 };
  const noDate = projectTeam({ roster: [player({})] }, opts);
  const outAll = projectTeam({ roster: [player({ returnMs: day(14) })] }, opts); // back after the week ends
  const backMid = projectTeam({ roster: [player({ returnMs: day(12) })] }, opts); // back for the last two days
  assert.equal(outAll.mean, 0, 'out for the whole week means no points and no games left');
  assert.equal(outAll.games, 0);
  assert.ok(backMid.mean > 0 && backMid.mean < 2 * 40 * 1.0001, `back on day 12: ${backMid.mean}`);
  assert.ok(backMid.games <= 2);
  assert.ok(noDate.mean > outAll.mean, 'without a date there is still a chance he returns');
  // simulation never scores him before the return date
  const sim = simulateWeek([{ id: 'x', current: 0, mean: outAll.mean, plan: outAll.plan }, { id: 'y', current: 0, mean: backMid.mean, plan: backMid.plan }]);
  assert.equal(sim.get('x').mean, 0);
  assert.equal(sim.get('x').sd, 0);
  assert.ok(sim.get('y').mean > 0 && sim.get('y').mean < 90);
  // a return date already passed behaves like a player coming back, not like a long-term injury
  const returned = projectTeam({ roster: [player({ returnMs: day(9) })] }, opts);
  assert.ok(returned.mean > 3 * 40 * 0.5, `already due back: ${returned.mean}`);
}

/* ---------- The recap follows the last finished day, not ESPN's counter ---------- */

{
  const HOUR = 3_600_000;
  const src = createDemo();
  const ctx = await loadLeague(src, { forceRoster: true });
  const cur = ctx.league.currentSP;
  const last = ctx.pro.spLast.get(cur);
  assert.ok(!isDayDone(ctx.pro, cur, last + 3 * HOUR), 'still inside the last game');
  assert.ok(isDayDone(ctx.pro, cur, last + 3.6 * HOUR));
  assert.ok(!isDayDone(realPro, 15, 1e15), 'a day with no games is never "done"');

  // During the games the recap is yesterday; once they're over it is today, though ESPN still says `cur`
  const during = buildModel({ ...ctx, now: src.now() });
  assert.equal(during.recap.sp, cur - 1);
  assert.equal(during.recap.live, false);
  // ...and today so far is offered alongside it, with the points the team has right now
  assert.equal(during.recapLive.sp, cur);
  assert.equal(during.recapLive.live, true);
  assert.equal(during.recapLive.final, false);
  for (const r of during.recapLive.rows) assert.equal(r.dayPts, during.rows.find((x) => x.id === r.id).todayPts);
  const after = buildModel({ ...ctx, now: last + 4 * HOUR });
  assert.equal(after.recap.sp, cur);
  assert.equal(after.recapLive, null, 'nothing is live once the day is done');
  assert.ok(after.recap.best && after.recap.worst, 'player of the day comes from the finished day');
  for (const r of after.recap.rows) {
    assert.equal(r.dayPts, ctx.daily.get(r.id).get(cur));
    const week = weekOf(weeks, cur).sps.filter((sp) => sp <= cur).reduce((s, sp) => s + (ctx.daily.get(r.id).get(sp) ?? 0), 0);
    assert.ok(Math.abs(r.weekPts - week) < 0.05, 'week total includes the finished day');
  }
  assert.equal(after.week.dayNumber, during.week.dayNumber, 'the This week tab is unchanged');
}

/* ---------- Game day times in Victoria ---------- */

{
  const MEL = 'Australia/Melbourne';
  const HOUR = 3_600_000;
  // Real ESPN schedule: Wed 28 Oct is 12 games, 7:00 pm ET first tip and 10:30 pm ET last tip (US daylight time)
  const wed = dayInfo(realPro, 9, 0);
  assert.equal(wed.games, 12);
  assert.equal(localTime(wed.firstTip, MEL), 'Thu 10:00 am', '7 pm ET on 28 Oct is 10 am Thursday in Victoria (AEDT)');
  assert.equal(localTime(wed.lastTip, MEL), 'Thu 1:30 pm');
  assert.equal(localTime(wed.likelyEnd, MEL), 'Thu 4:00 pm', 'last tip-off + 2.5 hours');
  assert.equal(zoneName(wed.firstTip, MEL), 'AEDT');
  // US clocks go back on 1 Nov, so the same 7 pm ET tip is an hour later in Victoria
  assert.equal(localTime(dayInfo(realPro, 14, 0).firstTip, MEL), 'Tue 11:00 am');
  // Australian winter (AEST): 7 pm ET (EDT) is 9 am next day
  assert.equal(localTime(Date.UTC(2027, 5, 10, 23, 0), MEL), 'Fri 9:00 am');
  assert.equal(zoneName(Date.UTC(2027, 5, 10, 23, 0), MEL), 'AEST');
  assert.equal(localTime(wed.firstTip, 'America/New_York'), 'Wed 7:00 pm', 'other time zones work');
  assert.ok(validTimeZone(MEL) && !validTimeZone('Nowhere/Land') && !validTimeZone(''));
  assert.deepEqual([duration(40 * 60_000), duration(8_100_000), duration(-5)], ['40m', '2h 15m', '0m']);
  assert.equal(etDateKey(realPro, 9), '20261028');
  assert.equal(etDateKey(realPro, 15), '20261103', 'a no-game day still has a date');
  assert.equal(dayInfo(realPro, 15, 0), null, 'no games on 3 Nov');

  // From the clock alone
  assert.equal(dayInfo(realPro, 9, wed.firstTip - HOUR).state, 'upcoming');
  assert.equal(dayInfo(realPro, 9, wed.firstTip + HOUR).state, 'live');
  assert.equal(dayInfo(realPro, 9, wed.lastTip + 3.6 * HOUR).state, 'done');
  assert.equal(dayInfo(realPro, 9, 0).estimated, true);

  // From the live scoreboard, which beats the clock either way
  const games = (...states) => states.map((state, i) => ({ id: String(i), state }));
  const board = (sp, ...states) => ({ sp, games: games(...states) });
  const all = (n, state) => Array(n).fill(state);
  const during = dayInfo(realPro, 9, wed.lastTip + 4 * HOUR, board(9, ...all(7, 'post'), ...all(2, 'in'), ...all(3, 'pre')));
  assert.deepEqual([during.state, during.final, during.estimated], ['live', 7, false], 'scoreboard says live although the clock says done');
  assert.equal(dayInfo(realPro, 9, wed.firstTip - HOUR, board(9, ...all(12, 'post'))).state, 'done', 'all final means finished, whatever the clock says');
  assert.equal(dayInfo(realPro, 9, 0, board(9, ...all(12, 'pre'))).state, 'upcoming');
  assert.equal(dayInfo(realPro, 9, 0, board(9, ...all(5, 'post'))).estimated, true, 'a partial scoreboard is ignored');
  assert.equal(dayInfo(realPro, 9, 0, board(8, ...all(12, 'post'))).estimated, true, 'so is one for another day');

  // Today, then the next slate: Wed 28 Oct, then Thu 29 Oct (3 games, 8 pm ET = Fri 11 am)
  const gd = gameDays(realPro, 9, wed.lastTip + 4 * HOUR, board(9, ...all(12, 'post')));
  assert.equal(gd.today.state, 'done');
  assert.equal(gd.next.sp, 10);
  assert.equal(gd.next.games, 3);
  assert.equal(localTime(gd.next.firstTip, MEL), 'Fri 11:00 am');
  assert.equal(gameDays(realPro, 14, 0).next.sp, 16, 'the next slate skips the no-game day (SP 15)');
  assert.equal(gameDays(realPro, 15, 0).today, null);

  // The recap follows the scoreboard: ESPN says all final, so the day is finished even before 3.5 hours have passed
  const league = { currentSP: 9 };
  assert.equal(finishedThrough(league, realPro, wed.lastTip + HOUR), 8, 'the clock alone is cautious');
  assert.equal(finishedThrough(league, realPro, wed.lastTip + HOUR, true), 9, 'the scoreboard says the games are over');
  assert.equal(finishedThrough(league, realPro, wed.lastTip + 4 * HOUR, false), 8, 'and that a game is still on, however late');

  // Scoreboard fetch: slimmed, and a failure is null rather than an error
  const ok = { ok: true, json: async () => ({ events: [{ id: '1', date: '2026-10-28T23:00Z', status: { type: { state: 'post', detail: 'Final' } } }] }) };
  assert.deepEqual(await fetchScoreboard(9, '20261028', async () => ok), { sp: 9, games: [{ id: '1', start: Date.UTC(2026, 9, 28, 23), state: 'post', detail: 'Final' }] });
  assert.equal(await fetchScoreboard(9, '20261028', async () => ({ ok: false })), null);
  assert.equal(await fetchScoreboard(9, '20261028', async () => { throw new Error('offline'); }), null);
}

/* ---------- Week simulation ---------- */

{
  const sps = [10, 11, 12, 13];
  const week = { sps };
  const proAll = { games: new Map([[1, new Map(sps.map((sp) => [sp, { date: sp * 1e6, opp: 2 }]))]]) };
  const player = (id, mu, extra = {}) => ({ playerId: id, proTeamId: 1, slot: 0, injury: 'ACTIVE', seasonAvg: mu, seasonGP: 20, last15Avg: mu, projAvg: mu, ...extra });
  const roster = (...ps) => ({ roster: ps });
  const opts = { week, currentSP: 10, pro: proAll, now: 0, activeSlots: 10 };

  // Availability: injury status drives the chance of missing, and a miss tends to repeat
  assert.equal(missChance('OUT'), 1);
  assert.equal(missChance('ACTIVE'), MODEL.base);
  assert.ok(missChance('QUESTIONABLE') > missChance('GTD') && missChance('DOUBTFUL') > missChance('QUESTIONABLE'));
  const healthy = projectTeam(roster(player(1, 40)), opts);
  const doubtful = projectTeam(roster(player(1, 40, { injury: 'DOUBTFUL' })), opts);
  const out = projectTeam(roster(player(1, 40, { injury: 'OUT' })), opts);
  assert.ok(healthy.mean > doubtful.mean && doubtful.mean > out.mean);
  assert.equal(out.games, 0, 'a player ruled out is not counted as a game left');
  assert.ok(out.mean < 40 * 0.2 * 4, 'out today still has a small chance to return later in the week');
  // Healthy players still sit ~8% of the time, so four games project below four full games
  assert.ok(healthy.mean < 40 * 3.97 && healthy.mean > 40 * 3.4, `healthy mean ${healthy.mean}`);

  // Today: only the lineup as set counts; a benched player isn't started today but is picked on later days
  const bench = projectTeam(roster(player(1, 40, { slot: 12 })), opts);
  assert.equal(bench.games, 3);
  // Games already started are excluded (their points are in the total)
  assert.equal(projectTeam(roster(player(1, 40)), { ...opts, now: 10e6 + 1 }).games, 3);

  // Only `activeSlots` players start on a later day (today uses the lineup as set, and these are all benched)
  const many = projectTeam(roster(...Array.from({ length: 12 }, (_, i) => player(i, 30 + i, { slot: 12 }))), { ...opts, currentSP: 11, activeSlots: 3 });
  assert.equal(many.games, 6);

  // Less certainty about a player with few games
  assert.ok(levelSd(0) > levelSd(5) && levelSd(5) > levelSd(40) && levelSd(500) >= MODEL.levelFloor);

  // The simulation: odds add up to 1, the trailing team is likelier to lose, results are repeatable
  const plan = projectTeam(roster(...Array.from({ length: 10 }, (_, i) => player(i, 35))), opts);
  const rows = [
    { id: 'a', current: 500, mean: plan.mean, plan: plan.plan },
    { id: 'b', current: 400, mean: plan.mean, plan: plan.plan },
    { id: 'c', current: 700, mean: plan.mean, plan: plan.plan },
  ];
  const sim = simulateWeek(rows);
  assert.ok(Math.abs([...sim.values()].reduce((s, v) => s + v.odds, 0) - 1) < 1e-9);
  assert.ok(sim.get('b').odds > sim.get('a').odds && sim.get('a').odds > sim.get('c').odds, 'order follows the standings');
  assert.ok(sim.get('b').odds > 0.55 && sim.get('b').odds < 0.8, '100 behind with four days left is likely, not certain');
  const gap = (g) => simulateWeek([{ ...rows[0], id: 'lead', current: 500 }, { ...rows[1], id: 'trail', current: 500 - g }]).get('trail').odds;
  assert.ok(gap(200) > 0.75 && gap(200) < 0.92 && gap(500) > 0.98, 'odds grow with the gap, and a 500 gap is near-decisive');
  assert.deepEqual([...simulateWeek(rows)], [...sim], 'seeded, so it does not jitter');
  const close = simulateWeek([{ ...rows[0], current: 500 }, { ...rows[1], current: 520 }]);
  assert.ok(close.get('a').odds > 0.4 && close.get('a').odds < 0.7, 'a 20-point gap is close to a toss-up');
  assert.ok(sim.get('a').mean > plan.mean * 0.9 && sim.get('a').mean < plan.mean * 1.1, 'simulated mean agrees with the projection');
  assert.ok(sim.get('a').sd > 50, 'a team’s remaining points are genuinely uncertain');

  // No remaining games: the result is decided, ties split
  const done = simulateWeek([{ id: 'x', current: 10, mean: 0, plan: [] }, { id: 'y', current: 20, mean: 0, plan: [] }, { id: 'z', current: 10, mean: 0, plan: [] }]);
  assert.deepEqual([done.get('x').odds, done.get('y').odds, done.get('z').odds], [0.5, 0, 0.5]);
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
