// The league's transaction feed from ESPN's mTransactions2: adds, drops, waiver claims and trades, newest first.
// Lineup shuffles (type ROSTER / FUTURE_ROSTER) are noise and left out. Pure, no DOM.

const KINDS = { FREEAGENT: 'add/drop', WAIVER: 'waiver', TRADE_ACCEPT: 'trade', TRADE_PROPOSAL: 'trade proposal', TRADE_DECLINE: 'trade declined', TRADE_UPHOLD: 'trade', TRADE_VETO: 'trade vetoed', TRADE_PENDING: 'trade proposal', TRADE_ERROR: 'trade' };

export function parseActivity(raw, { teamIds } = {}) {
  const out = [];
  for (const t of raw?.transactions || []) {
    const kind = KINDS[t.type];
    if (!kind) continue;
    if (t.status && !['EXECUTED', 'PENDING', 'ACCEPTED', 'DECLINED', 'VETOED', 'UPHELD'].includes(t.status)) continue; // canceled, failed...
    const items = (t.items || []).filter((i) => ['ADD', 'DROP', 'TRADE'].includes(i.type));
    if (!items.length) continue;
    const teams = new Set([t.teamId, ...items.flatMap((i) => [i.fromTeamId, i.toTeamId])].filter(Boolean));
    if (teamIds && ![...teams].some((id) => teamIds.includes(id))) continue; // only teams on the board
    out.push({
      id: t.id,
      at: t.proposedDate,
      kind,
      type: t.type,
      status: t.status,
      teamId: t.teamId,
      items: items.map((i) => ({ type: i.type, playerId: i.playerId, from: i.fromTeamId || null, to: i.toTeamId || null })),
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

// "added X, dropped Y" style text parts for one event. `nameOf(playerId)` and `teamOf(teamId)` give display names.
export function describe(ev, { nameOf, teamOf }) {
  const adds = ev.items.filter((i) => i.type === 'ADD').map((i) => nameOf(i.playerId));
  const drops = ev.items.filter((i) => i.type === 'DROP').map((i) => nameOf(i.playerId));
  if (ev.items.some((i) => i.type === 'TRADE')) {
    const byTeam = new Map();
    for (const i of ev.items.filter((x) => x.type === 'TRADE')) {
      if (!byTeam.has(i.to)) byTeam.set(i.to, []);
      byTeam.get(i.to).push(nameOf(i.playerId));
    }
    return [...byTeam].map(([to, names]) => `${teamOf(to)} get ${names.join(', ')}`).join('; ');
  }
  return [adds.length && `added ${adds.join(', ')}`, drops.length && `dropped ${drops.join(', ')}`].filter(Boolean).join(', ');
}
