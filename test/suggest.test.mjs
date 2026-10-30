import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injuryMap } from '../public/logic.js';
import { loadLeague } from '../public/pipeline.js';
import { FINDER, suggestTrades } from '../public/suggest.js';
import { evaluateMultiTrade, tradeBaseline, tradeContext } from '../public/trade.js';

const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const real = fixture('real-league.json');
const proRaw = fixture('pro-2027.json');
const src = { config: async () => ({ configured: true, season: 2027, hideTeams: ['3'] }), pro: async () => proRaw, league: async (v, { sp } = {}) => (sp ? real.days[sp] : real.league), now: () => Date.parse(real.capturedAt) };
const L = await loadLeague(src);
const input = { ...L, now: src.now() };
const ctx = tradeContext({ league: L.league, pro: L.pro, freeAgents: real.freeAgents, injuries: injuryMap(real.injuries) });
const teams = L.league.teams;
const me = teams.find((t) => t.id === 2);
const idOf = (name, team = me) => team.roster.find((p) => p.name.includes(name)).playerId;
const give = ['Curry', 'Giddey', 'Wagner', 'Murphy', 'Boozer', 'Queen'].map((n) => idOf(n));
let base = null;
const baseline = () => (base ||= tradeBaseline(input));
const run = (extra = {}) => suggestTrades({ ctx, teams, meId: 2, give, baseline, ...extra });
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);

// ---- the basics: ideas are real, exact and follow the rules
const stages = [];
const r = await run({ onProgress: (p) => stages.push(p.stage) });
assert.deepEqual([...new Set(stages)], [1, 2, 3, 4], 'progress is reported stage by stage');
assert.ok(r.tried > 1000, `tried ${r.tried} combinations`);
assert.ok(r.ideas.length >= 2, 'finds offers');
for (const i of r.ideas) {
  const partner = teams.find((t) => t.id === i.partnerId);
  assert.ok(i.give.every((p) => give.includes(p.playerId)), 'only players I asked to shop are offered');
  assert.ok(i.get.every((p) => partner.roster.some((q) => q.playerId === p.playerId)), 'and they come from the partner’s roster');
  assert.ok(i.give.length <= 2 && i.get.length <= 2);
  // the gains shown equal an exact evaluation of the same trade
  const exact = evaluateMultiTrade(ctx, [me, partner], i.moves);
  near(exact.teams[0].gain, i.gains.me, 1e-6, 'my gain is exact');
  near(exact.teams[1].gain, i.gains.them, 1e-6, 'their gain is exact');
  assert.ok(i.gains.me >= FINDER.balancedFloor && i.gains.them >= FINDER.balancedFloor, 'neither side loses more than the floor');
  assert.ok(Math.max(i.gains.me, i.gains.them) > 0, 'someone actually gains');
  assert.equal(i.tier, i.gains.me > FINDER.winWin && i.gains.them > FINDER.winWin ? 'win-win' : 'balanced');
  assert.ok(i.stars >= 0.5 && i.stars <= 5 && i.label);
  // the odds guard ran, and the trade stays inside it for both teams, this week and in a typical week
  for (const side of [i.risk.me, i.risk.them]) for (const k of ['week', 'typical']) if (side[k]) assert.ok(Math.abs(side[k].after - side[k].before) <= FINDER.maxRisk + 1e-9, `${k} risk moved ${side[k].after - side[k].before}`);
}
assert.ok(r.ideas.some((i) => i.tier === 'win-win'), 'at least one genuine win-win (a two-for-one that fits both lineups)');
const order = r.ideas.map((i) => (i.tier === 'win-win' ? 1 : 0));
assert.deepEqual(order, [...order].sort((a, b) => b - a), 'win-wins come first');
assert.deepEqual((await run()).ideas.map((i) => i.moves), r.ideas.map((i) => i.moves), 'same inputs, same answer');

// ---- restricting the search
const pid = r.ideas[0].partnerId;
const one = await run({ partnerId: pid });
assert.ok(one.ideas.length && one.ideas.every((i) => i.partnerId === pid), 'one partner only');
const giddey = await run({ give: [idOf('Giddey')] });
assert.ok(giddey.ideas.concat(giddey.closest).every((i) => i.give.length === 1 && i.give[0].name.includes('Giddey')));
assert.equal((await run({ give: [] })).tried > 0, true, 'no give list means any of my players can be offered');

// ---- wanting a particular player
let tgt = null;
let wanted = null;
for (const cand of teams.filter((t) => t.id !== 2).flatMap((t) => t.roster.filter((p) => p.slot <= 11).slice(0, 4))) {
  const out = await run({ give: [], want: [cand.playerId] });
  if (out.ideas.length + out.closest.length) { tgt = cand; wanted = out; break; }
}
assert.ok(tgt, 'some player on another team can be asked for');
const tgtTeam = teams.find((t) => t.roster.some((p) => p.playerId === tgt.playerId));
for (const i of [...wanted.ideas, ...wanted.closest]) {
  assert.equal(i.partnerId, tgtTeam.id, 'only his team is asked');
  assert.ok(i.get.some((p) => p.playerId === tgt.playerId), 'the player I want is always in the offer');
  assert.ok(i.give.length >= 1);
}

// ---- the trade block: untouchables, block, targets, positions
const boards = new Map([[2, { untouchables: [idOf('Curry'), idOf('Giddey')] }]]);
const noMine = await run({ boards });
assert.ok(noMine.notes.some((n) => /untouchables/.test(n)));
for (const i of [...noMine.ideas, ...noMine.closest]) assert.ok(!i.give.some((p) => /Curry|Giddey/.test(p.name)), 'my untouchables are never offered');
const first = r.ideas[0];
const theirs = teams.find((t) => t.id === first.partnerId);
const locked = new Map([[first.partnerId, { untouchables: first.get.map((p) => p.playerId) }]]);
const afterLock = await run({ boards: locked, partnerId: first.partnerId });
for (const i of [...afterLock.ideas, ...afterLock.closest]) assert.ok(!i.get.some((p) => first.get.some((q) => q.playerId === p.playerId)), 'their untouchables are never asked for');
// asking for someone who is untouchable says so instead of suggesting anything
const refused = await run({ give: [], want: [tgt.playerId], boards: new Map([[tgtTeam.id, { untouchables: [tgt.playerId] }]]) });
assert.equal(refused.blockedByUntouchable, true);
assert.deepEqual(refused.ideas, []);
assert.match(refused.notes[0], /untouchables list/);
// a player on their trade block, or a target of theirs, is mentioned and ranks up
const askedFor = first.get[0];
const blocked = await run({ boards: new Map([[first.partnerId, { block: [askedFor.playerId] }]]), partnerId: first.partnerId });
const hit = blocked.ideas.find((i) => i.get.some((p) => p.playerId === askedFor.playerId));
if (hit) assert.ok(hit.reasons.some((x) => x.includes(askedFor.name) && /trade block/.test(x)));
const targeted = await run({ boards: new Map([[first.partnerId, { targets: [first.give[0].playerId] }]]), partnerId: first.partnerId });
const hit2 = targeted.ideas.find((i) => i.give.some((p) => p.playerId === first.give[0].playerId));
if (hit2) assert.ok(hit2.reasons.some((x) => /is targeting/.test(x)));
// a position they are looking for matches players who play it
const wantsC = await run({ boards: new Map([[first.partnerId, { positions: ['C'] }]]), partnerId: first.partnerId });
for (const i of wantsC.ideas) for (const x of i.reasons.filter((q) => /looking for a C/.test(q))) assert.ok(i.give.some((p) => teams.find((t) => t.id === 2).roster.find((q) => q.playerId === p.playerId).eligibleSlots.includes(4)), x);

// ---- the punishment-odds guard
const tight = await run({ maxRisk: 0.0001 });
assert.equal(tight.ideas.length, 0, 'a near-zero limit rejects everything that moves the odds at all');
assert.ok(tight.closest.length > 0 && tight.closest.every((i) => /chance of finishing last|loses?/.test(i.why)), 'and the nearest misses say why');
assert.match(tight.notes.join(' '), /closest options/);
const noGuard = await suggestTrades({ ctx, teams, meId: 2, give });
assert.ok(noGuard.ideas.length > 0 && noGuard.ideas.every((i) => i.risk === null), 'without a baseline the guard is skipped');

// ---- edge cases
const stop = new AbortController();
stop.abort();
const cancelled = await run({ signal: stop.signal });
assert.equal(cancelled.cancelled, true);
assert.deepEqual(cancelled.ideas, []);
assert.match((await run({ partnerId: 999 })).notes.join(' '), /No other team/);
assert.ok((await suggestTrades({ ctx, teams, meId: 2, give: [], boards: new Map([[2, { untouchables: me.roster.map((p) => p.playerId) }]]) })).notes.some((n) => /no players to offer/i.test(n)), 'everyone untouchable: nothing to offer');
for (const i of (await run({ limit: 2 })).ideas) assert.ok(i);
assert.ok((await run({ limit: 2 })).ideas.length <= 2);

console.log('All suggestion tests passed');
