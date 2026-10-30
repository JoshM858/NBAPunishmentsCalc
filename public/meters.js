// Two plain-language gauges on top of the weekly odds. Both are 0-100 and pure (no page code), so they are tested.
// They describe the race; they are not extra predictions. The odds themselves come from simulateWeek in logic.js.
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

// Share of the week's points the teams have already banked (0 at tip-off, 1 when every game is done).
export function bankedShare(rows) {
  const final = mean(rows.map((r) => r.projFinal));
  return final > 0 ? clamp(mean(rows.map((r) => r.weekPts)) / final) : 0;
}

// How concentrated the "who finishes last" odds are: 1 when one team has it all, 0 when it is a coin toss between everyone.
export function concentration(rows) {
  const n = rows.length;
  if (n < 2) return 1;
  const h = rows.reduce((s, r) => s - (r.odds > 0 ? r.odds * Math.log(r.odds) : 0), 0);
  return clamp(1 - h / Math.log(n));
}

// Confidence in the loser %: how settled the race is. Half is how much of the week is already banked
// (late in the week the order rarely moves), half is how lopsided the odds are.
export function confidence(model) {
  const rows = model?.rows || [];
  if (rows.length < 2) return null;
  const banked = bankedShare(rows);
  const conc = concentration(rows);
  const score = Math.round(100 * (0.5 * banked + 0.5 * conc));
  const level = score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low';
  const why = `${Math.round(banked * 100)}% of the week’s points are already scored, and the odds are ${conc >= 0.6 ? 'concentrated on one team' : conc >= 0.3 ? 'spread over a few teams' : 'spread over most of the league'}.`;
  return { score, level, banked, concentration: conc, why };
}

// The O-SHIT meter for one team: half its chance of finishing last, 30% how far behind the safest team it
// projects (in standard deviations of its own week), 20% how much of the week is already locked in.
export function oshit(row, safety, banked) {
  if (!row) return null;
  const gap = safety ? Math.max(0, safety.projFinal - row.projFinal) : 0;
  const behind = row.sd > 0 ? clamp(gap / (1.5 * row.sd)) : gap > 0 ? 1 : 0;
  const score = Math.round(100 * (0.5 * clamp(row.odds) + 0.3 * behind + 0.2 * clamp(banked) * clamp(row.odds * 2)));
  const [level, line] =
    score >= 80 ? ['O-SHIT', 'It is happening. Check the lineup and find a miracle.']
    : score >= 60 ? ['Panic', 'Deep trouble: a big night from someone is needed.']
    : score >= 40 ? ['Sweating', 'On the wrong end of the board with time left to fix it.']
    : score >= 20 ? ['Uneasy', 'Not safe yet, but not far behind.']
    : ['Chill', 'Nowhere near the bottom.'];
  return { score, level, line, gap, behind };
}
