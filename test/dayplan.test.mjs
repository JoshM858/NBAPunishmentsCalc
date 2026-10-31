import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injuryMap } from '../public/logic.js';
import { loadLeague } from '../public/pipeline.js';
import { autoDay, clampDay, dayBounds, nextGameSp, rosterOnDay } from '../public/dayplan.js';
import { tradeContext } from '../public/trade.js';

const pro = { spDate: new Map([[5, 1], [6, 1], [8, 1]]) };
assert.equal(nextGameSp(pro, 6), 8, 'skips a day with no games');
assert.equal(nextGameSp(pro, 8), null);
// Today until its games are done, then the next game day
assert.equal(autoDay({ cur: 6, through: 5, pro }), 6);
assert.equal(autoDay({ cur: 6, through: 6, pro }), 8, 'flips once today is concluded');
assert.equal(autoDay({ cur: 8, through: 8, pro }), 8, 'nothing later: stay put');
// Back only to yesterday, forward to the end of the season
const b = dayBounds({ cur: 6, finalSP: 170 });
assert.deepEqual(b, { min: 5, max: 170 });
assert.equal(clampDay(2, b), 5, 'cannot go back further than yesterday');
assert.equal(clampDay(6 + 7, b), 13, 'a week ahead is fine');
assert.equal(clampDay(999, b), 170);
assert.equal(dayBounds({ cur: 1, finalSP: 170 }).min, 1, 'never before the first day');

// A real roster on a real day
const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const real = fixture('real-league.json');
const src = { config: async () => ({ configured: true, season: 2027, hideTeams: ['3'] }), pro: async () => fixture('pro-2027.json'), league: async (v, { sp } = {}) => (sp ? real.days[sp] : real.league), now: () => Date.parse(real.capturedAt) };
const L = await loadLeague(src);
const ctx = tradeContext({ league: L.league, pro: L.pro, freeAgents: real.freeAgents, injuries: injuryMap(real.injuries) });
const team = L.league.teams[0];
const sp = ctx.days[3];
const r = rosterOnDay(ctx, L.pro, team, sp);
assert.equal(r.rows.length, team.roster.length);
for (const row of r.rows) {
  assert.equal(Boolean(row.game), Boolean(L.pro.games.get(row.player.proTeamId)?.has(sp)), 'a game exactly when his team plays');
  if (!row.game || row.out) assert.equal(row.expected, 0);
  else assert.ok(row.expected > 0);
}
assert.equal(r.games, r.rows.filter((x) => x.game).length);
const quiet = rosterOnDay(ctx, L.pro, team, 99999);
assert.equal(quiet.games, 0);
assert.equal(quiet.startersExpected, 0);
console.log('Day plan tests passed');
