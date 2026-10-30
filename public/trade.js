// Trade analyser: what a trade is worth to each team over the rest of the season, and how fair it is.
// Pure functions, no DOM. Method (and why) is in the README under "Trade tab and the star rating".
import { buildModel, currentWeek, projectTeam, simulateWeek, spDay } from './logic.js';

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

// A message ready to paste into the group chat. `give`/`get` are lists of player names from A's side.
export function tradeSummary(result, { a, b, give, get }) {
  const gain = (v) => `${v < -0.05 ? '−' : '+'}${Math.abs(v).toFixed(1)}`;
  const edge = result.winner === null ? 'Dead even.' : `Edge to ${result.winner === 'a' ? a : b}.`;
  return [
    'Trade idea (from Punishment Watch)',
    `${a} gives: ${give.join(', ')}`,
    `${b} gives: ${get.join(', ')}`,
    `Rating: ${result.stars} out of 5 stars, ${result.label.toLowerCase()}. ${edge}`,
    `${a} ${gain(result.a.gain)} points a week, ${b} ${gain(result.b.gain)} points a week.`,
    'Expected lineup points over the rest of the season; injuries can swing any trade.',
  ].join('\n');
}

// Plain-language warnings about injured players who are changing teams.
function injuryNotes(ctx, moving) {
  const notes = [];
  for (const p of moving) {
    const s = String(p.injury || 'ACTIVE').toUpperCase();
    const ret = ctx.returnOf(p);
    const what = [p.injuryType, p.injuryDetail].filter((x) => x && !/not specified|unknown/i.test(x)).join(' ').toLowerCase();
    if (ret != null && ctx.seasonEnd && ret > ctx.seasonEnd) notes.push(`${p.name} is out for the rest of the season${what ? ` (${what})` : ''}.`);
    else if (ret != null) {
      const n = ctx.missed(p);
      notes.push(`${p.name} is out until about ${shortDate(ret)}${what ? ` (${what})` : ''}${n > 0 ? `, so he misses about ${n} ${n === 1 ? 'game' : 'games'}` : ''}.${ctx.guessOf(p) ? ' ESPN has no firm timetable, so that date is a guess.' : ''}`);
    } else if (OUT_STATUSES.has(s)) notes.push(`${p.name} is out right now, so he adds nothing until he returns.`);
    else if (s !== 'ACTIVE') notes.push(`${p.name} is listed as ${s.replace(/_/g, ' ').toLowerCase()}.`);
  }
  return notes;
}

// Judge a trade: A gives `giveIds` and gets `getIds` from B. Returns each side's gain in points a week,
// the winner, the stars and plain-language notes.
export function evaluateTrade(ctx, teamA, teamB, giveIds, getIds) {
  const g = tradeGains(teamA.roster, teamB.roster, giveIds, getIds, ctx);
  const players = giveIds.length + getIds.length;
  const gap = g.a - g.b;
  const stars = starsFor(gap, players);
  const side = (team, rosterSize, gain) => ({ id: team.id, name: team.name, gain, rosterAfter: rosterSize, mustDrop: Math.max(0, rosterSize - ctx.rosterLimit) });
  const notes = injuryNotes(ctx, [...teamA.roster.filter((p) => giveIds.includes(p.playerId)), ...teamB.roster.filter((p) => getIds.includes(p.playerId))]);
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

// A trade between two or more teams. `teams`: [{ id, name, roster }]; `moves`: [{ playerId, from, to }] with team ids.
// Each team's gain is its change in points a week; the rating comes from the spread between the team that gains
// most and the team that gains least (for two teams that is exactly the gap used by evaluateTrade).
export function evaluateMultiTrade(ctx, teams, moves) {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const owner = new Map();
  for (const t of teams) for (const p of t.roster) owner.set(p.playerId, { team: t.id, player: p });
  const valid = moves.filter((m) => owner.get(m.playerId)?.team === m.from && byId.has(m.to) && m.to !== m.from);
  const weeks = Math.max(1, ctx.days.length / 7);
  const involved = new Set(valid.flatMap((m) => [m.from, m.to]));
  const rows = teams.map((t) => {
    const leaving = new Set(valid.filter((m) => m.from === t.id).map((m) => m.playerId));
    const arriving = valid.filter((m) => m.to === t.id).map((m) => owner.get(m.playerId).player);
    const after = [...t.roster.filter((p) => !leaving.has(p.playerId)), ...arriving];
    const gain = involved.has(t.id) ? (rosterValue(after, ctx.days, ctx) - rosterValue(t.roster, ctx.days, ctx)) / weeks : 0;
    return { id: t.id, name: t.name, gain, involved: involved.has(t.id), rosterAfter: after.length, mustDrop: Math.max(0, after.length - ctx.rosterLimit) };
  });
  const active = rows.filter((r) => r.involved);
  const hi = active.reduce((a, b) => (b.gain > a.gain ? b : a), active[0] || { gain: 0 });
  const lo = active.reduce((a, b) => (b.gain < a.gain ? b : a), active[0] || { gain: 0 });
  const spread = active.length ? hi.gain - lo.gain : 0;
  const stars = starsFor(spread, valid.length);
  return {
    teams: rows,
    spread,
    stars,
    label: verdict(stars),
    players: valid.length,
    winnerId: spread < 2 ? null : hi.id,
    loserId: spread < 2 ? null : lo.id,
    notes: injuryNotes(ctx, valid.map((m) => owner.get(m.playerId).player)),
    idle: rows.filter((r) => !r.involved).map((r) => r.id),
  };
}

// Group-chat text for a multi-way trade: who sends which players where, and how it rates.
export function multiSummary(result, moves) {
  const name = (id) => result.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
  const gain = (v) => `${v < -0.05 ? '−' : '+'}${Math.abs(v).toFixed(1)}`;
  const lines = ['Trade idea (from Punishment Watch)'];
  for (const t of result.teams.filter((r) => r.involved)) {
    const sent = moves.filter((m) => m.from === t.id);
    if (sent.length) lines.push(`${t.name} sends: ${sent.map((m) => `${m.name} to ${name(m.to)}`).join(', ')}`);
  }
  const edge = result.winnerId == null ? 'Dead even.' : `Biggest winner: ${name(result.winnerId)}. Biggest loser: ${name(result.loserId)}.`;
  lines.push(`Rating: ${result.stars} out of 5 stars, ${result.label.toLowerCase()}. ${edge}`);
  lines.push(result.teams.filter((r) => r.involved).map((t) => `${t.name} ${gain(t.gain)}`).join(', ') + ' points a week.');
  lines.push('Expected lineup points over the rest of the season; injuries can swing any trade.');
  return lines.join('\n');
}

/* ---------- What if the trade happens? ---------- */

// The league with the trade done. Players who move go on the new team's bench for today (his new manager has not
// set him in a lineup yet); points already scored this week stay with the team that scored them.
export function applyMoves(league, moves) {
  const owner = new Map();
  for (const t of league.teams) for (const p of t.roster) owner.set(p.playerId, { team: t.id, player: p });
  const valid = moves.filter((m) => owner.get(m.playerId)?.team === m.from && m.to !== m.from && league.teams.some((t) => t.id === m.to));
  const leaving = new Set(valid.map((m) => m.playerId));
  return {
    ...league,
    teams: league.teams.map((t) => ({
      ...t,
      roster: [...t.roster.filter((p) => !leaving.has(p.playerId)), ...valid.filter((m) => m.to === t.id).map((m) => ({ ...owner.get(m.playerId).player, slot: 12 }))],
    })),
  };
}

// What the odds are right now, worked out once so every trade you try only has to re-run the teams it changes.
// `input` is what buildModel takes.
export function tradeBaseline(input) {
  const { league, pro, weeks } = input;
  const before = buildModel(input);
  const week = currentWeek(weeks, league.currentSP);
  const upcoming = weeks.find((w) => w.sps[0] > week.sps.at(-1)) || null;
  const typical = upcoming ? typicalWeek(league, pro, upcoming, null, null) : null;
  return { input, before, upcoming, typical };
}

// A full week with nothing scored yet, from the best starters each team could field every day.
function typicalWeek(league, pro, upcoming, seed, reuse) {
  const rows = league.teams.map((t) => {
    // currentSP one day before the week, so every day uses the best starters rather than today's set lineup
    const p = projectTeam(t, { week: upcoming, currentSP: upcoming.sps[0] - 1, pro, now: 0, activeSlots: league.activeSlots });
    return { id: t.id, current: 0, mean: p.mean, plan: p.plan };
  });
  return simulateWeek(rows, 4000, seed, reuse);
}

// The weekly punishment odds with the trade done, next to the odds now: for this week's remaining games and for a
// typical full week from here on. Teams the trade does not touch get identical random numbers and are not re-run,
// so any change shown is from the trade, not luck.
export function simulateTrade(baseline, moves) {
  const { input, before, upcoming, typical } = baseline;
  const { league, pro } = input;
  const after = applyMoves(league, moves);
  const nameOf = (id) => league.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
  const ownerOf = (id) => league.teams.find((t) => t.id === id)?.owner ?? '';

  let thisWeek = null;
  if (before.rows.some((r) => r.gamesLeft > 0)) {
    const next = buildModel({ ...input, league: after, seed: before.simSeed, reuse: before.simCache });
    const post = new Map(next.rows.map((r) => [r.id, r]));
    thisWeek = {
      label: `Rest of week ${before.week.id}`,
      rows: before.rows.map((r) => ({ id: r.id, name: r.name, owner: r.owner, current: r.weekPts, risk0: r.odds, risk1: post.get(r.id).odds, final0: r.projFinal, final1: post.get(r.id).projFinal })),
      loser0: before.loser?.id ?? null,
      loser1: next.loser?.id ?? null,
    };
  }

  let nextWeek = null;
  if (upcoming && typical) {
    const b = typicalWeek(after, pro, upcoming, typical.seed, typical.cache);
    const top = (m) => [...m].sort((x, y) => y[1].odds - x[1].odds)[0]?.[0] ?? null;
    nextWeek = {
      label: `A typical week from here on (week ${upcoming.id})`,
      rows: league.teams.map((t) => ({ id: t.id, name: nameOf(t.id), owner: ownerOf(t.id), current: 0, risk0: typical.get(t.id).odds, risk1: b.get(t.id).odds, final0: typical.get(t.id).mean, final1: b.get(t.id).mean })),
      loser0: top(typical),
      loser1: top(b),
    };
  }
  return { thisWeek, nextWeek };
}
