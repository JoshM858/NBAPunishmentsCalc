// Loads a league through a data source and builds the inputs for buildModel. No DOM, so the browser,
// the snapshot builder, the check CLI and the tests all run the same code.
// A source is { config(), league(views, { sp, fresh, past }), pro(), now(), history?(), offline? } (see sources.js).
import {
  parseLeague, parseProSchedule, parseWeekStart, buildWeeks, currentWeek, weekOf, dailyFromSchedule, scheduleCovers,
  dayFromRoster, weeklyResults, checkTotals,
} from './logic.js';

export const LIVE_VIEWS = ['mSettings', 'mTeam', 'mRoster', 'mMatchupScore', 'mStatus'];

// Finished days the page needs per-day rosters for: this week so far, plus the week yesterday
// belongs to (on a Monday that is last week, for the recap). Days without games score nothing.
export function neededDays(weeks, cur, pro) {
  const week = currentWeek(weeks, cur);
  const yWeek = weekOf(weeks, cur - 1);
  const sps = [...week.sps, ...(yWeek ? yWeek.sps : [])].filter((sp) => sp < cur && pro.spDate.has(sp));
  return [...new Set(sps)].sort((a, b) => a - b);
}

// Days older than yesterday are final, so only those may come from `cache` ({ get(sp), set(sp, dayMap) }).
export async function fetchDays(src, season, sps, { cache, cur } = {}) {
  const out = new Map();
  const todo = [];
  const cacheable = (sp) => cache && sp < cur - 1;
  for (const sp of sps) {
    const hit = cacheable(sp) ? cache.get(sp) : null;
    if (hit) out.set(sp, hit);
    else todo.push(sp);
  }
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const sp = todo[i++];
      const raw = await src.league(['mRoster'], { sp, past: sp < cur - 1 });
      const day = dayFromRoster(raw, sp, season);
      if (cacheable(sp)) cache.set(sp, day);
      out.set(sp, day);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
  return out;
}

export async function loadLeague(src, { forceRoster = false, fresh = false, cache } = {}) {
  const cfg = await src.config();
  if (!cfg.configured) return { cfg, unconfigured: true };

  const [leagueRaw, proRaw] = await Promise.all([src.league(LIVE_VIEWS, { fresh }), src.pro()]);
  const league = parseLeague(leagueRaw, cfg.season);
  const hide = new Set((cfg.hideTeams || []).map((s) => String(s).toLowerCase()));
  if (hide.size) league.teams = league.teams.filter((t) => ![String(t.id), t.abbrev.toLowerCase(), t.name.toLowerCase()].some((k) => hide.has(k)));
  if (!league.teams.length) throw new Error('ESPN returned a league with no teams. Check LEAGUE_ID and SEASON.');
  const pro = parseProSchedule(proRaw);
  const weeks = buildWeeks(league, pro, { weekStart: parseWeekStart(cfg.weekStart) });
  const cur = league.currentSP;
  const needed = neededDays(weeks, cur, pro);

  const today = dayFromRoster(leagueRaw, cur, cfg.season);
  const dayDetail = new Map([[cur, today]]);
  let daily = dailyFromSchedule(league);
  let source = 'schedule';

  if (forceRoster || !scheduleCovers(daily, league, pro, needed)) {
    source = 'roster';
    daily = new Map(league.teams.map((t) => [t.id, new Map()]));
    for (const [sp, day] of await fetchDays(src, cfg.season, needed, { cache, cur })) {
      dayDetail.set(sp, day);
      for (const [tid, v] of day) daily.get(tid)?.set(sp, v.pts);
    }
  } else if (pro.spDate.has(cur - 1) && cur - 1 >= league.firstSP) {
    for (const [sp, day] of await fetchDays(src, cfg.season, [cur - 1], { cache, cur })) dayDetail.set(sp, day);
  }
  // Today's points so far come from the live roster; ESPN's matchup feed may not have them yet.
  for (const [tid, v] of today) {
    if (!daily.has(tid)) daily.set(tid, new Map());
    if (!daily.get(tid).has(cur)) daily.get(tid).set(cur, v.pts);
  }
  return { cfg, league, pro, weeks, daily, dayDetail, source };
}

// Fill in every finished day (roster method only) so Shame and the ESPN totals check have the whole season.
export async function loadSeasonDays(ctx, src, { cache } = {}) {
  const { cfg, league, pro, daily } = ctx;
  const cur = league.currentSP;
  if (ctx.source === 'roster') {
    const missing = [];
    for (let sp = league.firstSP; sp < cur; sp++) {
      if (pro.spDate.has(sp) && !league.teams.every((t) => daily.get(t.id).has(sp))) missing.push(sp);
    }
    const hist = src.history?.();
    const still = [];
    for (const sp of missing) {
      const day = hist?.get(sp);
      if (day) for (const t of league.teams) daily.get(t.id).set(sp, day.get(t.id) ?? 0);
      else still.push(sp);
    }
    if (still.length && !src.offline) {
      for (const [sp, day] of await fetchDays(src, cfg.season, still, { cache, cur })) for (const [tid, v] of day) daily.get(tid)?.set(sp, v.pts);
    }
  }
  return {
    shame: weeklyResults(league.teams, daily, ctx.weeks, cur, pro),
    check: checkTotals(league.teams, daily, cur),
  };
}

// sp -> { teamId: points } for every finished day, as stored in a snapshot's `history`.
export function historyOf(ctx) {
  const out = {};
  for (const [tid, days] of ctx.daily) {
    for (const [sp, pts] of days) {
      if (sp >= ctx.league.currentSP) continue;
      (out[sp] ||= {})[tid] = pts;
    }
  }
  return out;
}
