// How have the real trades in this league worked out? Reads executed trades from ESPN, rates each one using only
// what was known on the day, and compares with what the players have actually scored since.
// Usage: npm run score-trades            (needs LEAGUE_ID in .env; cookies too for a private league)
//        npm run score-trades -- --file transactions.json   (score a saved transaction list)
import { readFileSync } from 'node:fs';
import { loadEnv } from '../src/env.js';
import { createDirectSource } from '../src/direct-source.js';
import { defaultReplacement, executedTrades, playerValue, scoreTrade } from '../src/scorecard.js';
import { parseProSchedule, spOnDate } from '../public/logic.js';

const { env } = loadEnv();
const season = Number(env.SEASON) || 2027;
const fileArg = process.argv.indexOf('--file');
const src = createDirectSource(env);

try {
  const pro = parseProSchedule(await src.pro());
  const transactions = fileArg > -1 ? JSON.parse(readFileSync(process.argv[fileArg + 1], 'utf8')).transactions : (await src.league(['mTransactions2'], { fresh: true })).transactions;
  const { trades, skipped } = executedTrades(transactions);
  if (skipped.length) console.log(`Skipped ${skipped.length} trade(s) I can't score: ${skipped.map((s) => `${s.id} (${s.reason})`).join(', ')}`);
  if (!trades.length) {
    const seen = new Set((transactions || []).map((t) => t.type));
    console.log(`No executed trades yet (${(transactions || []).length} transactions, types: ${[...seen].join(', ') || 'none'}). Run this again once ESPN records one.`);
    process.exit(0);
  }

  // Every game of every traded player this season, straight from ESPN
  const ids = [...new Set(trades.flatMap((t) => t.moves.map((m) => m.playerId)))];
  const cookie = env.ESPN_S2 && env.ESPN_SWID ? { Cookie: `espn_s2=${env.ESPN_S2}; SWID=${env.ESPN_SWID}` } : {};
  const filter = { players: { filterIds: { value: ids }, filterStatsForTopScoringPeriodIds: { value: 200, additionalValue: [`00${season}`, `10${season}`] } } };
  const res = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}/segments/0/leagues/${env.LEAGUE_ID}?view=kona_player_info`, { headers: { 'x-fantasy-filter': JSON.stringify(filter), ...cookie } });
  if (!res.ok) throw new Error(`ESPN returned ${res.status} for the player stats.`);
  const players = new Map();
  for (const e of (await res.json()).players) {
    const rows = e.player.stats.filter((s) => s.seasonId === season && s.statSplitTypeId === 5 && s.statSourceId === 0);
    players.set(e.player.id, { team: e.player.proTeamId, name: e.player.fullName, proj: e.player.stats.find((s) => s.id === `10${season}`)?.appliedAverage ?? 0, rows: rows.map((r) => ({ sp: r.scoringPeriodId, pts: r.appliedTotal || 0, played: (r.stats?.['28'] || 0) > 0 })) });
  }
  const teamGames = (team, from, to) => [...(pro.games.get(team)?.keys() || [])].filter((g) => g >= from && g < to).length;
  const nowSp = Math.max(...[...players.values()].flatMap((p) => p.rows.map((r) => r.sp)), 0) + 1;
  const ctx = {
    r: defaultReplacement,
    valueAt(id, sp) {
      const p = players.get(id);
      if (!p) return null;
      const played = p.rows.filter((r) => r.sp < sp && r.played).map((r) => r.pts);
      const avg = played.length ? played.reduce((a, b) => a + b, 0) / played.length : 0;
      return playerValue({ seasonGP: played.length, seasonAvg: avg, projAvg: p.proj }, teamGames(p.team, 1, sp)).perGame;
    },
    realized(id, sp) {
      const p = players.get(id);
      if (!p) return null;
      return { pts: p.rows.filter((r) => r.sp >= sp).reduce((s, r) => s + r.pts, 0), games: teamGames(p.team, sp, nowSp) };
    },
  };

  const teamNames = new Map((await src.league(['mTeam'])).teams.map((t) => [t.id, t.name || `Team ${t.id}`]));
  const name = (id) => teamNames.get(id) || `Team ${id}`;
  let judged = 0, right = 0;
  for (const t of trades) {
    const sp = spOnDate(pro, t.date);
    const r = scoreTrade(t, sp, ctx);
    const moved = t.moves.map((m) => `${players.get(m.playerId)?.name ?? m.playerId} to ${name(m.to)}`).join(', ');
    const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(0);
    console.log(`\nDay ${sp}: ${moved}`);
    console.log(`  rated ${r.stars} stars (${r.label}); favoured ${r.predictedWinner ? name(r.predictedWinner) : 'neither'} by ${Math.abs(r.gapPred).toFixed(0)} pts/week`);
    console.log(r.early ? `  only ${r.gamesSince} games since: too early to judge` : `  so far ${r.realWinner ? name(r.realWinner) : 'neither side'} is ahead (real gap ${fmt(r.gapReal)} pts/week over ${r.gamesSince} games)`);
    if (!r.early && r.predictedWinner && r.realWinner) { judged++; right += r.predictedWinner === r.realWinner; }
  }
  console.log(`\n${judged ? `The rated winner is the real winner in ${right} of ${judged} judged trades.` : 'Nothing is old enough to judge yet.'} (A handful of trades is far too few to say whether the stars are well calibrated; the star scale itself comes from npm run backtest:trades.)`);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
