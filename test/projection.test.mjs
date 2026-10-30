import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWeeks, currentWeek, expectedPerGame, injuryMap, parseLeague, parseProSchedule } from '../public/logic.js';
import { playerProjection, positionsOf } from '../public/projection.js';
import { tradeContext } from '../public/trade.js';

const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const real = fixture('real-league.json');
const pro = parseProSchedule(fixture('pro-2027.json'));
const league = parseLeague(real.league, 2027);
const ctx = tradeContext({ league, pro, freeAgents: real.freeAgents, injuries: injuryMap(real.injuries) });
const week = currentWeek(buildWeeks(league, pro), league.currentSP);
const now = Date.parse(real.capturedAt);
const all = league.teams.flatMap((t) => t.roster);
const find = (n) => all.find((p) => p.name.includes(n));
const proj = (p, extra = {}) => playerProjection(ctx, pro, p, { week, currentSP: league.currentSP, now, ...extra });
const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);

// positions
assert.deepEqual(positionsOf({ eligibleSlots: [4, 9, 10, 11, 12, 13] }), ['C']);
assert.deepEqual(positionsOf({ eligibleSlots: [0, 5, 8, 11] }), ['PG']);
assert.deepEqual(positionsOf({ eligibleSlots: [2, 3, 6, 7, 8, 10, 11] }), ['SF', 'PF']);
assert.deepEqual(positionsOf({}), []);

// a healthy player
const w = find('Wembanyama');
const r = proj(w);
assert.equal(r.name, w.name);
assert.equal(r.team, 'SA');
assert.deepEqual(r.positions, ['C']);
assert.equal(r.status, 'ACTIVE');
assert.equal(r.returnMs, null);
assert.deepEqual(r.season, { gp: w.seasonGP, avg: w.seasonAvg, last15: w.last15Avg, preseason: w.projAvg });
near(r.estimate.ppg, expectedPerGame(w), 1e-9, 'same estimate as the weekly model');
near(r.estimate.perGame, r.estimate.ppg * r.estimate.rate, 1e-9);
assert.ok(r.games.length === 10 && r.games.every((g, i) => i === 0 || g.date >= r.games[i - 1].date), 'ten upcoming games in order');
assert.ok(r.games.every((g) => g.date > now), 'games that have tipped off are not listed');
for (const g of r.games) {
  assert.ok(g.playChance > 0.85 && g.playChance <= 1, `a healthy player usually plays: ${g.playChance}`);
  near(g.expected, g.playChance * r.estimate.ppg, 1e-9);
  assert.match(g.opp, /^[A-Z]{2,4}$/);
  assert.equal(typeof g.home, 'boolean');
}
assert.ok(r.games[0].playChance > r.games.at(-1).playChance, 'the chance he sits creeps up the further ahead');
// this week and the next seven days are sums of the listed games
const inWeek = r.games.filter((g) => g.inWeek);
near(r.thisWeek.expected, inWeek.reduce((s, g) => s + g.expected, 0) + 0, 1e-9);
assert.equal(r.thisWeek.games, inWeek.length);
assert.ok(r.next7.games >= r.thisWeek.games - 1 && r.next7.games <= 5);
// rest of season: the trade rating's number (no replacement taken off)
assert.ok(r.restOfSeason.games > 15);
near(r.restOfSeason.expected, r.estimate.perGame * r.restOfSeason.games, 1e-6, 'play rate times games left');
near(r.restOfSeason.perWeek, r.restOfSeason.expected / (ctx.days.length / 7), 1e-9);

// home and away: Wembanyama's team (San Antonio) is at home to Minnesota first
const first = r.games[0];
assert.equal(first.opp, 'MIN');
assert.equal(first.home, true);
assert.equal(r.games.find((g) => g.opp === 'SAC')?.home, false);

// someone hurt with a return date: nothing before it, then back
const hurt = all.filter((p) => ctx.returnOf(p) != null && ctx.missed(p) > 5 && ctx.missed(p) < 18).sort((a, b) => ctx.missed(a) - ctx.missed(b))[0];
const h = proj(hurt, { games: 40 });
assert.ok(h.returnMs != null);
assert.ok(h.games.some((g) => g.out) && h.games.some((g) => !g.out), 'out for a while, then back');
const firstBack = h.games.findIndex((g) => !g.out);
assert.ok(h.games.slice(0, firstBack).every((g) => g.out && g.expected === 0 && g.playChance === 0));
assert.ok(h.games[firstBack].playChance > 0 && h.games[firstBack].playChance < 1, 'shaky in his first game back');
assert.equal(h.restOfSeason.missed, ctx.missed(hurt));
assert.ok(h.restOfSeason.expected < h.estimate.perGame * h.restOfSeason.games, 'the games he misses are not counted');
// out for the season window: zero
const gone = proj(find('Edwards'), { games: 5 });
assert.equal(gone.thisWeek.expected, 0);
assert.equal(gone.restOfSeason.expected, 0);
assert.ok(gone.games.every((g) => g.out));

// a free agent works the same way
const fa = real.freeAgents.find((p) => p.injury === 'ACTIVE');
const f = proj(fa);
assert.equal(f.name, fa.name);
assert.ok(f.games.length > 0 && f.estimate.perGame > 0);

// a game that already started is dropped
const started = proj(w, { games: 3 });
const later = playerProjection(ctx, pro, w, { week, currentSP: league.currentSP, now: started.games[0].date + 1, games: 3 });
assert.equal(later.games[0].sp === started.games[0].sp, false, 'once the game has tipped off it is not a future game');
// list size is respected
assert.equal(proj(w, { games: 3 }).games.length, 3);
assert.equal(proj(w, { games: 2 }).games.length, 2);

console.log('All projection tests passed');
