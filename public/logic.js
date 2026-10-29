// Pure scoring/projection logic. No DOM — runs in the browser and in Node tests.

export const ACTIVE_MAX_SLOT = 11; // ESPN basketball lineup slots 0–11 score; 12 = bench, 13 = IR
export const IR_SLOT = 13;
const ET = 'America/New_York';
const DAY_MS = 86_400_000;

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
    eligibleSlots: p.eligibleSlots || [],
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
  const slotIds = []; // one entry per starting slot, e.g. [0, 1, 2, 3, 4, 5, 6, 11, 11, 11]
  let rosterLimit = 0;
  for (const [slot, count] of Object.entries(slotCounts)) {
    rosterLimit += num(count);
    if (Number(slot) > ACTIVE_MAX_SLOT) continue;
    activeSlots += num(count);
    for (let i = 0; i < num(count); i++) slotIds.push(Number(slot));
  }

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
    slotIds: slotIds.length ? slotIds : [0, 1, 2, 3, 4, 5, 6, 11, 11, 11],
    rosterLimit: rosterLimit || 23,
    matchupPeriods: settings.scheduleSettings?.matchupPeriods || null,
    schedule: raw.schedule || [],
    teams,
  };
}

// ESPN's injury report as a map by player id: { status, returnMs (UTC midnight of the expected return date),
// guess (ESPN gives no timetable, so the date is a placeholder), type, detail }.
export function injuryMap(list) {
  const out = new Map();
  for (const i of list || []) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(i.returnDate || '');
    out.set(Number(i.playerId), { status: i.status, returnMs: m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null, guess: Boolean(i.guess), type: i.type || null, detail: i.detail || null, comment: i.comment || '' });
  }
  return out;
}

export function parseProSchedule(raw) {
  const games = new Map(); // proTeamId -> Map(sp -> game)
  const spDate = new Map(); // sp -> earliest tip-off (ms)
  const spLast = new Map(); // sp -> latest tip-off (ms)
  const spSlate = new Map(); // sp -> tip-off time of every game that day (ms, sorted)
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
      if (!spLast.has(sp) || g.date > spLast.get(sp)) spLast.set(sp, num(g.date));
      if (g.homeProTeamId === t.id) spSlate.set(sp, [...(spSlate.get(sp) || []), num(g.date)]); // count each game once, from the home side
    }
    games.set(t.id, bySP);
  }
  for (const [sp, times] of spSlate) spSlate.set(sp, times.sort((a, b) => a - b));
  return { games, spDate, spLast, spSlate, abbrev, dayOffset: spDayOffset(spDate) };
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

const GAME_LENGTH = 3.5 * 3_600_000; // tip-off to final buzzer, with overtime and delays to spare

// ESPN keeps a scoring period "current" for hours after its last game ends. Once every game that day
// has had time to finish, the day is done and belongs in the recap, whatever ESPN's counter says.
export function isDayDone(pro, sp, now) {
  const last = pro.spLast?.get(sp);
  return last != null && now >= last + GAME_LENGTH;
}

// The last scoring period whose results are final.
// `dayDone`: true/false when the live scoreboard says whether today's games are all final; undefined falls back to the clock.
export const finishedThrough = (league, pro, now, dayDone) => ((dayDone ?? isDayDone(pro, league.currentSP, now)) ? league.currentSP : league.currentSP - 1);

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
              playerPoolEntry: { player: { id: p.id, fullName: p.fullName, proTeamId: p.proTeamId, injuryStatus: p.injuryStatus, eligibleSlots: p.eligibleSlots, stats: (p.stats || []).filter(keepStat).map(slimStat) } },
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

// The scoring period for a moment in time (the US Eastern calendar day it falls on), or null if unknown.
export function spOnDate(pro, ms) {
  return pro.dayOffset == null ? null : etDayNumber(ms) - pro.dayOffset;
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

export const DEFAULT_WEEK_START = 2; // Tuesday: this league's weeks run Tuesday to Monday (US Eastern)

// 'Tue', 'tuesday', 2 -> 2 (JS weekday, Sunday = 0). Anything unrecognised gives the default.
export function parseWeekStart(v) {
  const i = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(String(v ?? '').trim().slice(0, 3).toLowerCase());
  return i >= 0 ? i : DEFAULT_WEEK_START;
}

// Weeks follow ESPN's matchup periods when they exist; otherwise 7-day weeks starting on `weekStart`
// (US Eastern calendar days). `weeks.source` says which.
export function buildWeeks(league, pro, { weekStart = DEFAULT_WEEK_START } = {}) {
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
    const start = day - ((new Date(day).getUTCDay() - weekStart + 7) % 7) * DAY_MS;
    if (start !== key) groups.push([]), (key = start);
    groups.at(-1).push(sp);
  }
  // A short opening stub (season starts late in the week) joins week 1.
  if (groups.length > 1 && groups[0].length < 4) groups.splice(0, 2, [...groups[0], ...groups[1]]);
  return Object.assign(groups.map((g, i) => ({ id: i + 1, sps: g })), { source: 'calendar', weekStart });
}

export const weekOf = (weeks, sp) => weeks.find((w) => w.sps.includes(sp)) || null;

export function currentWeek(weeks, sp) {
  return weekOf(weeks, sp) || weeks.find((w) => w.sps[0] > sp) || weeks[weeks.length - 1];
}

export function weekLabel(pro, week) {
  return `${dayLabel(pro, week.sps[0])} to ${dayLabel(pro, week.sps[week.sps.length - 1])}`;
}

/* ---------- Game day schedule ---------- */

const LIKELY_GAME = 2.5 * 3_600_000; // a typical NBA game, tip-off to final buzzer

export function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: tz });
    return Boolean(tz);
  } catch {
    return false;
  }
}

// "Thu 10:00 am" in the given time zone (en-AU, 12-hour).
export function localTime(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()}`;
}

export const zoneName = (ms, tz) => new Intl.DateTimeFormat('en-AU', { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms).find((x) => x.type === 'timeZoneName')?.value || tz;

// "2h 15m" / "40m"
export function duration(ms) {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

// ESPN's scoreboard asks for the US Eastern date as YYYYMMDD.
export function etDateKey(pro, sp) {
  const day = spDay(pro, sp);
  return day == null ? null : new Date(day).toISOString().slice(0, 10).replace(/-/g, '');
}

// One game day: when it starts, when it likely ends, and where it is now.
// `board` is the live scoreboard for that day ({ sp, games: [{ state: 'pre' | 'in' | 'post' }] }); without it
// the state is estimated from the clock.
export function dayInfo(pro, sp, now, board = null) {
  const slate = pro.spSlate?.get(sp);
  if (!slate?.length) return null;
  const firstTip = slate[0];
  const lastTip = slate.at(-1);
  const live = board && board.sp === sp && board.games.length >= slate.length ? board.games : null;
  let state;
  let final = null;
  if (live) {
    final = live.filter((g) => g.state === 'post').length;
    const playing = live.filter((g) => g.state === 'in').length;
    state = final === live.length ? 'done' : final + playing > 0 ? 'live' : 'upcoming';
  } else {
    state = now < firstTip ? 'upcoming' : now >= lastTip + GAME_LENGTH ? 'done' : 'live';
  }
  return { sp, games: slate.length, firstTip, lastTip, likelyEnd: lastTip + LIKELY_GAME, state, final, estimated: !live };
}

// Today's slate and, once it is over (or there is none), the next one.
export function gameDays(pro, cur, now, board = null) {
  const today = dayInfo(pro, cur, now, board);
  let next = null;
  for (let sp = cur + 1; sp <= cur + 14 && !next; sp++) next = dayInfo(pro, sp, now);
  return { today, next };
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

// Points per game we expect from a player when he plays: his games so far, pulled toward ESPN's preseason
// projection as if it were 16 games of evidence. Fitted on last season's game logs (see README, Trade stars):
// this predicted the rest of the season better than the raw average or the old average + last-15 blend.
export function expectedPerGame(p) {
  const prior = p.projAvg || p.seasonAvg || 0;
  return ((p.seasonGP || 0) * (p.seasonAvg || 0) + 16 * prior) / ((p.seasonGP || 0) + 16);
}

/* ---------- Week simulation ---------- */

// Fitted on a real week (see test/backtest). Players miss games, and a miss tends to repeat.
export const MODEL = {
  gameCV: 0.4, // spread of a player's points in a game he plays, as a share of his average (measured: 0.40)
  base: 0.035, // chance a healthy player sits out after playing; with `persist` this settles at ~8% of games missed (measured: 9%)
  persist: 0.6, // chance he also misses the next one, once he has missed
  outPersist: 0.9, // same, for a player ESPN lists as out
  levelSd: 0.2, // uncertainty in a player's true average before any games (shrinks as games are played)
  levelFloor: 0.05, // role and usage can change, whatever the sample
  later: 0.97, // days not yet set: managers miss slots, positions don't line up
  returnMiss: 0.4, // chance a player misses his first game back from an injury (an assumption: not testable yet)
  teamSd: 0.07, // how well a manager sets lineups all week (teams scored 85-96% of their best lineup)
};

// Chance a player misses his next game, from ESPN's injury status.
export function missChance(status) {
  switch (String(status || 'ACTIVE').toUpperCase()) {
    case 'OUT':
    case 'SUSPENSION':
    case 'INJURY_RESERVE':
      return 1;
    case 'DOUBTFUL':
      return 0.85;
    case 'QUESTIONABLE':
      return 0.45;
    case 'DAY_TO_DAY':
    case 'GTD':
      return 0.35;
    default:
      return MODEL.base;
  }
}

// Relative uncertainty in a player's true scoring level: the prior, shrunk by the games he has played.
export const levelSd = (gp) => Math.sqrt(1 / (1 / MODEL.levelSd ** 2 + gp / MODEL.gameCV ** 2) + MODEL.levelFloor ** 2);

// What a team can still score this week. Today uses the lineup as set (games not yet started); later
// days assume the best `activeSlots` players by expected points get started, chosen before knowing who sits.
// Returns the expected points plus the plan the simulation draws from.
export function projectTeam(team, { week, currentSP, pro, now, activeSlots }) {
  const days = week.sps.filter((sp) => sp >= currentSP);
  const cands = [];
  for (const p of team.roster) {
    if (p.slot === IR_SLOT) continue;
    const mu = expectedPerGame(p);
    if (mu <= 0) continue;
    const persist = missChance(p.injury) >= 1 && p.returnMs == null ? MODEL.outPersist : MODEL.persist;
    // With an expected return date from ESPN's injury report: certainly out before it, shaky just after it.
    // Without one, ESPN's status gives the chance and a miss tends to repeat.
    const dated = p.returnMs != null;
    let miss = dated ? MODEL.returnMiss : missChance(p.injury);
    let anchored = true; // the chain starts here (first game, or the first game back)
    const games = [];
    for (const sp of days) {
      const g = pro.games.get(p.proTeamId)?.get(sp);
      if (!g || (sp === currentSP && g.date <= now)) continue; // no game, or already played (its points are in the total)
      if (dated && spDay(pro, sp) < p.returnMs) {
        games.push({ sp, miss: 1, forced: true, picked: false, today: false });
        miss = MODEL.returnMiss;
        anchored = true;
        continue;
      }
      games.push({ sp, miss, anchor: anchored, picked: false, today: sp === currentSP && p.slot <= ACTIVE_MAX_SLOT });
      anchored = false;
      miss = miss * persist + (1 - miss) * MODEL.base;
    }
    if (games.length) cands.push({ p, mu, persist, games });
  }

  for (const sp of days) {
    const here = cands.map((c) => ({ c, g: c.games.find((x) => x.sp === sp) })).filter((x) => x.g && x.g.miss < 0.999);
    if (sp === currentSP) {
      for (const { g } of here) g.picked = g.today; // the lineup as set
    } else {
      here.sort((a, b) => b.c.mu * (1 - b.g.miss) - a.c.mu * (1 - a.g.miss));
      for (const { g } of here.slice(0, activeSlots)) g.picked = true;
    }
  }

  let mean = 0;
  let games = 0;
  const players = new Set();
  const plan = [];
  for (const c of cands) {
    if (!c.games.some((g) => g.picked)) continue;
    plan.push({ mu: c.mu, levelSd: levelSd(c.p.seasonGP), persist: c.persist, games: c.games.map((g) => ({ ...g, w: g.sp === currentSP ? 1 : MODEL.later })) });
    for (const g of c.games) {
      if (!g.picked) continue;
      mean += c.mu * (1 - g.miss) * (g.sp === currentSP ? 1 : MODEL.later);
      if (g.miss < 0.5) {
        games += 1; // "games left" counts games he is likely to play; a long shot still adds to the mean
        players.add(c.p.playerId);
      }
    }
  }
  return { mean: r1(mean), games, players: players.size, plan };
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

// Plays the rest of the week many times: each player gets a true level (uncertain), then a chain of
// played/missed games, then a noisy score per game he plays. Returns each team's chance of finishing last
// and the spread of its remaining points. Seeded so the numbers don't jitter between renders.
export function simulateWeek(rows, sims = 4000) {
  let seed = 7;
  for (const r of rows) seed = (Math.imul(seed, 31) + Math.round(r.current * 10 + r.mean * 7)) | 0;
  const rand = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
  const sigma2 = Math.log(1 + MODEL.gameCV ** 2);
  const sigma = Math.sqrt(sigma2);
  const hits = new Map(rows.map((r) => [r.id, 0]));
  const sum = new Map(rows.map((r) => [r.id, 0]));
  const sumSq = new Map(rows.map((r) => [r.id, 0]));
  for (let i = 0; i < sims; i++) {
    let min = Infinity;
    let losers = [];
    for (const r of rows) {
      let rest = 0;
      const manager = Math.exp(MODEL.teamSd * gauss() - (MODEL.teamSd * MODEL.teamSd) / 2);
      for (const pl of r.plan || []) {
        const level = Math.exp(pl.levelSd * gauss() - (pl.levelSd * pl.levelSd) / 2);
        let missed = false;
        for (const g of pl.games) {
          if (g.forced) {
            missed = true; // ESPN says he is still out
            continue;
          }
          missed = rand() < (g.anchor ? g.miss : missed ? pl.persist : MODEL.base);
          if (!missed && g.picked) rest += pl.mu * level * g.w * Math.exp(sigma * gauss() - sigma2 / 2);
        }
      }
      rest *= manager;
      sum.set(r.id, sum.get(r.id) + rest);
      sumSq.set(r.id, sumSq.get(r.id) + rest * rest);
      const v = r.current + rest;
      if (v < min - 1e-9) (min = v), (losers = [r.id]);
      else if (Math.abs(v - min) <= 1e-9) losers.push(r.id);
    }
    for (const id of losers) hits.set(id, hits.get(id) + 1 / losers.length);
  }
  return new Map(rows.map((r) => {
    const m = sum.get(r.id) / sims;
    return [r.id, { odds: hits.get(r.id) / sims, mean: m, sd: Math.sqrt(Math.max(0, sumSq.get(r.id) / sims - m * m)) }];
  }));
}

/* ---------- Model for the UI ---------- */

export function buildModel({ league, pro, weeks, daily, dayDetail, now, source, dayDone }) {
  const cur = league.currentSP;
  const week = currentWeek(weeks, cur);
  const teamById = new Map(league.teams.map((t) => [t.id, t]));
  const nowSt = standings(league.teams, daily, week.sps, cur);
  const prevSt = week.sps.includes(cur - 1) ? standings(league.teams, daily, week.sps, cur - 1) : null;
  const through = finishedThrough(league, pro, now, dayDone);

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
      plan: proj.plan,
      gamesLeft: proj.games,
      playersLeft: proj.players,
    };
  });

  const sim = simulateWeek(rows.map((r) => ({ id: r.id, current: r.weekPts, mean: r.projRemaining, plan: r.plan })));
  for (const r of rows) {
    r.odds = sim.get(r.id).odds;
    r.sd = sim.get(r.id).sd;
    delete r.plan;
  }
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
    recap: buildRecap({ league, pro, weeks, daily, dayDetail, cur: through + 1, teamById }),
    recapLive: through < cur ? liveRecap({ league, pro, weeks, daily, dayDetail, cur, teamById }) : null,
    shame: weeklyResults(league.teams, daily, weeks, through + 1, pro),
    source,
    weeksSource: weeks.source || null,
    weekStart: weeks.weekStart ?? null,
  };
}

// `live`: the day is still being played, so these are points so far rather than results.
export function buildRecap({ league, pro, weeks, daily, dayDetail, cur, teamById, live = false }) {
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
    final: !live && D === week.sps.at(-1),
    live,
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

// Today so far, once any team has scored: the recap for a day ESPN hasn't finished.
function liveRecap(args) {
  const r = buildRecap({ ...args, cur: args.cur + 1, live: true });
  return r && r.rows.some((x) => x.dayPts > 0) ? r : null;
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
