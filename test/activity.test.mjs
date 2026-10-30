import assert from 'node:assert/strict';
import { describe, parseActivity } from '../public/activity.js';
import { draftBoard, draftValue, parseDraft } from '../public/draft.js';

// ---- activity: only real moves, newest first, only teams on the board
const raw = { transactions: [
  { id: 'a', type: 'FUTURE_ROSTER', status: 'EXECUTED', teamId: 1, proposedDate: 5, items: [{ type: 'LINEUP', playerId: 9 }] },
  { id: 'b', type: 'FREEAGENT', status: 'EXECUTED', teamId: 1, proposedDate: 10, items: [{ type: 'ADD', playerId: 7, toTeamId: 1, fromTeamId: 0 }, { type: 'DROP', playerId: 8, fromTeamId: 1, toTeamId: 0 }] },
  { id: 'c', type: 'WAIVER', status: 'CANCELED', teamId: 2, proposedDate: 20, items: [{ type: 'ADD', playerId: 7, toTeamId: 2 }] },
  { id: 'd', type: 'TRADE_ACCEPT', status: 'EXECUTED', teamId: 2, proposedDate: 30, items: [{ type: 'TRADE', playerId: 1, fromTeamId: 2, toTeamId: 4 }, { type: 'TRADE', playerId: 2, fromTeamId: 4, toTeamId: 2 }] },
  { id: 'e', type: 'FREEAGENT', status: 'EXECUTED', teamId: 3, proposedDate: 40, items: [{ type: 'ADD', playerId: 5, toTeamId: 3 }] },
] };
const ev = parseActivity(raw, { teamIds: [1, 2, 4] });
assert.deepEqual(ev.map((e) => e.id), ['d', 'b'], 'lineup moves, canceled claims and hidden teams are dropped; newest first');
assert.equal(parseActivity(raw).length, 3, 'without a team filter the hidden team shows');
assert.equal(parseActivity(null).length, 0);
const names = { 1: 'Ann', 2: 'Bob', 7: 'Cy', 8: 'Di' };
const nameOf = (id) => names[id] || `Player ${id}`;
const teamOf = (id) => ({ 2: 'Twos', 4: 'Fours' })[id] || `Team ${id}`;
assert.equal(describe(ev[1], { nameOf, teamOf }), 'added Cy, dropped Di');
assert.equal(describe(ev[0], { nameOf, teamOf }), 'Fours get Ann; Twos get Bob');

// ---- draft
const draftRaw = { settings: { draftSettings: { type: 'SNAKE', pickOrder: [1, 2] } }, draftDetail: { drafted: true, inProgress: false, picks: [
  { overallPickNumber: 2, roundId: 1, roundPickNumber: 2, teamId: 2, playerId: 20 },
  { overallPickNumber: 1, roundId: 1, roundPickNumber: 1, teamId: 1, playerId: 10 },
  { overallPickNumber: 3, roundId: 2, roundPickNumber: 1, teamId: 2, playerId: 30 },
  { overallPickNumber: 4, roundId: 2, roundPickNumber: 2, teamId: 1, playerId: 40 },
  { overallPickNumber: 5, roundId: 3, roundPickNumber: 1, teamId: 9, playerId: 50 },
] } };
const d = parseDraft(draftRaw);
assert.deepEqual(d.picks.map((p) => p.n), [1, 2, 3, 4, 5], 'sorted by pick number');
assert.equal(d.type, 'SNAKE');
const board = draftBoard(d, [1, 2]);
assert.equal(board.length, 3);
assert.deepEqual(board[0].cells.map((c) => c?.playerId), [10, 20]);
assert.deepEqual(board[2].cells, [null, null], 'a round where neither listed team picked');
const byId = new Map([[10, { name: 'A', rank: 1 }], [20, { name: 'B', rank: 60 }], [30, { name: 'C', rank: 2 }], [40, { name: 'D' }]]);
const v = draftValue(d, byId, [1, 2]);
assert.equal(v.counted, 3, 'unranked players are not counted');
assert.equal(v.steals[0].name, 'C');
assert.equal(v.steals[0].value, 1, 'pick 3 now ranked 2');
assert.equal(v.busts[0].name, 'B');
assert.equal(v.busts[0].value, -58);
assert.equal(parseDraft({}), null);

console.log('Activity and draft tests passed');
