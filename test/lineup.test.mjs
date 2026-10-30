import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injuryMap } from '../public/logic.js';
import { loadLeague } from '../public/pipeline.js';
import { suggestLineup } from '../public/lineup.js';
import { tradeContext } from '../public/trade.js';

const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const real = fixture('real-league.json');
const src = { config: async () => ({ configured: true, season: 2027, hideTeams: ['3'] }), pro: async () => fixture('pro-2027.json'), league: async (v, { sp } = {}) => (sp ? real.days[sp] : real.league), now: () => Date.parse(real.capturedAt) };
const L = await loadLeague(src);
const ctx = tradeContext({ league: L.league, pro: L.pro, freeAgents: real.freeAgents, injuries: injuryMap(real.injuries) });
const sp = ctx.days[0];

for (const team of L.league.teams) {
  const r = suggestLineup(ctx, team, sp, { pro: L.pro, now: src.now() });
  // Never more starters than slots, nobody twice, nobody without a game, never an injured-out or IR player
  assert.ok(r.best.length <= ctx.slotIds.length);
  assert.equal(new Set(r.best.map((b) => b.player.playerId)).size, r.best.length);
  for (const b of r.best) {
    assert.ok(ctx.plays(b.player, sp), `${b.player.name} has a game`);
    assert.ok(b.player.eligibleSlots.includes(b.slotId), `${b.player.name} can play slot ${b.slotId}`);
    assert.notEqual(b.player.slot, 13, 'IR players do not start');
  }
  // The suggestion is never worse than the current lineup, and the gain adds up
  assert.ok(r.bestTotal + 1e-9 >= r.now, `${team.name}: best ${r.bestTotal} vs now ${r.now}`);
  assert.ok(Math.abs(r.gain - (r.bestTotal - r.now)) < 1e-6);
  // Every move names real players from this roster
  for (const m of r.moves) for (const p of [m.start, m.sit].filter(Boolean)) assert.ok(team.roster.some((q) => q.playerId === p.playerId));
}

// A deliberately bad lineup: bench the best player and start the worst; the advice must fix it
const team = structuredClone(L.league.teams[0]);
const byValue = [...team.roster].filter((p) => ctx.plays(p, sp) && p.slot !== 13).sort((a, b) => ctx.valueOf(b).perGame - ctx.valueOf(a).perGame);
const star = byValue[0];
const scrub = byValue.at(-1);
const sStar = team.roster.find((p) => p.playerId === star.playerId);
const sScrub = team.roster.find((p) => p.playerId === scrub.playerId);
sStar.slot = 12;
sScrub.slot = 11;
const bad = suggestLineup(ctx, team, sp, { pro: L.pro, now: src.now() });
assert.ok(bad.gain > 0, 'benching the star costs points');
assert.ok(bad.moves.some((m) => m.start?.playerId === star.playerId), 'the star is told to start');
// the scrub sits unless he is needed to fill a slot on a day with few games
if (!bad.best.some((b) => b.player.playerId === scrub.playerId)) assert.ok(bad.moves.some((m) => m.sit?.playerId === scrub.playerId), 'and the scrub to sit');
// Players whose game has already tipped off are locked: never told to start or sit, and they still score
const today = L.league.currentSP;
const late = Math.max(...[...L.pro.games.values()].map((g) => g.get(today)?.date ?? 0)) + 1; // after every game started
let sawLock = false;
for (const t of L.league.teams) {
  const r = suggestLineup(ctx, t, today, { pro: L.pro, now: late });
  const lockedIds = new Set(r.locked.map((p) => p.playerId));
  if (lockedIds.size) sawLock = true;
  assert.ok(r.moves.every((m) => !lockedIds.has(m.start?.playerId) && !lockedIds.has(m.sit?.playerId)), 'locked players are left alone');
  assert.ok(r.best.every((b) => !lockedIds.has(b.player.playerId)));
  assert.equal(r.gain, 0, 'nothing can change once every game has started');
  assert.ok(Math.abs(r.now - r.bestTotal) < 1e-9);
}
assert.ok(sawLock, 'some game had tipped off');
console.log('Lineup tests passed');
