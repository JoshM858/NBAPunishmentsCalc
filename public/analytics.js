// Numbers behind the Analytics charts. Pure, no DOM; every value comes from the league's own data.

// Cumulative season points per team by scoring day: { id, name, points: [{ x: sp, y: points so far }] }
export function seasonRace(teams, daily, cur) {
  return teams.map((t) => {
    let sum = 0;
    const points = [];
    for (const sp of [...(daily.get(t.id)?.keys() || [])].filter((d) => d <= cur).sort((a, b) => a - b)) {
      sum += daily.get(t.id).get(sp);
      points.push({ x: sp, y: Math.round(sum * 10) / 10 });
    }
    return { id: t.id, name: t.name, points };
  });
}

// The top `n` players of each team by points per game (from the pool, or the roster when a player is missing):
// how much a team's strength rests on a few stars. Sorted deepest first.
export function rosterDepth(teams, byId, n = 10) {
  return teams
    .map((t) => ({
      id: t.id,
      name: t.name,
      parts: t.roster
        .map((p) => ({ label: byId?.get(p.playerId)?.name || p.name, value: byId?.get(p.playerId)?.avg ?? p.seasonAvg ?? 0 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, n),
    }))
    .sort((a, b) => b.parts.reduce((s, p) => s + p.value, 0) - a.parts.reduce((s, p) => s + p.value, 0));
}

// Points per game against how widely a player is owned. Players who score a lot but few leagues roster are the
// interesting ones. Only players with `minGP` games, a real team and at least `minAvg` points a game (so the chart isn't a pile of bench players).
export function marketPoints(players, { minGP = 2, minAvg = 10 } = {}) {
  return players
    .filter((p) => p.gp >= minGP && p.proTeamId && p.avg >= minAvg)
    .map((p) => ({ id: p.id, name: p.name, x: p.own, y: p.avg, free: Boolean(p.free) }));
}

// Free agents that score like widely-owned players: points per game above the median of players owned by at
// least `ownedAbove` percent of leagues, but owned by fewer than `ownedBelow`.
export function undervalued(players, { ownedAbove = 50, ownedBelow = 40, minGP = 3, limit = 8 } = {}) {
  const base = players.filter((p) => p.gp >= minGP && p.own >= ownedAbove).map((p) => p.avg).sort((a, b) => a - b);
  if (base.length < 5) return { median: null, rows: [] };
  const median = base[Math.floor(base.length / 2)];
  const rows = players.filter((p) => p.free && p.gp >= minGP && p.own < ownedBelow && p.avg >= median && p.proTeamId).sort((a, b) => b.avg - a.avg).slice(0, limit);
  return { median, rows };
}
