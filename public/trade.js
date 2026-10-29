// Trade analyser: what a trade is worth to each team over the rest of the season, and how fair it is.
// Pure functions, no DOM. Method (and why) is in the README under "Trade tab and the star rating".
import { spDay } from './logic.js';

export const TRADE = {
  prior: 16, // games of weight given to ESPN's preseason projection (fitted on last season: best of 8-24)
  availPrior: 20, // games of weight given to the league-wide play rate when judging how often a player plays
  baseRate: 0.705, // share of team games a top-owned player actually plays over a season (measured, 311 players)
  recover: 0.9, // how slowly a player who is out with no known return date drifts back to his usual play rate, per game
  returnRecover: 0.5, // after a known return date he is back at his usual rate within a few games (an assumption: not testable yet)
};

/* ---------- One player ---------- */

// Expected points per team game for the rest of the season: points when he plays (shrunk toward ESPN's
// projection) times how often he plays (shrunk toward the league rate). `p.seasonGP` games played so far
// out of `teamGames` that his team has played.
export function playerValue(p, teamGames, { prior = TRADE.prior, availPrior = TRADE.availPrior, baseRate = TRADE.baseRate } = {}) {
  const gp = p.seasonGP || 0;
  const proj = p.projAvg || p.seasonAvg || 0;
  const ppg = (gp * (p.seasonAvg || 0) + prior * proj) / (gp + prior || 1);
  const rate = (gp + availPrior * baseRate) / (Math.max(teamGames, gp) + availPrior);
  return { ppg, rate, perGame: ppg * rate };
}

// Chance he plays his n-th game from now (n = 0 is the next one): a player who is out starts at 0 and
// drifts back to his usual rate; a player who is not listed as out just plays at his usual rate.
export function playChance(rate, outNow, n, recover = TRADE.recover) {
  return outNow ? rate * (1 - recover ** (n + 1)) : rate;
}

/* ---------- One lineup ---------- */

// Best matching (each row used once, each column once), weights >= 0: { total, pairs: [[row, col], ...] }
// with only the pairs that add value. Hungarian algorithm; the matrix is padded with zeros to a square.
export function assign(w) {
  const rows = w.length;
  const cols = rows ? w[0].length : 0;
  const n = Math.max(rows, cols);
  if (!n) return { total: 0, pairs: [] };
  const a = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i && j && i <= rows && j <= cols ? -w[i - 1][j - 1] : 0)));
  const u = Array(n + 1).fill(0);
  const v = Array(n + 1).fill(0);
  const p = Array(n + 1).fill(0);
  const way = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(n + 1).fill(Infinity);
    const used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) (minv[j] = cur), (way[j] = j0);
        if (minv[j] < delta) (delta = minv[j]), (j1 = j);
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) (u[p[j]] += delta), (v[j] -= delta);
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  let total = 0;
  const pairs = [];
  for (let j = 1; j <= cols; j++) {
    if (p[j] && p[j] <= rows && w[p[j] - 1][j - 1] > 0) {
      total += w[p[j] - 1][j - 1];
      pairs.push([p[j] - 1, j - 1]);
    }
  }
  return { total, pairs };
}

export const maxMatching = (w) => assign(w).total;

// Expected points from one day's lineup. `players` = [{ v, slots }] who have a game that day (v = expected
// points, slots = lineup slot ids he may fill); `slotIds` = the starting slots; `r` = what a free agent
// is worth in any slot. A slot nobody beats r for is filled by a free agent.
export function dayValue(players, slotIds, r) {
  return r * slotIds.length + assign(surplus(players, slotIds, r)).total;
}

const surplus = (players, slotIds, r) => players.map((p) => slotIds.map((s) => (p.v > r && p.slots.includes(s) ? p.v - r : 0)));

// Which of `players` (by index) start that day.
export const dayPicks = (players, slotIds, r) => assign(surplus(players, slotIds, r)).pairs.map(([i]) => i);

/* ---------- One team, rest of season ---------- */

// Expected points over `days` for a roster. `plays(p, day)` says whether his team has a game that day,
// `item(p)` gives { v, slots, outNow } for him. Games count from now, so an injured player's value ramps up.
export function rosterValue(roster, days, { slotIds, r, plays, item, dayMs }) {
  const items = roster.map((p) => ({ p, ...item(p), seen: 0 }));
  let total = 0;
  for (const day of days) {
    const today = [];
    for (const it of items) {
      if (!plays(it.p, day)) continue;
      let v = it.v;
      if (it.outUntil != null && dayMs) {
        // ESPN gives a return date: nothing before it, then a short ramp back to his usual rate
        if (dayMs(day) < it.outUntil) continue;
        v *= playChance(1, true, it.seen, TRADE.returnRecover);
        it.seen += 1;
      } else if (it.outNow) {
        v *= playChance(1, true, it.seen);
        it.seen += 1;
      }
      today.push({ v, slots: it.slots });
    }
    total += dayValue(today, slotIds, r);
  }
  return total;
}

/* ---------- A trade ---------- */

// Points per week each team gains (negative = loses) from swapping `give` (from A) for `get` (from B).
export function tradeGains(rosterA, rosterB, giveIds, getIds, ctx) {
  const weeks = Math.max(1, ctx.days.length / 7);
  const key = (p) => p.playerId;
  const moveA = rosterA.filter((p) => giveIds.includes(key(p)));
  const moveB = rosterB.filter((p) => getIds.includes(key(p)));
  const afterA = [...rosterA.filter((p) => !giveIds.includes(key(p))), ...moveB];
  const afterB = [...rosterB.filter((p) => !getIds.includes(key(p))), ...moveA];
  const val = (roster) => rosterValue(roster, ctx.days, ctx);
  return {
    a: (val(afterA) - val(rosterA)) / weeks,
    b: (val(afterB) - val(rosterB)) / weeks,
    rosterA: afterA.length,
    rosterB: afterB.length,
  };
}

/* ---------- Stars ---------- */

export const STARS = {
  sigma: 60, // spread of a trade's real outcome per sqrt(player moved), in points a week (fitted: 50-60)
  replacementRank: 6, // replacement level = the 6th best healthy free agent (about one per team in the league)
  fallbackReplacement: 20, // expected points per team game of that free agent, when the free-agent list is not available
};

// Standard normal CDF (Abramowitz-Stegun 26.2.17).
export function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// How sure we are the side we picked really comes out ahead (0.5 = coin flip). Real outcomes of a trade are
// noisy (injuries above all) and noisier the more players move, so the same gap means less in a big trade.
export const winnerConfidence = (gap, players) => normalCdf(Math.abs(gap) / (STARS.sigma * Math.sqrt(Math.max(1, players))));

// 5 stars = we can't tell who wins (fair), 0.5 = one side wins almost surely. Steps of half a star.
export function starsFor(gap, players) {
  const lopsided = 2 * winnerConfidence(gap, players) - 1;
  return Math.min(5, Math.max(0.5, Math.round((5 - 4.5 * lopsided) * 2) / 2));
}

export function verdict(stars) {
  if (stars >= 4.5) return 'Fair deal';
  if (stars >= 3.5) return 'Slightly lopsided';
  if (stars >= 2.5) return 'Lopsided';
  if (stars >= 1.5) return 'Very one-sided';
  return 'Daylight robbery';
}

/* ---------- From the league's data ---------- */

export const OUT_STATUSES = new Set(['OUT', 'SUSPENSION', 'INJURY_RESERVE']);

// Games a pro team has played up to and including scoring period `sp`.
export function teamGamesThrough(pro, proTeamId, sp) {
  let n = 0;
  for (const g of pro.games.get(proTeamId)?.keys() || []) if (g <= sp) n++;
  return n;
}

// Short date, UTC (the dates here are calendar days): "20 Nov".
export const shortDate = (ms) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(ms);

// Everything the engine needs, from a parsed league. `freeAgents`: parsed free-agent players (any order; without
// them the replacement level falls back to a typical value). `injuries`: ESPN's injury report as a map by
// player id (see injuryMap); players it lists get a known return date instead of a guessed recovery.
export function tradeContext({ league, pro, freeAgents = [], injuries = new Map() }) {
  const cur = league.currentSP;
  const days = [...pro.spSlate.keys()].filter((sp) => sp > cur).sort((a, b) => a - b);
  const through = cur - 1; // games finished before today
  const dayMs = (sp) => spDay(pro, sp);
  const firstDay = days.length ? dayMs(days[0]) : 0;
  const valueOf = (p) => playerValue(p, teamGamesThrough(pro, p.proTeamId, through));
  // Expected return date, if ESPN gives one that is still ahead
  const returnOf = (p) => {
    const ms = p.returnMs ?? injuries.get(p.playerId)?.returnMs ?? null;
    return ms != null && ms > firstDay ? ms : null;
  };
  const isOut = (p) => OUT_STATUSES.has(String(p.injury || '').toUpperCase());
  const healthy = freeAgents.filter((p) => returnOf(p) == null && !isOut(p)).map((p) => valueOf(p).perGame).sort((a, b) => b - a);
  const r = healthy.length >= STARS.replacementRank ? healthy[STARS.replacementRank - 1] : STARS.fallbackReplacement;
  return {
    days,
    slotIds: league.slotIds,
    r,
    replacementFromData: healthy.length >= STARS.replacementRank,
    rosterLimit: league.rosterLimit,
    valueOf,
    dayMs,
    returnOf,
    guessOf: (p) => Boolean(p.returnGuess ?? injuries.get(p.playerId)?.guess),
    plays: (p, sp) => pro.games.get(p.proTeamId)?.has(sp),
    item: (p) => ({ v: valueOf(p).perGame, slots: p.eligibleSlots?.length ? p.eligibleSlots : [11], outNow: isOut(p) || p.slot === 13, outUntil: returnOf(p) }),
    // games he will miss before the return date, for the notes
    missed: (p) => {
      const ms = returnOf(p);
      return ms == null ? 0 : days.filter((d) => pro.games.get(p.proTeamId)?.has(d) && dayMs(d) < ms).length;
    },
    seasonEnd: days.length ? dayMs(days.at(-1)) : 0,
    injuries,
  };
}

// Judge a trade: A gives `giveIds` and gets `getIds` from B. Returns each side's gain in points a week,
// the winner, the stars and plain-language notes.
export function evaluateTrade(ctx, teamA, teamB, giveIds, getIds) {
  const g = tradeGains(teamA.roster, teamB.roster, giveIds, getIds, ctx);
  const players = giveIds.length + getIds.length;
  const gap = g.a - g.b;
  const stars = starsFor(gap, players);
  const side = (team, rosterSize, gain) => ({ id: team.id, name: team.name, gain, rosterAfter: rosterSize, mustDrop: Math.max(0, rosterSize - ctx.rosterLimit) });
  const notes = [];
  const moving = [...teamA.roster.filter((p) => giveIds.includes(p.playerId)), ...teamB.roster.filter((p) => getIds.includes(p.playerId))];
  for (const p of moving) {
    const s = String(p.injury || 'ACTIVE').toUpperCase();
    const ret = ctx.returnOf(p);
    const what = [p.injuryType, p.injuryDetail].filter((x) => x && !/not specified|unknown/i.test(x)).join(' ').toLowerCase();
    if (ret != null && ctx.seasonEnd && ret > ctx.seasonEnd) notes.push(`${p.name} is out for the rest of the season${what ? ` (${what})` : ''}.`);
    else if (ret != null) {
      const n = ctx.missed(p);
      notes.push(`${p.name} is out until about ${shortDate(ret)}${what ? ` (${what})` : ''}${n > 0 ? `, so he misses about ${n} ${n === 1 ? 'game' : 'games'}` : ''}.${ctx.guessOf(p) ? ' ESPN has no firm timetable, so that date is a guess.' : ''}`);
    }
    else if (OUT_STATUSES.has(s)) notes.push(`${p.name} is out right now, so he adds nothing until he returns.`);
    else if (s !== 'ACTIVE') notes.push(`${p.name} is listed as ${s.replace(/_/g, ' ').toLowerCase()}.`);
  }
  return {
    a: side(teamA, g.rosterA, g.a),
    b: side(teamB, g.rosterB, g.b),
    gap,
    winner: Math.abs(gap) < 2 ? null : gap > 0 ? 'a' : 'b', // under 2 points a week is dead even
    stars,
    label: verdict(stars),
    players,
    notes,
  };
}
