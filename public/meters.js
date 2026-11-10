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

// The O-SHIT meter for one team: how worried it should be right now = its chance of finishing last x how certain that
// chance is. Early in a week a 70% chance is only a guess, so the meter stays low; late in the week, with the team
// already well behind, the same chance means it is basically decided. Certainty is 60% how much of the week is done
// (nothing until 15% is scored, full at 85%) and 40% how far the team is already behind the next-worst team on
// points actually scored, measured against how much the rest of the week can still swing.
export const OSHIT_LEVELS = [
  [85, 'Locked in', 'The punishment is as good as booked.'],
  [70, 'Code red', 'It is nearly settled and not in your favour.'],
  [55, 'Panic stations', 'Well behind with little time left to fix it.'],
  [40, 'Sweating', 'A bad spot and the week is moving on.'],
  [25, 'Getting twitchy', 'On the wrong end, but it is not decided.'],
  [10, 'Relaxed', 'Not likely, or far too early to say.'],
  [0, 'Cruising', 'Nothing to worry about.'],
];

export function oshit(row, rows) {
  if (!row) return null;
  const banked = bankedShare(rows);
  const others = rows.filter((r) => r.id !== row.id);
  const time = clamp((banked - 0.15) / 0.7);
  const behind = others.length ? Math.min(...others.map((r) => r.weekPts)) - row.weekPts : 0; // > 0: this team is last right now by this much
  const swing = row.sd > 0 ? 1.5 * row.sd : 1;
  const lock = clamp(behind / swing);
  const certainty = clamp(0.6 * time + 0.4 * lock);
  const odds = clamp(row.odds);
  const score = Math.round(100 * odds * certainty);
  const [, level, line] = OSHIT_LEVELS.find(([min]) => score >= min);
  return { score, level, line, odds, certainty, time, lock };
}
