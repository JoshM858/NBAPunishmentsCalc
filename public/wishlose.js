// "I want that team to finish last": looks for trades between the beneficiary and every team except the target that
// raise the target's chance of finishing last, while the beneficiary doesn't lose points or raise their own risk.
// A trade between two other teams moves the odds because stronger rivals leave the target further behind. It builds on
// the trade finder (suggest.js) for candidate offers and re-runs the punishment odds for each (simulateTrade).
// Pure, no DOM.
import { suggestTrades } from './suggest.js';
import { simulateTrade } from './trade.js';

export const WISH = {
  perPartner: 8, // candidate offers taken from each partner
  minShift: 0.003, // the target's last-place chance must rise at least this much (0.3 of a point)
  myFloor: -1.5, // the beneficiary may lose at most this many points a week
  myRiskRise: 0.02, // and their own chance of finishing last may rise at most this much
};

// The shift in chance of finishing last for each team, from one simulateTrade result. Uses the rest of this week when
// it has games left, otherwise a typical week.
export function shifts(sim) {
  const wk = sim.thisWeek ?? sim.nextWeek;
  if (!wk) return null;
  return { label: wk.label, byTeam: new Map(wk.rows.map((r) => [r.id, { before: r.risk0, after: r.risk1, delta: r.risk1 - r.risk0 }])), loser0: wk.loser0, loser1: wk.loser1 };
}

/**
 * @param {object} o { ctx, teams, beneficiaryId, targetId, baseline: () => tradeBaseline(input), boards?, onProgress?, signal? }
 * @returns {{ ideas: [...], notes: string[], tried: number }} ideas sorted by how much they raise the target's chance of last place
 */
export async function findLoserTrades(o) {
  const { ctx, teams, beneficiaryId, targetId, baseline, boards = new Map(), onProgress = () => {}, signal = null } = o;
  const notes = [];
  if (beneficiaryId === targetId) return { ideas: [], notes: ['Pick two different teams.'], tried: 0 };
  const partners = teams.filter((t) => t.id !== beneficiaryId && t.id !== targetId);
  if (!partners.length) return { ideas: [], notes: ['There is no other team to trade with.'], tried: 0 };
  const base = baseline();
  const found = [];
  const near = []; // trades that fit the beneficiary's limits but move the target by less than minShift
  let tried = 0;
  for (const [i, t] of partners.entries()) {
    if (signal?.aborted) return { ideas: [], notes: ['Cancelled.'], tried, cancelled: true };
    onProgress({ stage: i + 1, of: partners.length, label: `Looking at trades with ${t.name}` });
    const r = await suggestTrades({ ctx, teams, meId: beneficiaryId, partnerId: t.id, boards, baseline: null, maxRisk: 1, limit: WISH.perPartner, signal });
    tried += r.tried || 0;
    for (const idea of r.ideas) {
      const s = shifts(simulateTrade(base, idea.moves));
      if (!s) continue;
      const target = s.byTeam.get(targetId);
      const me = s.byTeam.get(beneficiaryId);
      if (!target || !me) continue;
      if (idea.gains.me < WISH.myFloor || me.delta > WISH.myRiskRise) continue;
      const item = { ...idea, effect: { label: s.label, target, me, partner: s.byTeam.get(t.id), loser1: s.loser1 } };
      (target.delta >= WISH.minShift ? found : near).push(item);
    }
  }
  found.sort((a, b) => b.effect.target.delta - a.effect.target.delta || b.gains.me - a.gains.me);
  if (!found.length) {
    notes.push('No fair trade moves that team’s chance of finishing last by a meaningful amount without costing you. Their odds may already be settled (far behind or well clear), or one fair trade is simply too small to matter.');
    near.sort((a, b) => b.effect.target.delta - a.effect.target.delta);
  }
  return { ideas: found.slice(0, 8), closest: found.length ? [] : near.slice(0, 3), notes, tried };
}
