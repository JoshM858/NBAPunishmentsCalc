// The NBA schedule through the fantasy lens: which games are on each day, and how many of a team's players have a
// game each day. Pure, no DOM.

// Every game on a scoring day: [{ home, away, date }] (team abbreviations), in tip-off order
export function gamesOn(pro, sp) {
  const seen = new Set();
  const out = [];
  for (const [teamId, days] of pro.games) {
    const g = days.get(sp);
    if (!g || !g.home) continue; // list each game once, from the home side
    const key = `${teamId}-${g.opp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ home: pro.abbrev.get(teamId) || `#${teamId}`, away: pro.abbrev.get(g.opp) || `#${g.opp}`, date: g.date });
  }
  return out.sort((a, b) => a.date - b.date || a.home.localeCompare(b.home));
}

// For each fantasy team, how many players (not on injured reserve) have a game on each of `sps`.
// Returns [{ id, name, perDay: [n...], total, best: index of the busiest day }]
export function playersPerDay(teams, pro, sps) {
  return teams.map((t) => {
    const perDay = sps.map((sp) => t.roster.filter((p) => p.slot !== 13 && pro.games.get(p.proTeamId)?.has(sp)).length);
    return { id: t.id, name: t.name, perDay, total: perDay.reduce((a, b) => a + b, 0), best: perDay.indexOf(Math.max(...perDay)) };
  });
}
