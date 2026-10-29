// Checks the app against your real league: shows the shape of ESPN's JSON, rebuilds weekly points from
// every finished day, and compares with ESPN's season totals. Usage: npm run check [-- --roster]
// Needs LEAGUE_ID (and ESPN_S2 / ESPN_SWID for private leagues) in .env.
import { loadEnv } from '../src/env.js';
import { createDirectSource } from '../src/direct-source.js';
import { buildModel, parseEntry } from '../public/logic.js';
import { LIVE_VIEWS, loadLeague, loadSeasonDays } from '../public/pipeline.js';

const forceRoster = process.argv.includes('--roster');
const { env } = loadEnv();
const src = createDirectSource(env);
const line = (s = '') => console.log(s);
const fmt = (v) => Number(v).toLocaleString('en-AU', { maximumFractionDigits: 1 });

try {
  const cfg = await src.config();
  if (!cfg.configured) throw new Error('LEAGUE_ID is empty. Fill in .env first (see .env.example).');
  line(`League ${cfg.leagueId}, season ${cfg.season}, ${cfg.hasCookies ? 'with' : 'without'} cookies`);

  // What ESPN actually sends
  const raw = await src.league(LIVE_VIEWS, { fresh: true });
  const mp = raw.settings?.scheduleSettings?.matchupPeriods;
  const lens = mp ? Object.values(mp).map((v) => v.length) : [];
  const entry = raw.teams?.[0]?.roster?.entries?.[0];
  const stats = entry ? (entry.playerPoolEntry?.player?.stats || []).filter((s) => s.seasonId === cfg.season) : [];
  line('\n== Shape of ESPN’s response ==');
  line(`top-level keys: ${Object.keys(raw).join(', ')}`);
  line(`seasonId ${raw.seasonId}, current scoringPeriodId ${raw.scoringPeriodId}, status ${JSON.stringify(raw.status)}`);
  line(`scoring type: ${raw.settings?.scoringSettings?.scoringType} | league name: ${raw.settings?.name}`);
  line(`lineup slots: ${JSON.stringify(raw.settings?.rosterSettings?.lineupSlotCounts)}`);
  line(`matchup periods: ${mp ? `${lens.length} periods, lengths ${[...new Set(lens)].join('/')}, first ${JSON.stringify(Object.values(mp)[0])}` : 'none'}`);
  line(`schedule entries: ${raw.schedule?.length ?? 0}, with pointsByScoringPeriod: ${(raw.schedule || []).filter((m) => m.home?.pointsByScoringPeriod).length}`);
  line(`teams: ${raw.teams?.length}; team keys: ${Object.keys(raw.teams?.[0] || {}).join(', ')}`);
  line(`team points field: points=${raw.teams?.[0]?.points}, record.overall.pointsFor=${raw.teams?.[0]?.record?.overall?.pointsFor}`);
  if (entry) {
    line(`roster entry keys: ${Object.keys(entry).join(', ')}; lineupSlotId ${entry.lineupSlotId}`);
    line(`this season’s stat rows for ${entry.playerPoolEntry?.player?.fullName}: ${stats.map((s) => `${s.id}${s.scoringPeriodId ? `(sp${s.scoringPeriodId})` : ''}`).join(' ')}`);
    const total = stats.find((s) => String(s.id).startsWith('00'));
    line(`season row: appliedTotal ${total?.appliedTotal}, appliedAverage ${total?.appliedAverage}, GP stat[42] ${total?.stats?.['42']}`);
    line(`parsed: ${JSON.stringify({ ...parseEntry(entry, cfg.season), bySP: undefined })}`);
  }

  // The rebuild
  const ctx = await loadLeague(src, { forceRoster, fresh: true });
  line(`\n== Rebuild (${ctx.source} method; weeks from ${ctx.weeks.source}) ==`);
  const cur = ctx.league.currentSP;
  line(`current day ${cur}, ${ctx.weeks.length} weeks; this week = days ${ctx.weeks.find((w) => w.sps.includes(cur))?.sps.join(',')}`);
  const { check, shame } = await loadSeasonDays(ctx, src);
  const model = buildModel({ ...ctx, now: src.now() });
  line(`\nWeek ${model.week.id} (${model.week.label}), day ${model.week.dayNumber}/${model.week.days}`);
  for (const r of model.rows) line(`${String(r.rank).padStart(2)} ${r.name.padEnd(28)} week ${fmt(r.weekPts).padStart(8)}  today ${fmt(r.todayPts).padStart(6)}  proj ${fmt(r.projFinal).padStart(8)}`);
  line('\n== Check against ESPN season totals ==');
  for (const c of check) line(`${c.ok ? 'OK ' : 'BAD'} ${c.name.padEnd(28)} ESPN ${fmt(c.espn).padStart(9)}  rebuilt ${fmt(c.ours).padStart(9)}  (${c.basis})`);
  line(check.every((c) => c.ok) ? '\nGREEN: every team matches.' : '\nRED: some teams do not match. Try --roster, and share this output.');
  if (shame.length) line(`Finished weeks: ${shame.map((w) => `wk${w.week} last=${w.losers.map((l) => l.id)}`).join(', ')}`);
  process.exit(check.every((c) => c.ok) ? 0 : 2);
} catch (err) {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
}
