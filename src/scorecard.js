// Scores real trades after the fact: for each executed trade in the league, what the star rating would have been
// using only what was known at the time, and who has actually come out ahead since. Node only (not shipped to the
// browser). Compares the moved players only, with the same value formula and replacement level as the trade tab.
import { STARS, playerValue, starsFor, verdict } from '../public/trade.js';

const GAMES_PER_WEEK = 3.4;

// ESPN's transaction feed -> executed two-team trades. The shape (type TRADE_*, status EXECUTED, items of
// type TRADE with fromTeamId/toTeamId) is taken from ESPN's other transaction types and has not yet been seen on a
// real trade in this league, so anything unrecognised is reported rather than guessed at.
export function executedTrades(transactions) {
  const trades = [];
  const skipped = [];
  const seen = new Set();
  for (const t of transactions || []) {
    if (!/TRADE/.test(String(t.type))) continue;
    const moves = (t.items || []).filter((i) => i.type === 'TRADE' && i.playerId && i.fromTeamId != null && i.toTeamId != null);
    const executed = t.status === 'EXECUTED' || t.type === 'TRADE_ACCEPT' || t.type === 'TRADE_UPHOLD';
    if (!moves.length || !executed || t.isPending) continue;
    const key = moves.map((m) => `${m.playerId}:${m.fromTeamId}>${m.toTeamId}`).sort().join('|');
    if (seen.has(key)) continue; // the same trade is recorded again when it is upheld
    seen.add(key);
    const teams = [...new Set(moves.flatMap((m) => [m.fromTeamId, m.toTeamId]))];
    const date = t.processDate || t.proposedDate || t.executionDate || null;
    if (teams.length !== 2 || !date) {
      skipped.push({ id: t.id, reason: teams.length !== 2 ? `${teams.length}-team trade` : 'no date' });
      continue;
    }
    trades.push({ id: t.id, date, teams, moves: moves.map((m) => ({ playerId: m.playerId, from: m.fromTeamId, to: m.toTeamId })) });
  }
  return { trades, skipped };
}

// ctx.valueAt(playerId, sp) -> expected points per team game as known before day `sp`, or null.
// ctx.realized(playerId, sp) -> { pts, games } scored from day `sp` on (games = his team's games, misses count as 0 pts).
// ctx.r = replacement level in points per team game.
export function scoreTrade(trade, sp, ctx, { minGames = 5 } = {}) {
  const [a, b] = trade.teams;
  const gain = (team, value) => {
    const side = (to) => trade.moves.filter((m) => (to ? m.to : m.from) === team).reduce((s, m) => s + Math.max(0, value(m.playerId) - ctx.r), 0);
    return (side(true) - side(false)) * GAMES_PER_WEEK;
  };
  const predicted = (id) => ctx.valueAt(id, sp) ?? 0;
  let gamesSince = Infinity;
  const real = (id) => {
    const r = ctx.realized(id, sp);
    gamesSince = Math.min(gamesSince, r?.games ?? 0);
    return r && r.games ? r.pts / r.games : 0;
  };
  const players = trade.moves.length;
  const gapPred = gain(a, predicted) - gain(b, predicted);
  const gapReal = gain(a, real) - gain(b, real);
  const stars = starsFor(gapPred, players);
  const early = gamesSince < minGames;
  return {
    teams: trade.teams, players, stars, label: verdict(stars),
    predictedWinner: Math.abs(gapPred) < 2 ? null : gapPred > 0 ? a : b,
    gapPred, gapReal, gamesSince: Number.isFinite(gamesSince) ? gamesSince : 0, early,
    realWinner: early || Math.abs(gapReal) < 1 ? null : gapReal > 0 ? a : b,
  };
}

export const defaultReplacement = STARS.fallbackReplacement;
export { playerValue };
