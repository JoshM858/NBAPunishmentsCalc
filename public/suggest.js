// Finds trades to offer. Pure and async-friendly (it yields to the page between stages), no DOM.
//
// Brute force is out (one exact check costs ~70 ms on a full season), so it works in stages:
//   1. work out how much each candidate player adds to, or costs, each team (on a sample of days),
//   2. rank thousands of combinations from those estimates (cheap arithmetic),
//   3. check the best few exactly with the lineup engine,
//   4. re-run the punishment odds for the finalists and drop any that move a team's chance of finishing last too far.
// Both teams use the same player values, so a trade that truly helps both is rare and small: it can only come from
// lineup fit. Most good offers are "balanced" (neither side loses more than a couple of points a week).
import { rosterValue, simulateTrade, starsFor, tradeBaseline, verdict } from './trade.js';

export const FINDER = {
  balancedFloor: -1.5, // neither team may lose more than this many points a week (and at least one must gain)
  winWin: 0.05, // both teams gain at least this much to count as a win-win
  maxRisk: 0.06, // default most a team's chance of finishing last may move (6 percentage points)
  sampleEvery: 4, // stage 1 looks at every 4th remaining game day
  partnerPlayers: 12, // best this many players per partner team are considered
  verify: 36, // candidates checked exactly
  guard: 10, // finalists whose punishment odds are re-run
};

const tick = () => new Promise((r) => setTimeout(r, 0));
const subsets = (items, max) => {
  const out = items.map((x) => [x]);
  if (max >= 2) for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push([items[i], items[j]]);
  return out;
};

// ESPN lineup slot ids for the five positions, to match a team's "looking for" position
export const POSITION_SLOTS = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };

/**
 * @param {object} o
 *   ctx        tradeContext(...)
 *   teams      league.teams (with rosters)
 *   meId       the team doing the offering
 *   give       player ids on my team I would move (leave empty when `want` is given: then any of mine can be offered)
 *   want       player ids on other teams I want (optional)
 *   partnerId  only look at this team (optional)
 *   boards     Map(teamId -> { block, targets, untouchables, positions }) from the trade block (optional)
 *   baseline   () => tradeBaseline(input), for the punishment-odds guard (optional: without it the guard is skipped)
 *   maxRisk    see FINDER.maxRisk
 *   limit      how many ideas to return
 *   onProgress ({ stage, of, label }) => void
 *   signal     AbortSignal
 */
export async function suggestTrades(o) {
  const { ctx, teams, meId, give = [], want = [], partnerId = null, boards = new Map(), baseline = null, maxRisk = FINDER.maxRisk, limit = 6, onProgress = () => {}, signal = null } = o;
  const aborted = () => signal?.aborted;
  const step = async (stage, label) => {
    onProgress({ stage, of: 4, label });
    await tick();
  };
  const me = teams.find((t) => t.id === meId);
  const notes = [];
  const myBoard = boards.get(meId) || { untouchables: [] };
  const theirUntouchable = (tid) => new Set(boards.get(tid)?.untouchables || []);
  const ownerOf = new Map();
  for (const t of teams) for (const p of t.roster) ownerOf.set(p.playerId, t.id);

  // ---- who could be offered, and who could be asked for
  const myUntouchable = new Set(myBoard.untouchables || []);
  // players on injured reserve are only offered if the manager picked them
  let mine = me.roster.filter((p) => !myUntouchable.has(p.playerId) && (p.slot !== 13 || give.includes(p.playerId)));
  if (give.length) {
    const blocked = give.filter((id) => myUntouchable.has(id));
    if (blocked.length) notes.push('Some of the players you picked are on your untouchables list, so they are not offered.');
    mine = mine.filter((p) => give.includes(p.playerId));
  }
  const wanted = want.filter((id) => ownerOf.has(id) && ownerOf.get(id) !== meId);
  const wantedUntouchable = wanted.filter((id) => theirUntouchable(ownerOf.get(id)).has(id));
  if (wantedUntouchable.length) {
    const names = wantedUntouchable.map((id) => teams.find((t) => t.id === ownerOf.get(id)).roster.find((p) => p.playerId === id).name);
    return { ideas: [], notes: [`${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} on the other manager’s untouchables list, so offers for ${names.length > 1 ? 'them' : 'him'} are not suggested.`], tried: 0, blockedByUntouchable: true };
  }
  if (!mine.length) return { ideas: [], notes: [...notes, 'There are no players to offer. Pick some of yours to shop, or free some from your untouchables.'], tried: 0 };

  const partners = teams.filter((t) => t.id !== meId && (partnerId == null || t.id === partnerId) && (!wanted.length || wanted.some((id) => ownerOf.get(id) === t.id)));
  if (!partners.length) return { ideas: [], notes: [...notes, 'No other team to trade with.'], tried: 0 };

  // ---- stage 1: what each player adds to or costs each team
  await step(1, 'Working out what each player is worth to each team');
  const days = ctx.days.filter((_, i) => i % FINDER.sampleEvery === 0);
  const sample = { ...ctx, days: days.length ? days : ctx.days };
  const weeks = Math.max(1, sample.days.length / 7);
  const rv = (roster) => rosterValue(roster, sample.days, sample) / weeks;
  const without = (team, p) => team.roster.filter((q) => q.playerId !== p.playerId);
  const baseMe = rv(me.roster);
  const loseMe = new Map(mine.map((p) => [p.playerId, baseMe - rv(without(me, p))]));
  const pool = new Map(); // partner id -> candidate players (excluding their untouchables)
  for (const t of partners) {
    const locked = theirUntouchable(t.id);
    let players = t.roster.filter((p) => !locked.has(p.playerId) && p.slot !== 13);
    const mustHave = wanted.filter((id) => ownerOf.get(id) === t.id);
    players = players.map((p) => ({ p, worth: ctx.valueOf(p).perGame })).sort((a, b) => b.worth - a.worth).slice(0, FINDER.partnerPlayers).map((x) => x.p);
    for (const id of mustHave) if (!players.some((p) => p.playerId === id)) players.push(t.roster.find((p) => p.playerId === id));
    pool.set(t.id, players);
  }
  const addMe = new Map();
  const loseThem = new Map();
  const addThem = new Map();
  const baseThem = new Map();
  for (const t of partners) {
    if (aborted()) return { ideas: [], notes: [...notes, 'Cancelled.'], tried: 0, cancelled: true };
    const base = rv(t.roster);
    baseThem.set(t.id, base);
    for (const p of pool.get(t.id)) {
      addMe.set(p.playerId, rv([...me.roster, p]) - baseMe);
      loseThem.set(p.playerId, base - rv(without(t, p)));
    }
    for (const p of mine) addThem.set(`${t.id}:${p.playerId}`, rv([...t.roster, p]) - base);
    await tick();
  }

  // ---- stage 2: rank combinations from those estimates
  await step(2, 'Trying combinations');
  const candidates = [];
  let tried = 0;
  for (const t of partners) {
    const theirBoard = boards.get(t.id) || {};
    const block = new Set(theirBoard.block || []);
    const targets = new Set(theirBoard.targets || []);
    const needSlots = new Set((theirBoard.positions || []).map((pos) => POSITION_SLOTS[pos]).filter((x) => x != null));
    const mustHave = wanted.filter((id) => ownerOf.get(id) === t.id);
    const optional = pool.get(t.id).filter((p) => !mustHave.includes(p.playerId));
    // what we ask for: the wanted players alone or with one extra, or (no `want`) one or two of their players
    const asks = mustHave.length
      ? [mustHave.map((id) => t.roster.find((p) => p.playerId === id)), ...optional.map((x) => [...mustHave.map((id) => t.roster.find((p) => p.playerId === id)), x])]
      : subsets(optional, 2);
    const offers = subsets(mine, 2);
    const scored = [];
    for (const S of offers) {
      for (const H of asks) {
        tried++;
        const gainMe = H.reduce((s, p) => s + addMe.get(p.playerId), 0) - S.reduce((s, p) => s + loseMe.get(p.playerId), 0);
        const gainThem = S.reduce((s, p) => s + addThem.get(`${t.id}:${p.playerId}`), 0) - H.reduce((s, p) => s + loseThem.get(p.playerId), 0);
        if (gainMe < FINDER.balancedFloor - 1 || gainThem < FINDER.balancedFloor - 1 || Math.max(gainMe, gainThem) <= 0) continue;
        let bonus = 0;
        for (const p of H) if (block.has(p.playerId)) bonus += 1;
        for (const p of S) {
          if (targets.has(p.playerId)) bonus += 1;
          if (p.eligibleSlots?.some((s) => needSlots.has(s))) bonus += 0.5;
        }
        scored.push({ t, S, H, est: { me: gainMe, them: gainThem }, score: Math.min(gainMe, gainThem) + 0.2 * Math.max(gainMe, gainThem) + bonus });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    candidates.push(...scored.slice(0, Math.ceil(FINDER.verify * 0.6)));
    await tick();
  }
  candidates.sort((a, b) => b.score - a.score);
  const shortlist = candidates.slice(0, FINDER.verify);

  // ---- stage 3: exact check of the best
  await step(3, 'Checking the best ones against every remaining game day');
  const weeksFull = Math.max(1, ctx.days.length / 7);
  const full = (roster) => rosterValue(roster, ctx.days, ctx) / weeksFull;
  const fullBase = new Map([[meId, full(me.roster)]]);
  const verified = [];
  const missed = []; // checked exactly but one side loses too much: kept to show the closest options if nothing fits
  for (const c of shortlist) {
    if (aborted()) return { ideas: [], notes: [...notes, 'Cancelled.'], tried, cancelled: true };
    if (!fullBase.has(c.t.id)) fullBase.set(c.t.id, full(c.t.roster));
    const giveIds = new Set(c.S.map((p) => p.playerId));
    const getIds = new Set(c.H.map((p) => p.playerId));
    const gainMe = full([...me.roster.filter((p) => !giveIds.has(p.playerId)), ...c.H]) - fullBase.get(meId);
    const gainThem = full([...c.t.roster.filter((p) => !getIds.has(p.playerId)), ...c.S]) - fullBase.get(c.t.id);
    if (gainMe < FINDER.balancedFloor || gainThem < FINDER.balancedFloor || Math.max(gainMe, gainThem) <= 0) {
      missed.push({ ...c, gains: { me: gainMe, them: gainThem }, why: `${gainMe < gainThem ? 'You lose' : 'They lose'} ${Math.abs(Math.min(gainMe, gainThem)).toFixed(1)} points a week` });
      continue;
    }
    verified.push({ ...c, gains: { me: gainMe, them: gainThem }, tier: gainMe > FINDER.winWin && gainThem > FINDER.winWin ? 'win-win' : 'balanced' });
    if (verified.length % 6 === 0) await tick();
  }
  const rank = (x) => (x.tier === 'win-win' ? 1000 : 0) + Math.min(x.gains.me, x.gains.them) + 0.2 * Math.max(x.gains.me, x.gains.them) + (x.score - Math.min(x.est.me, x.est.them) - 0.2 * Math.max(x.est.me, x.est.them));
  verified.sort((a, b) => rank(b) - rank(a));

  // ---- stage 4: do the punishment odds stay put?
  await step(4, 'Checking how each trade moves the chance of finishing last');
  let finalists = verified.slice(0, FINDER.guard);
  const guarded = [];
  if (baseline) {
    const base = baseline();
    for (const c of finalists) {
      if (aborted()) return { ideas: [], notes: [...notes, 'Cancelled.'], tried, cancelled: true };
      const moves = [...c.S.map((p) => ({ playerId: p.playerId, from: meId, to: c.t.id })), ...c.H.map((p) => ({ playerId: p.playerId, from: c.t.id, to: meId }))];
      const sim = simulateTrade(base, moves);
      const move = (wk, id) => {
        const r = wk?.rows.find((x) => x.id === id);
        return r ? { before: r.risk0, after: r.risk1 } : null;
      };
      const risk = { me: { week: move(sim.thisWeek, meId), typical: move(sim.nextWeek, meId) }, them: { week: move(sim.thisWeek, c.t.id), typical: move(sim.nextWeek, c.t.id) } };
      const worst = Math.max(...[risk.me.week, risk.me.typical, risk.them.week, risk.them.typical].filter(Boolean).map((r) => Math.abs(r.after - r.before)), 0);
      if (worst <= maxRisk) guarded.push({ ...c, risk, moves });
      else missed.push({ ...c, risk, moves, why: `It moves a team’s chance of finishing last by ${Math.round(worst * 100)} points` });
      await tick();
    }
    if (finalists.length && !guarded.length) notes.push(`Every promising trade moved someone’s chance of finishing last by more than ${Math.round(maxRisk * 100)} points. The closest options are below, or raise the limit.`);
  } else guarded.push(...finalists.map((c) => ({ ...c, risk: null, moves: [...c.S.map((p) => ({ playerId: p.playerId, from: meId, to: c.t.id })), ...c.H.map((p) => ({ playerId: p.playerId, from: c.t.id, to: meId }))] })));

  const describe = (c) => {
    const theirBoard = boards.get(c.t.id) || {};
    const reasons = [];
    for (const p of c.H) if ((theirBoard.block || []).includes(p.playerId)) reasons.push(`${p.name} is on ${c.t.name}’s trade block.`);
    for (const p of c.S) {
      if ((theirBoard.targets || []).includes(p.playerId)) reasons.push(`${c.t.name} is targeting ${p.name}.`);
      const need = (theirBoard.positions || []).find((pos) => p.eligibleSlots?.includes(POSITION_SLOTS[pos]));
      if (need) reasons.push(`${c.t.name} is looking for a ${need}, and ${p.name} plays there.`);
    }
    const moves = c.moves || [...c.S.map((p) => ({ playerId: p.playerId, from: meId, to: c.t.id })), ...c.H.map((p) => ({ playerId: p.playerId, from: c.t.id, to: meId }))];
    const stars = starsFor(Math.abs(c.gains.me - c.gains.them), moves.length);
    return {
      stars,
      label: verdict(stars),
      partnerId: c.t.id,
      partnerName: c.t.name,
      give: c.S.map((p) => ({ playerId: p.playerId, name: p.name })),
      get: c.H.map((p) => ({ playerId: p.playerId, name: p.name })),
      moves,
      gains: c.gains,
      tier: c.tier ?? 'closest',
      risk: c.risk ?? null,
      why: c.why ?? null,
      reasons,
    };
  };
  const ideas = guarded.slice(0, limit).map(describe);
  // Nothing fits: show the nearest misses, each with the reason it missed
  const closest = ideas.length ? [] : [...missed].sort((a, b) => Math.min(b.gains.me, b.gains.them) - Math.min(a.gains.me, a.gains.them)).slice(0, 3).map(describe);
  return { ideas, closest, notes, tried };
}

export { tradeBaseline };
