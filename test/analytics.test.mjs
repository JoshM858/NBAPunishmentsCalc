import assert from 'node:assert/strict';
import { marketPoints, rosterDepth, seasonRace, undervalued } from '../public/analytics.js';

const teams = [
  { id: 1, name: 'A', roster: [{ playerId: 1, name: 'a1', seasonAvg: 10 }, { playerId: 2, name: 'a2', seasonAvg: 30 }, { playerId: 3, name: 'a3', seasonAvg: 20 }] },
  { id: 2, name: 'B', roster: [{ playerId: 4, name: 'b1', seasonAvg: 50 }] },
];
const daily = new Map([[1, new Map([[1, 10], [2, 5], [4, 7], [9, 99]])], [2, new Map([[2, 4]])]]);
const race = seasonRace(teams, daily, 4);
assert.deepEqual(race[0].points, [{ x: 1, y: 10 }, { x: 2, y: 15 }, { x: 4, y: 22 }], 'cumulative, in order, stops at today');
assert.deepEqual(race[1].points, [{ x: 2, y: 4 }]);

const depth = rosterDepth(teams, new Map([[2, { name: 'Star', avg: 45 }]]), 2);
assert.deepEqual(depth.map((t) => t.name), ['A', 'B'], 'deepest first: A has 45 + 20 from its top two, B has 50');
assert.deepEqual(depth[0].parts.map((p) => [p.label, p.value]), [['Star', 45], ['a3', 20]], 'pool name and average win, top 2 only');

const players = [
  { id: 1, name: 'Star', gp: 5, own: 99, avg: 60, proTeamId: 1, free: false },
  { id: 2, name: 'Mid', gp: 5, own: 80, avg: 40, proTeamId: 1, free: false },
  { id: 3, name: 'Mid2', gp: 5, own: 70, avg: 38, proTeamId: 1, free: false },
  { id: 4, name: 'Mid3', gp: 5, own: 60, avg: 36, proTeamId: 1, free: false },
  { id: 5, name: 'Mid4', gp: 5, own: 55, avg: 34, proTeamId: 1, free: false },
  { id: 6, name: 'Gem', gp: 5, own: 10, avg: 41, proTeamId: 2, free: true },
  { id: 7, name: 'Junk', gp: 5, own: 1, avg: 12, proTeamId: 2, free: true },
  { id: 8, name: 'NoGames', gp: 0, own: 5, avg: 50, proTeamId: 2, free: true },
  { id: 9, name: 'NoTeam', gp: 5, own: 5, avg: 50, proTeamId: 0, free: true },
];
assert.deepEqual(marketPoints(players).map((p) => p.name), ['Star', 'Mid', 'Mid2', 'Mid3', 'Mid4', 'Gem', 'Junk']);
const u = undervalued(players);
assert.equal(u.median, 38);
assert.deepEqual(u.rows.map((p) => p.name), ['Gem'], 'only free agents scoring at least the median of widely-owned players');
assert.deepEqual(undervalued(players.slice(0, 3)), { median: null, rows: [] }, 'too little data to say');
console.log('Analytics tests passed');
