// One player's fantasy point projection: game by game, this week, and for the rest of the season. Pure, no DOM.
// It uses the same estimate as the trade rating (points a game when he plays, shrunk toward ESPN's preseason
// projection) and the same availability model as the weekly odds (injury status or ESPN's return date), so the
// numbers agree with the rest of the site. It does not adjust for the opponent or the pace of the game.
import { MODEL, expectedPerGame, missChance, spDay } from './logic.js';
import { OUT_STATUSES, rosterValue } from './trade.js';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
export const positionsOf = (p) => POSITIONS.filter((_, slot) => p.eligibleSlots?.includes(slot));

/**
 * @param {object} ctx   tradeContext(...)
 * @param {object} pro   parsed pro schedule
 * @param {object} p     a parsed roster/free-agent player
 * @param {object} o     { week (current week), currentSP, now (ms), games: how many upcoming games to list }
 */
export function playerProjection(ctx, pro, p, { week, currentSP, now, games = 10 }) {
  const v = ctx.valueOf(p);
  const ppg = expectedPerGame(p);
  const returnMs = ctx.returnOf(p);
  const status = String(p.injury || 'ACTIVE').toUpperCase();

  // Upcoming games with the chance he plays each, as the weekly model sees it: known out before his return date,
  // shaky just after it, otherwise a small chance of sitting that tends to repeat.
  const list = [];
  const sps = [...(pro.games.get(p.proTeamId)?.keys() || [])].filter((sp) => sp >= currentSP).sort((a, b) => a - b);
  let miss = returnMs != null ? MODEL.returnMiss : missChance(status);
  const persist = missChance(status) >= 1 && returnMs == null ? MODEL.outPersist : MODEL.persist;
  for (const sp of sps) {
    const g = pro.games.get(p.proTeamId).get(sp);
    if (g.date <= now) continue; // already tipped off: its points are in the standings
    const out = returnMs != null && spDay(pro, sp) < returnMs;
    const chance = out ? 0 : 1 - miss;
    list.push({
      sp,
      date: g.date,
      opp: pro.abbrev.get(g.opp) || `#${g.opp}`,
      home: Boolean(g.home),
      inWeek: week.sps.includes(sp),
      playChance: chance,
      expected: ppg * chance,
      out,
    });
    miss = out ? MODEL.returnMiss : miss * persist + (1 - miss) * MODEL.base;
    if (list.length >= games + 30) break;
  }
  const inWeek = list.filter((g) => g.inWeek);
  const next7 = list.filter((g) => g.date < now + 7 * 86_400_000);

  // Rest of season, the way the trade rating counts it (his usual play rate, an injured player ramping back)
  const days = ctx.days;
  const alone = { ...ctx, slotIds: [11], r: 0, item: () => ({ v: v.perGame, slots: [11], outNow: OUT_STATUSES.has(status) || p.slot === 13, outUntil: returnMs }) };
  const restPoints = rosterValue([p], days, alone);
  const gamesLeft = days.filter((d) => ctx.plays(p, d)).length;

  return {
    name: p.name,
    team: pro.abbrev.get(p.proTeamId) || '',
    positions: positionsOf(p),
    status,
    returnMs,
    returnGuess: ctx.guessOf(p),
    season: { gp: p.seasonGP || 0, avg: p.seasonAvg || 0, last15: p.last15Avg || 0, preseason: p.projAvg || 0 },
    estimate: { ppg, rate: v.rate, perGame: v.perGame },
    games: list.slice(0, games),
    thisWeek: { games: inWeek.length, expected: inWeek.reduce((s, g) => s + g.expected, 0) },
    next7: { games: next7.length, expected: next7.reduce((s, g) => s + g.expected, 0) },
    restOfSeason: { games: gamesLeft, missed: ctx.missed(p), expected: restPoints, perWeek: restPoints / Math.max(1, days.length / 7) },
  };
}
