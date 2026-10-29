// Pure scoring/projection logic. No DOM — runs in the browser and in Node tests.

export const ACTIVE_MAX_SLOT = 11; // ESPN basketball lineup slots 0–11 score; 12 = bench, 13 = IR
export const IR_SLOT = 13;
const ET = 'America/New_York';
const DAY_MS = 86_400_000;
const GAME_SD = 0.35; // per-game spread as a share of a player's average

export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
export const r1 = (v) => Math.round(v * 10) / 10;

/* ---------- ESPN parsing ---------- */

export function parseEntry(e, season) {
  const p = e.playerPoolEntry?.player || e.player || {};
  const stats = (p.stats || []).filter((s) => s.seasonId == null || s.seasonId === season);
  const agg = (prefix) => stats.find((s) => String(s.id).startsWith(prefix) && !(s.scoringPeriodId > 0));
  const total = agg('00');
  const last15 = agg('02');
  const proj = agg('10');

  const bySP = {};
  for (const s of stats) {
    if (!(s.scoringPeriodId > 0)) continue;
    const source = s.statSourceId ?? (String(s.id)[0] === '1' ? 1 : 0);
    if (source === 0) bySP[s.scoringPeriodId] = num(s.appliedTotal);
  }

  const seasonAvg = num(total?.appliedAverage);
  const gp = num(total?.stats?.['42']) || (seasonAvg ? Math.round(num(total.appliedTotal) / seasonAvg) : 0);

  return {
    playerId: p.id ?? e.playerId,
    name: p.fullName || 'Unknown player',
    proTeamId: p.proTeamId,
    slot: e.lineupSlotId,
    injury: p.injuryStatus || 'ACTIVE',
    seasonAvg,
    seasonGP: gp,
    last15Avg: num(last15?.appliedAverage),
    projAvg: num(proj?.appliedAverage),
    bySP,
  };
}

export function parseLeague(raw, fallbackSeason) {
  const season = raw.seasonId ?? fallbackSeason;
  const members = new Map((raw.members || []).map((m) => [m.id, m]));
  const settings = raw.settings || {};
  const slotCounts = settings.rosterSettings?.lineupSlotCounts || {};
  let activeSlots = 0;
  for (const [slot, count] of Object.entries(slotCounts)) if (Number(slot) <= ACTIVE_MAX_SLOT) activeSlots += num(count);

  const teams = (raw.teams || []).map((t) => {
    const owner = members.get((t.owners || [])[0]);
    return {
      id: t.id,
      name: (t.name || `${t.location ?? ''} ${t.nickname ?? ''}`).trim() || `Team ${t.id}`,
      abbrev: t.abbrev || '',
      logo: t.logo || null,
      owner: owner ? owner.firstName || owner.displayName || '' : '',
      seasonTotal: num(t.points ?? t.record?.overall?.pointsFor), // finished days only
      seasonLive: t.pointsLive == null ? null : num(t.pointsLive), // also counts today's games in progress
      roster: (t.roster?.entries || []).map((e) => parseEntry(e, season)),
    };
  });

  return {
    season,
    currentSP: raw.scoringPeriodId,
    firstSP: raw.status?.firstScoringPeriod ?? 1,
    finalSP: raw.status?.finalScoringPeriod ?? null,
    name: settings.name || 'Fantasy league',
    activeSlots: activeSlots || 10,
    matchupPeriods: settings.scheduleSettings?.matchupPeriods || null,
    schedule: raw.schedule || [],
    teams,
  };
}

export function parseProSchedule(raw) {
  const games = new Map(); // proTeamId -> Map(sp -> game)
  const spDate = new Map(); // sp -> earliest tip-off (ms)
  const abbrev = new Map();
  for (const t of raw?.settings?.proTeams || []) {
    abbrev.set(t.id, t.abbrev || '');
    if (!t.id) continue;
    const bySP = new Map();
    for (const [key, list] of Object.entries(t.proGamesByScoringPeriod || {})) {
      if (!list?.length) continue;
      const g = list[0];
      const sp = Number(key);
      bySP.set(sp, { date: num(g.date), opp: g.homeProTeamId === t.id ? g.awayProTeamId : g.homeProTeamId });
      if (!spDate.has(sp) || g.date < spDate.get(sp)) spDate.set(sp, num(g.date));
    }
    games.set(t.id, bySP);
  }
  return { games, spDate, abbrev, dayOffset: spDayOffset(spDate) };
}

// ESPN scoring period N is one US Eastern calendar day, with no period at all on days with no games.
// So (ET date in days) - N is constant; take the most common value and derive every period's date from it.
function spDayOffset(spDate) {
  const counts = new Map();
  for (const [sp, ms] of spDate) {
    const off = etDayNumber(ms) - sp;
    counts.set(off, (counts.get(off) || 0) + 1);
  }
  let best = null;
  for (const [off, n] of counts) if (!best || n > best[1]) best = [off, n];
  return best ? best[0] : null;
}

// UTC midnight (ms) of the ET calendar date for scoring period `sp`, or null if unknown.
export function spDay(pro, sp) {
  return pro.dayOffset == null ? null : (pro.dayOffset + sp) * DAY_MS;
}

/* ---------- Slimming (static snapshot) ---------- */

// Same shape as ESPN's response but only what the parsers read, so a snapshot stays small.
// `sp`: the one day whose per-game stat is kept. `full: false` also drops team info, settings and
// season aggregates, which is all a per-day roster needs.
function slimStat(s) {
  const out = { id: s.id, seasonId: s.seasonId, scoringPeriodId: s.scoringPeriodId, statSourceId: s.statSourceId, statSplitTypeId: s.statSplitTypeId, appliedTotal: s.appliedTotal, appliedAverage: s.appliedAverage };
  if (s.stats?.['42'] != null) out.stats = { 42: s.stats['42'] };
  return out;
}

export function slimLeague(raw, season, { sp, full = true }) {
  const keepStat = (s) => {
    if (s.seasonId != null && s.seasonId !== season) return false;
    if (s.scoringPeriodId > 0) return s.scoringPeriodId === sp && (s.statSourceId ?? (String(s.id)[0] === '1' ? 1 : 0)) === 0;
    return full; // aggregates are only needed for projections
  };
  const out = {
    seasonId: raw.seasonId,
    scoringPeriodId: raw.scoringPeriodId,
    teams: (raw.teams || []).map((t) => {
      const team = { id: t.id };
      if (full) {
        Object.assign(team, { name: t.name, location: t.location, nickname: t.nickname, abbrev: t.abbrev, logo: t.logo, owners: (t.owners || []).slice(0, 1), points: t.points, pointsLive: t.pointsLive });
        if (t.record?.overall?.pointsFor != null) team.record = { overall: { pointsFor: t.record.overall.pointsFor } };
      }
      if (t.roster) {
        team.roster = {
          entries: (t.roster.entries || []).map((e) => {
            const p = e.playerPoolEntry?.player || e.player || {};
            return {
              playerId: e.playerId ?? p.id,
              lineupSlotId: e.lineupSlotId,
              playerPoolEntry: { player: { id: p.id, fullName: p.fullName, proTeamId: p.proTeamId, injuryStatus: p.injuryStatus, stats: (p.stats || []).filter(keepStat).map(slimStat) } },
            };
          }),
        };
      }
      return team;
    }),
  };
  if (!full) return out;
  if (raw.members) out.members = raw.members.map((m) => ({ id: m.id, firstName: m.firstName, displayName: m.displayName }));
  if (raw.status) {
    const { firstScoringPeriod, finalScoringPeriod, latestScoringPeriod, currentMatchupPeriod } = raw.status;
    out.status = { firstScoringPeriod, finalScoringPeriod, latestScoringPeriod, currentMatchupPeriod };
  }
  const st = raw.settings;
  if (st) {
    out.settings = {
      name: st.name,
      rosterSettings: { lineupSlotCounts: st.rosterSettings?.lineupSlotCounts },
      scheduleSettings: { matchupPeriods: st.scheduleSettings?.matchupPeriods },
      scoringSettings: { scoringType: st.scoringSettings?.scoringType },
    };
  }
  out.schedule = (raw.schedule || [])
    .filter((m) => m.home?.pointsByScoringPeriod || m.away?.pointsByScoringPeriod)
    .map((m) => ({
      matchupPeriodId: m.matchupPeriodId,
      home: { teamId: m.home?.teamId, pointsByScoringPeriod: m.home?.pointsByScoringPeriod },
      ...(m.away ? { away: { teamId: m.away.teamId, pointsByScoringPeriod: m.away.pointsByScoringPeriod } } : {}),
    }));
  return out;
}

export function slimPro(raw) {
  return {
    settings: {
      proTeams: (raw?.settings?.proTeams || []).map((t) => ({
        id: t.id,
        abbrev: t.abbrev,
        proGamesByScoringPeriod: Object.fromEntries(
          Object.entries(t.proGamesByScoringPeriod || {}).map(([sp, list]) => [sp, list.map((g) => ({ date: g.date, homeProTeamId: g.homeProTeamId, awayProTeamId: g.awayProTeamId }))]),
        ),
      })),
    },
  };
}

/* ---------- Daily points ---------- */

// Per-team daily points straight from ESPN's matchup feed (when the league has one).
export function dailyFromSchedule(league) {
  const daily = new Map();
  for (const m of league.schedule) {
    for (const side of ['home', 'away']) {
      const s = m[side];
      if (!s?.teamId || !s.pointsByScoringPeriod) continue;
      if (!daily.has(s.teamId)) daily.set(s.teamId, new Map());
      for (const [sp, pts] of Object.entries(s.pointsByScoringPeriod)) daily.get(s.teamId).set(Number(sp), num(pts));
    }
  }
  return daily;
}

export function scheduleCovers(daily, league, pro, sps) {
  if (!league.teams.every((t) => daily.has(t.id))) return false;
  return sps.every((sp) => !pro.spDate.has(sp) || league.teams.some((t) => daily.get(t.id).has(sp)));
}

// One day's points per team from a roster response requested with scoringPeriodId=sp.
// Only players in scoring slots (not bench/IR) that day count.
export function dayFromRoster(raw, sp, fallbackSeason) {
  const season = raw.seasonId ?? fallbackSeason;
  const out = new Map();
  for (const t of raw.teams || []) {
    let pts = 0;
    const players = [];
    for (const e of t.roster?.entries || []) {
      const p = parseEntry(e, season);
      const v = p.bySP[sp];
      if (v === undefined) continue;
      const active = p.slot <= ACTIVE_MAX_SLOT;
      if (active) pts += v;
      players.push({ name: p.name, pts: v, active, proTeamId: p.proTeamId });
    }
    out.set(t.id, { pts: r1(pts), players });
  }
  return out;
}

/* ---------- Weeks ---------- */

const etParts = new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: 'numeric', day: 'numeric' });
const dayLabelFmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

// Whole days since 1970-01-01 of the ET calendar date containing `ms`.
function etDayNumber(ms) {
  const p = Object.fromEntries(etParts.formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day) / DAY_MS;
}

export function dayLabel(pro, sp) {
  const ms = spDay(pro, sp);
  return ms == null ? `Day ${sp}` : dayLabelFmt.format(ms).replace(',', '');
}

// ESPN's own matchup periods, only if they look like weeks. A season-long points league can report
// one giant period (or none), which would make "this week" the whole season.
function espnWeeks(league) {
  const mp = league.matchupPeriods;
  if (!mp || !Object.keys(mp).length) return null;
  const weeks = Object.entries(mp)
    .map(([id, sps]) => ({ id: Number(id), sps: (Array.isArray(sps) ? sps : []).map(Number).sort((a, b) => a - b) }))
    .filter((w) => w.sps.length)
    .sort((a, b) => a.id - b.id);
  if (weeks.length < 2) return null;
  const lens = weeks.map((w) => w.sps.length).sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)];
  return median >= 5 && median <= 9 && lens.at(-1) <= 21 ? weeks : null;
}

// Weeks follow ESPN's matchup periods when they exist; otherwise Monday–Sunday in US Eastern.
// `weeks.source` says which.
export function buildWeeks(league, pro) {
  const fromEspn = espnWeeks(league);
  if (fromEspn) return Object.assign(fromEspn, { source: 'espn' });

  const groups = [];
  const sps = [...pro.spDate.keys()];
  const last = Math.max(0, ...sps);
  const first = Math.min(league.firstSP || 1, ...sps);
  let key = null;
  for (let sp = first; sp <= last; sp++) {
    const day = spDay(pro, sp);
    if (day == null) break;
    const monday = day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS;
    if (monday !== key) groups.push([]), (key = monday);
    groups.at(-1).push(sp);
  }
  // A short opening stub (season starts late in the week) joins week 1.
  if (groups.length > 1 && groups[0].length < 4) groups.splice(0, 2, [...groups[0], ...groups[1]]);
  return Object.assign(groups.map((g, i) => ({ id: i + 1, sps: g })), { source: 'calendar' });
}

export const weekOf = (weeks, sp) => weeks.find((w) => w.sps.includes(sp)) || null;

export function currentWeek(weeks, sp) {
  return weekOf(weeks, sp) || weeks.find((w) => w.sps[0] > sp) || weeks[weeks.length - 1];
}

export function weekLabel(pro, week) {
  return `${dayLabel(pro, week.sps[0])} to ${dayLabel(pro, week.sps[week.sps.length - 1])}`;
}

/* ---------- Standings ---------- */

// Weekly points from 0, summing days in the week up to and including `upto`.
export function standings(teams, daily, sps, upto = Infinity) {
  const rows = teams.map((t) => {
    let pts = 0;
    for (const sp of sps) if (sp <= upto) pts += daily.get(t.id)?.get(sp) ?? 0;
    return { id: t.id, pts: r1(pts) };
  });
  rows.sort((a, b) => b.pts - a.pts);
  rows.forEach((r, i) => (r.rank = i > 0 && r.pts === rows[i - 1].pts ? rows[i - 1].rank : i + 1));
  return new Map(rows.map((r) => [r.id, r]));
}

/* ---------- Projections ---------- */

export function injuryFactor(status) {
  switch (String(status || 'ACTIVE').toUpperCase()) {
    case 'OUT':
    case 'SUSPENSION':
    case 'INJURY_RESERVE':
      return 0;
    case 'DOUBTFUL':
      return 0.25;
    case 'QUESTIONABLE':
      return 0.55;
    case 'DAY_TO_DAY':
    case 'GTD':
      return 0.7;
    default:
      return 1;
  }
}

// Points per game we expect from a player: season average, nudged by last 15 days,
// blended with ESPN's preseason projection while the sample is small.
export function expectedPerGame(p) {
  if (p.seasonGP >= 10) return p.last15Avg ? 0.6 * p.seasonAvg + 0.4 * p.last15Avg : p.seasonAvg;
  const prior = p.projAvg || p.seasonAvg;
  const w = p.seasonGP / 10;
  return w * p.seasonAvg + (1 - w) * prior;
}

// Remaining expected points for the week. Today uses the lineup as set (unstarted games only);
// later days assume the best `activeSlots` players with games get started.
export function projectTeam(team, { week, currentSP, pro, now, activeSlots }) {
  let mean = 0;
  let variance = 0;
  let games = 0;
  const players = new Set();

  for (const sp of week.sps) {
    if (sp < currentSP) continue;
    const options = [];
    for (const p of team.roster) {
      if (p.slot === IR_SLOT) continue;
      const g = pro.games.get(p.proTeamId)?.get(sp);
      if (!g) continue;
      const f = injuryFactor(p.injury);
      if (!f) continue;
      if (sp === currentSP && (g.date <= now || p.slot > ACTIVE_MAX_SLOT)) continue;
      const mu = expectedPerGame(p);
      if (mu <= 0) continue;
      options.push({ p, mu, f });
    }
    const picked = sp === currentSP ? options : options.sort((a, b) => b.mu * b.f - a.mu * a.f).slice(0, activeSlots);
    for (const { p, mu, f } of picked) {
      const sd = GAME_SD * mu;
      mean += f * mu;
      variance += f * (sd * sd + mu * mu) - f * f * mu * mu;
      games += 1;
      players.add(p.playerId);
    }
  }
  return { mean: r1(mean), sd: Math.sqrt(variance), games, players: players.size };
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Chance each team finishes the week last (Monte Carlo, seeded so it doesn't jitter between renders).
export function punishmentOdds(rows, sims = 8000) {
  let seed = 7;
  for (const r of rows) seed = (Math.imul(seed, 31) + Math.round(r.current * 10 + r.mean * 7)) | 0;
  const rand = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
  const hits = new Map(rows.map((r) => [r.id, 0]));
  for (let i = 0; i < sims; i++) {
    let min = Infinity;
    let losers = [];
    for (const r of rows) {
      const v = r.current + r.mean + (r.sd ? r.sd * gauss() : 0);
      if (v < min - 1e-9) (min = v), (losers = [r.id]);
      else if (Math.abs(v - min) <= 1e-9) losers.push(r.id);
    }
    for (const id of losers) hits.set(id, hits.get(id) + 1 / losers.length);
  }
  return new Map([...hits].map(([id, n]) => [id, n / sims]));
}

/* ---------- Model for the UI ---------- */

export function buildModel({ league, pro, weeks, daily, dayDetail, now, source }) {
  const cur = league.currentSP;
  const week = currentWeek(weeks, cur);
  const teamById = new Map(league.teams.map((t) => [t.id, t]));
  const nowSt = standings(league.teams, daily, week.sps, cur);
  const prevSt = week.sps.includes(cur - 1) ? standings(league.teams, daily, week.sps, cur - 1) : null;

  const rows = league.teams.map((t) => {
    const st = nowSt.get(t.id);
    const proj = projectTeam(t, { week, currentSP: cur, pro, now, activeSlots: league.activeSlots });
    return {
      id: t.id,
      name: t.name,
      owner: t.owner,
      logo: t.logo,
      seasonTotal: t.seasonTotal,
      weekPts: st.pts,
      rank: st.rank,
      prevRank: prevSt?.get(t.id).rank ?? null,
      todayPts: r1(daily.get(t.id)?.get(cur) ?? 0),
      projRemaining: proj.mean,
      projFinal: r1(st.pts + proj.mean),
      sd: proj.sd,
      gamesLeft: proj.games,
      playersLeft: proj.players,
    };
  });

  const odds = punishmentOdds(rows.map((r) => ({ id: r.id, current: r.weekPts, mean: r.projRemaining, sd: r.sd })));
  for (const r of rows) r.odds = odds.get(r.id);
  rows.sort((a, b) => a.rank - b.rank || b.projFinal - a.projFinal);

  const byProj = [...rows].sort((a, b) => b.projFinal - a.projFinal);
  byProj.forEach((r, i) => (r.projRank = i + 1));
  const loser = [...rows].sort((a, b) => b.odds - a.odds || a.projFinal - b.projFinal)[0];
  const safety = byProj.filter((r) => r.id !== loser?.id).at(-1);

  return {
    leagueName: league.name,
    week: { ...week, label: weekLabel(pro, week), dayNumber: week.sps.filter((sp) => sp <= cur).length, days: week.sps.length },
    currentSP: cur,
    todayLabel: dayLabel(pro, cur),
    rows,
    loser,
    safety,
    gap: loser && safety ? r1(safety.projFinal - loser.projFinal) : 0,
    recap: buildRecap({ league, pro, weeks, daily, dayDetail, cur, teamById }),
    shame: weeklyResults(league.teams, daily, weeks, cur, pro),
    source,
    weeksSource: weeks.source || null,
  };
}

export function buildRecap({ league, pro, weeks, daily, dayDetail, cur, teamById }) {
  const D = cur - 1;
  const week = weekOf(weeks, D);
  if (!week) return null;
  const after = standings(league.teams, daily, week.sps, D);
  const before = week.sps.includes(D - 1) ? standings(league.teams, daily, week.sps, D - 1) : null;

  const rows = league.teams
    .map((t) => {
      const a = after.get(t.id);
      const b = before?.get(t.id);
      return {
        id: t.id,
        name: t.name,
        owner: t.owner,
        dayPts: r1(daily.get(t.id)?.get(D) ?? 0),
        weekPts: a.pts,
        rank: a.rank,
        prevRank: b?.rank ?? null,
        move: b ? b.rank - a.rank : 0,
      };
    })
    .sort((x, y) => x.rank - y.rank);

  let best = null;
  let worst = null;
  for (const [teamId, day] of dayDetail?.get(D) || []) {
    for (const p of day.players) {
      if (!p.active) continue;
      const item = { ...p, team: teamById.get(teamId)?.name || '' };
      if (!best || p.pts > best.pts) best = item;
      if (!worst || p.pts < worst.pts) worst = item;
    }
  }

  const byDay = [...rows].sort((a, b) => b.dayPts - a.dayPts);
  const minWeek = Math.min(...rows.map((r) => r.weekPts));
  return {
    sp: D,
    label: dayLabel(pro, D),
    week: { ...week, label: weekLabel(pro, week) },
    dayNumber: week.sps.indexOf(D) + 1,
    final: D === week.sps.at(-1),
    rows,
    climbers: rows.filter((r) => r.move > 0).sort((a, b) => b.move - a.move),
    fallers: rows.filter((r) => r.move < 0).sort((a, b) => a.move - b.move),
    topDay: byDay[0],
    lowDay: byDay[byDay.length - 1],
    last: rows.filter((r) => r.weekPts === minWeek),
    best,
    worst,
  };
}

export function weeklyResults(teams, daily, weeks, cur, pro) {
  return weeks
    .filter((w) => w.sps.at(-1) < cur && w.sps.some((sp) => teams.some((t) => daily.get(t.id)?.has(sp))))
    .map((w) => {
      const rows = [...standings(teams, daily, w.sps).values()].sort((a, b) => a.pts - b.pts);
      const losers = rows.filter((r) => r.pts === rows[0].pts);
      const next = rows.find((r) => r.pts > rows[0].pts);
      return {
        week: w.id,
        label: weekLabel(pro, w),
        losers: losers.map((r) => ({ id: r.id, pts: r.pts })),
        margin: next ? r1(next.pts - rows[0].pts) : 0,
        top: rows[rows.length - 1],
      };
    })
    .reverse();
}

// Compare our day-by-day rebuild with ESPN's own season totals. ESPN's `points` only counts finished
// days (`pointsLive` adds today's games in progress), so try each pairing and report the closest.
export function checkTotals(teams, daily, uptoSP) {
  return teams.map((t) => {
    let incl = 0;
    let excl = 0;
    for (const [sp, pts] of daily.get(t.id) || []) {
      if (sp <= uptoSP) incl += pts;
      if (sp < uptoSP) excl += pts;
    }
    const tries = [
      { ours: excl, espn: t.seasonTotal, basis: 'finished days' },
      { ours: incl, espn: t.seasonTotal, basis: 'including today' },
      ...(t.seasonLive != null ? [{ ours: incl, espn: t.seasonLive, basis: 'including today' }] : []),
    ];
    const best = tries.reduce((a, b) => (Math.abs(b.ours - b.espn) < Math.abs(a.ours - a.espn) ? b : a));
    return { id: t.id, name: t.name, espn: r1(best.espn), ours: r1(best.ours), basis: best.basis, ok: Math.abs(best.ours - best.espn) < 0.6 };
  });
}
