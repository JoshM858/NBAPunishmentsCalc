// The draft, from ESPN's draftDetail: every pick, a round-by-round board, and how each pick has turned out
// (the pick number against ESPN's current rank for the player). Pure, no DOM. Reading only: the draft is over
// and ESPN offers no way for other apps to draft.

export function parseDraft(raw) {
  const d = raw?.draftDetail;
  if (!d) return null;
  return {
    drafted: Boolean(d.drafted),
    inProgress: Boolean(d.inProgress),
    type: raw.settings?.draftSettings?.type || null,
    order: raw.settings?.draftSettings?.pickOrder || [],
    picks: (d.picks || []).map((p) => ({ n: p.overallPickNumber, round: p.roundId, inRound: p.roundPickNumber, teamId: p.teamId, playerId: p.playerId, keeper: Boolean(p.keeper) })).sort((a, b) => a.n - b.n),
  };
}

// Round by round, one cell per team (null where a team on the board made no pick, such as a hidden team's slot)
export function draftBoard(draft, teamIds) {
  const rounds = [...new Set(draft.picks.map((p) => p.round))].sort((a, b) => a - b);
  return rounds.map((round) => ({
    round,
    cells: teamIds.map((id) => draft.picks.find((p) => p.round === round && p.teamId === id) ?? null),
  }));
}

// Pick number minus current ESPN rank: positive means he has been worth more than where he went, negative a bust.
// Only players ESPN has ranked (they have played) count.
export function draftValue(draft, byId, teamIds) {
  const rows = draft.picks
    .filter((p) => teamIds.includes(p.teamId))
    .map((p) => {
      const pl = byId.get(p.playerId);
      return pl?.rank ? { ...p, name: pl.name, rank: pl.rank, value: p.n - pl.rank } : null;
    })
    .filter(Boolean);
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  return { steals: sorted.slice(0, 8), busts: sorted.slice(-8).reverse(), counted: rows.length };
}
