import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injuryMap } from '../public/logic.js';
import { loadLeague } from '../public/pipeline.js';
import { WISH, findLoserTrades, shifts } from '../public/wishlose.js';
import { simulateTrade, tradeBaseline, tradeContext } from '../public/trade.js';

const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const real = fixture('real-league.json');
const src = { config: async () => ({ configured: true, season: 2027, hideTeams: ['3'] }), pro: async () => fixture('pro-2027.json'), league: async (v, { sp } = {}) => (sp ? real.days[sp] : real.league), now: () => Date.parse(real.capturedAt) };
const L = await loadLeague(src);
const ctx = tradeContext({ league: L.league, pro: L.pro, freeAgents: real.freeAgents, injuries: injuryMap(real.injuries) });
const teams = L.league.teams;
const base = tradeBaseline({ ...L, now: src.now() });
const ids = teams.map((t) => t.id);
const target = ids[ids.length - 1];
const me = 2;

const stages = [];
const r = await findLoserTrades({ ctx, teams, beneficiaryId: me, targetId: target, baseline: () => base, onProgress: (p) => stages.push(p.stage) });
assert.equal(stages.length, teams.length - 2, 'one step per partner (everyone except me and the target)');
assert.ok(r.tried > 500);
for (const i of r.ideas) {
  assert.notEqual(i.partnerId, target, 'never trades with the team that should lose');
  assert.notEqual(i.partnerId, me);
  assert.ok(i.gains.me >= WISH.myFloor, 'I do not lose more than the floor');
  assert.ok(i.effect.me.delta <= WISH.myRiskRise + 1e-12, 'my own risk does not rise much');
  assert.ok(i.effect.target.delta >= WISH.minShift - 1e-12, 'the target really is likelier to finish last');
  // the numbers shown equal an exact re-simulation of the same trade
  const again = shifts(simulateTrade(base, i.moves)).byTeam.get(target);
  assert.ok(Math.abs(again.delta - i.effect.target.delta) < 1e-12);
}
assert.ok(r.ideas.every((i, k) => !k || r.ideas[k - 1].effect.target.delta >= i.effect.target.delta - 1e-12), 'best first');
console.log(`  ${r.ideas.length} offers, best raises team ${target} by ${r.ideas[0] ? Math.round(r.ideas[0].effect.target.delta * 100) : 0} points`);

assert.deepEqual((await findLoserTrades({ ctx, teams, beneficiaryId: me, targetId: me, baseline: () => base })).ideas, []);
assert.ok(Array.isArray(r.closest));
const two = teams.filter((t) => t.id === me || t.id === target);
assert.match((await findLoserTrades({ ctx, teams: two, beneficiaryId: me, targetId: target, baseline: () => base })).notes[0], /no other team/i);
console.log('Wish-to-lose tests passed');
