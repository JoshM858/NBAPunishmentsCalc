import assert from 'node:assert/strict';
import { defaultReplacement, executedTrades, scoreTrade } from '../src/scorecard.js';
import { starsFor } from '../public/trade.js';

const item = (playerId, from, to) => ({ type: 'TRADE', playerId, fromTeamId: from, toTeamId: to });
const tx = (extra) => ({ id: 't1', type: 'TRADE_ACCEPT', status: 'EXECUTED', isPending: false, processDate: 1_792_000_000_000, items: [item(1, 10, 20), item(2, 20, 10)], ...extra });

// Finding executed two-team trades in the transaction feed
{
  const { trades, skipped } = executedTrades([
    tx({}),
    tx({ id: 't1-again', type: 'TRADE_UPHOLD' }), // the same trade recorded again when upheld
    tx({ id: 'proposal', type: 'TRADE_PROPOSAL', status: 'PENDING' }),
    tx({ id: 'pending', isPending: true, items: [item(5, 10, 20), item(6, 20, 10)] }),
    tx({ id: 'three', items: [item(7, 10, 20), item(8, 20, 30)] }),
    tx({ id: 'nodate', processDate: null, proposedDate: null, items: [item(9, 10, 20), item(10, 20, 10)] }),
    { id: 'add', type: 'FREEAGENT', status: 'EXECUTED', items: [{ type: 'ADD', playerId: 99, toTeamId: 10 }] },
  ]);
  assert.equal(trades.length, 1);
  assert.deepEqual(trades[0].teams.sort(), [10, 20]);
  assert.equal(trades[0].moves.length, 2);
  assert.deepEqual(skipped.map((s) => s.id).sort(), ['nodate', 'three']);
  assert.deepEqual(executedTrades(undefined), { trades: [], skipped: [] });
}

// Scoring: team 10 gives player 1 (worth 30/game) for player 2 (worth 24/game); replacement is 20
{
  const trade = { id: 'x', teams: [10, 20], moves: [{ playerId: 1, from: 10, to: 20 }, { playerId: 2, from: 20, to: 10 }] };
  const value = { 1: 30, 2: 24 };
  const ctx = (real) => ({ r: 20, valueAt: (id) => value[id], realized: (id) => ({ pts: real[id] * 10, games: 10 }) });
  // the rating says team 20 wins: it gets the better player. 10 pts/game over replacement * 3.4 games vs 4 * 3.4.
  const a = scoreTrade(trade, 5, ctx({ 1: 30, 2: 24 }));
  assert.equal(a.predictedWinner, 20);
  assert.ok(Math.abs(a.gapPred - (4 - 10) * 3.4 * 2) < 1e-9, `gap ${a.gapPred}`);
  assert.equal(a.stars, starsFor(a.gapPred, 2));
  assert.equal(a.realWinner, 20, 'and so it has turned out');
  assert.equal(a.gamesSince, 10);
  // the player rated lower has since been the better one
  const b = scoreTrade(trade, 5, ctx({ 1: 22, 2: 35 }));
  assert.equal(b.predictedWinner, 20);
  assert.equal(b.realWinner, 10, 'the rated winner is not always the real winner');
  // too early to judge: fewer than 5 games
  const early = scoreTrade(trade, 5, { ...ctx({ 1: 30, 2: 24 }), realized: () => ({ pts: 100, games: 3 }) });
  assert.equal(early.early, true);
  assert.equal(early.realWinner, null);
  // dead even
  const even = scoreTrade(trade, 5, { r: 20, valueAt: () => 25, realized: () => ({ pts: 250, games: 10 }) });
  assert.equal(even.predictedWinner, null);
  assert.equal(even.stars, 5);
  // a player we have no data for counts as worthless instead of crashing
  const unknown = scoreTrade(trade, 5, { r: 20, valueAt: (id) => (id === 1 ? 30 : null), realized: () => null });
  assert.equal(unknown.early, true);
  assert.equal(defaultReplacement, 20);
}

console.log('All scorecard tests passed');
