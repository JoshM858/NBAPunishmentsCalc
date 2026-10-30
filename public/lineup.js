// Lineup advice for one game day: who should start to score the most, and what changes from the lineup you have now.
// It uses the same player values as the trade rating (points a game when he plays) and the same Hungarian
// assignment as the lineup engine, so the advice agrees with the rest of the site. Pure, no DOM.
// Once a player's game has tipped off ESPN locks him where he is, so locked starters stay and locked bench
// players can't start: pass { pro, now } to account for that.
import { OUT_STATUSES, assign } from './trade.js';

const isOut = (p) => OUT_STATUSES.has(String(p.injury || '').toUpperCase());

/**
 * @param {object} ctx   tradeContext(...)
 * @param {object} team  a parsed team (roster with .slot lineup slot ids)
 * @param {number} sp    the scoring day to plan for
 * @param {object} o     { pro, now }: the parsed pro schedule and the current time (ms), to find locked players
 * @returns {{ sp, best, moves, now, bestTotal, gain, benched, locked }}
 *   best: [{ player, slotId, value }] the free choices; moves: [{ start, sit }]; now / bestTotal: expected points
 *   of the lineup as it stands and of the best one (both include locked players); locked: players already tipped off
 */
export function suggestLineup(ctx, team, sp, { pro, now: clock } = {}) {
  const tipped = (p) => {
    const g = pro?.games.get(p.proTeamId)?.get(sp);
    return Boolean(g && clock != null && g.date <= clock);
  };
  const plays = (p) => ctx.plays(p, sp);
  const inLineup = (p) => p.slot >= 0 && p.slot <= 11;
  const value = (p) => ctx.valueOf(p).perGame;
  const fit = (p) => {
    const back = ctx.returnOf(p);
    return p.slot !== 13 && !isOut(p) && (back == null || ctx.dayMs(sp) >= back);
  };

  // Locked players keep whatever they have: starters score, bench players sit
  const locked = team.roster.filter((p) => plays(p) && tipped(p));
  const lockedStarters = locked.filter((p) => inLineup(p) && fit(p));
  const lockedPoints = lockedStarters.reduce((s, p) => s + value(p), 0);
  const free = team.roster.filter((p) => plays(p) && !tipped(p) && fit(p));

  // The slots the locked starters are not using
  const slotIds = [...ctx.slotIds];
  for (const p of lockedStarters) {
    const i = slotIds.indexOf(p.slot);
    if (i >= 0) slotIds.splice(i, 1);
  }
  const options = free.map((p) => ({ p, v: value(p), slots: p.eligibleSlots?.length ? p.eligibleSlots : [11] }));
  const { pairs } = assign(options.map((o) => slotIds.map((s) => (o.slots.includes(s) ? o.v : 0))));
  const best = pairs.map(([i, j]) => ({ player: options[i].p, slotId: slotIds[j], value: options[i].v }));
  const bestSet = new Set(best.map((b) => b.player.playerId));

  // The lineup as it stands: unlocked starters who can play, plus the locked ones
  const starters = team.roster.filter((p) => inLineup(p) && plays(p) && !tipped(p));
  const nowTotal = lockedPoints + starters.filter(fit).reduce((s, p) => s + value(p), 0);
  const bestTotal = lockedPoints + best.reduce((s, b) => s + b.value, 0);

  // "Start A instead of B": the best players to start against the weakest starters who should sit. Starters with no
  // game that day can't change anything, so they are left alone.
  const starts = best.filter((b) => !starters.some((p) => p.playerId === b.player.playerId)).map((b) => b.player).sort((a, b) => value(b) - value(a));
  const sitPool = starters.filter((p) => !bestSet.has(p.playerId)).sort((a, b) => (fit(a) === fit(b) ? value(a) - value(b) : fit(a) ? 1 : -1));
  const moves = starts.map((s) => ({ start: s, sit: sitPool.shift() ?? null }));
  for (const sit of sitPool) moves.push({ start: null, sit });

  return { sp, best, moves, now: nowTotal, bestTotal, gain: Math.max(0, bestTotal - nowTotal), benched: team.roster.filter((p) => p.slot === 12 && plays(p) && !tipped(p) && !bestSet.has(p.playerId)), locked };
}
