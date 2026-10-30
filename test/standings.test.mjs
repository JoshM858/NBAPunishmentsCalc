import assert from 'node:assert/strict';
import { seasonStandings } from '../public/standings.js';

const teams = [{ id: 1, name: 'A', owner: 'a' }, { id: 2, name: 'B', owner: 'b' }, { id: 3, name: 'C', owner: 'c' }];
// week 1 = days 1-2, week 2 = days 3-4, week 3 = days 5-6 (in progress on day 5)
const weeks = [{ id: 1, sps: [1, 2] }, { id: 2, sps: [3, 4] }, { id: 3, sps: [5, 6] }];
const pts = { 1: [10, 10, 5, 5, 3], 2: [8, 8, 9, 9, 6], 3: [1, 1, 20, 20, 1] };
const daily = new Map(teams.map((t) => [t.id, new Map(pts[t.id].map((v, i) => [i + 1, v]))]));
const s = seasonStandings({ teams, daily, weeks, through: 4, cur: 5 });

// Week 1: A 20, B 16, C 2 -> A wins, C is punished. Week 2: A 10, B 18, C 40 -> C wins, A is punished.
const by = Object.fromEntries(s.rows.map((r) => [r.name, r]));
assert.deepEqual(s.weeks, [1, 2]);
assert.equal(by.A.wins, 1); assert.equal(by.A.punished, 1);
assert.equal(by.B.wins, 0); assert.equal(by.B.punished, 0);
assert.equal(by.C.wins, 1); assert.equal(by.C.punished, 1);
assert.deepEqual(by.A.weeks, [{ week: 1, pts: 20, rank: 1 }, { week: 2, pts: 10, rank: 3 }]);
assert.equal(by.A.avgWeek, 15);
assert.equal(by.C.best, 40); assert.equal(by.C.worst, 2);
// Season points include today's points so far (day 5)
assert.equal(by.A.seasonPts, 33); assert.equal(by.B.seasonPts, 40); assert.equal(by.C.seasonPts, 43);
assert.deepEqual(s.rows.map((r) => r.name), ['C', 'B', 'A']);
assert.deepEqual(s.rows.map((r) => r.rank), [1, 2, 3]);
// This week so far
assert.deepEqual(by.B.thisWeek, { pts: 6, rank: 1 });
assert.deepEqual(by.A.thisWeek, { pts: 3, rank: 2 });
assert.deepEqual(by.C.thisWeek, { pts: 1, rank: 3 });

// Ties share a rank and a punishment
const tie = new Map(teams.map((t) => [t.id, new Map([[1, 5]])]));
const t = seasonStandings({ teams, daily: tie, weeks: [{ id: 1, sps: [1] }], through: 1, cur: 2 });
assert.ok(t.rows.every((r) => r.rank === 1 && r.wins === 1 && r.punished === 1));

// Nothing finished yet
const none = seasonStandings({ teams, daily: new Map(teams.map((x) => [x.id, new Map()])), weeks, through: 0, cur: 1 });
assert.deepEqual(none.weeks, []);
assert.ok(none.rows.every((r) => r.avgWeek === null && r.best === null));

console.log('Standings tests passed');
