// Which day "My Team" shows, and what a roster looks like on a given day. Pure, no DOM.
// The day flips by itself: once today's games are all finished the page moves on to the next day with games. You can
// step forward through the season, but back only as far as the day before today.
import { OUT_STATUSES } from './trade.js';

// The next scoring day after `from` that has NBA games, or null
export function nextGameSp(pro, from, finalSP = Infinity) {
  for (let sp = from + 1; sp <= finalSP && sp < from + 40; sp++) if (pro.spDate.has(sp)) return sp;
  return null;
}

// The day to show by default: today until its games are done, then the next game day
export function autoDay({ cur, through, pro, finalSP }) {
  if (through < cur) return cur;
  return nextGameSp(pro, cur, finalSP) ?? cur;
}

// Back as far as yesterday, forward to the last day of the season
export const dayBounds = ({ cur, finalSP, firstSP = 1 }) => ({ min: Math.max(firstSP, cur - 1), max: finalSP || cur + 200 });
export const clampDay = (sp, b) => Math.min(b.max, Math.max(b.min, sp));

/**
 * The roster on day `sp`: who has a game (with opponent and tip-off), what he is expected to score and whether he is
 * out. `ctx` is tradeContext(...), `pro` the parsed schedule.
 */
export function rosterOnDay(ctx, pro, team, sp) {
  const day = ctx.dayMs(sp);
  const rows = team.roster.map((p) => {
    const g = pro.games.get(p.proTeamId)?.get(sp) || null;
    const back = ctx.returnOf(p);
    const out = OUT_STATUSES.has(String(p.injury || '').toUpperCase()) && (back == null || day < back) || (back != null && day < back);
    const expected = g && !out ? ctx.valueOf(p).perGame : 0;
    return { player: p, game: g ? { date: g.date, opp: pro.abbrev.get(g.opp) || `#${g.opp}`, home: Boolean(g.home) } : null, out: Boolean(g && out), expected };
  });
  const starters = rows.filter((r) => r.player.slot >= 0 && r.player.slot <= 11);
  return { sp, rows, startersExpected: starters.reduce((s, r) => s + r.expected, 0), playing: starters.filter((r) => r.game && !r.out).length, games: rows.filter((r) => r.game).length };
}
