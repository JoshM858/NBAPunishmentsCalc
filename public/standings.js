// Season standings for a league that scores total points and has a punishment each week: season points, weeks won,
// weeks finished last, best and worst week, and every week's points and rank. Pure, no DOM.
// (ESPN reports no wins, losses or points against for this league type, so none are shown.)
import { standings } from './logic.js';

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * @param {object} o { teams, daily, weeks, through, cur }
 *   daily: Map(teamId -> Map(sp -> points)); weeks: [{ id, sps }]; through: last finished scoring day; cur: today's day
 */
export function seasonStandings({ teams, daily, weeks, through, cur }) {
  const finished = weeks.filter((w) => w.sps.at(-1) <= through && w.sps.some((sp) => teams.some((t) => daily.get(t.id)?.has(sp))));
  const history = finished.map((w) => ({ week: w.id, table: standings(teams, daily, w.sps) }));
  const now = weeks.find((w) => w.sps.includes(cur));
  const nowTable = now ? standings(teams, daily, now.sps, cur) : null;

  const rows = teams.map((t) => {
    const weeksPts = history.map((h) => ({ week: h.week, pts: h.table.get(t.id).pts, rank: h.table.get(t.id).rank }));
    let season = 0;
    for (const [sp, pts] of daily.get(t.id) || []) if (sp <= cur) season += pts;
    const played = weeksPts.map((w) => w.pts);
    const bottom = (h) => [...h.table.values()].reduce((m, r) => Math.max(m, r.rank), 0);
    return {
      id: t.id,
      name: t.name,
      owner: t.owner,
      seasonPts: r1(season),
      weeks: weeksPts,
      played: played.length,
      avgWeek: played.length ? r1(played.reduce((a, b) => a + b, 0) / played.length) : null,
      wins: history.filter((h) => h.table.get(t.id).rank === 1).length,
      punished: history.filter((h) => h.table.get(t.id).rank === bottom(h)).length,
      best: played.length ? Math.max(...played) : null,
      worst: played.length ? Math.min(...played) : null,
      thisWeek: nowTable ? { pts: nowTable.get(t.id).pts, rank: nowTable.get(t.id).rank } : null,
    };
  });
  rows.sort((a, b) => b.seasonPts - a.seasonPts || a.name.localeCompare(b.name));
  rows.forEach((r, i) => (r.rank = i > 0 && r.seasonPts === rows[i - 1].seasonPts ? rows[i - 1].rank : i + 1));
  return { rows, weeks: history.map((h) => h.week) };
}
