// The player pool: ESPN's kona_player_info answer turned into small, plain player records, plus the maths the
// Players pages need (per-game lines, percentiles, form, filters, sorting). Pure, no DOM, all from real ESPN data.
import { parseEntry } from './logic.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const POS = { 1: 'PG', 2: 'SG', 3: 'SF', 4: 'PF', 5: 'C' };
const POS_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];
export const positionsOfSlots = (slots = []) => POS_ORDER.filter((_, i) => slots.includes(i));

// ESPN stat ids for season totals (verified against box scores: 0 points, 6 rebounds, 3 assists, 40 minutes, 42 games)
const TOTALS = { pts: '0', blk: '1', stl: '2', ast: '3', reb: '6', to: '11', fgm: '13', fga: '14', ftm: '15', fta: '16', tpm: '17', tpa: '18', min: '40' };

// Per-game line from a stats block of totals; null if no games.
function perGame(block) {
  const s = block?.stats;
  const gp = num(s?.['42']);
  if (!s || !gp) return null;
  const out = {};
  for (const [k, id] of Object.entries(TOTALS)) out[k] = r2(num(s[id]) / gp);
  out.fgPct = num(s['14']) ? r2(num(s['13']) / num(s['14'])) : null;
  out.ftPct = num(s['16']) ? r2(num(s['15']) / num(s['16'])) : null;
  out.tpPct = num(s['18']) ? r2(num(s['17']) / num(s['18'])) : null;
  return out;
}

const gameRow = (s, box) => {
  const t = s.stats || {};
  if (!box) return { sp: s.scoringPeriodId, pts: num(s.appliedTotal) };
  return { sp: s.scoringPeriodId, pts: num(s.appliedTotal), box: { pts: num(t['0']), reb: num(t['6']), ast: num(t['3']), stl: num(t['2']), blk: num(t['1']), to: num(t['11']), min: num(t['40']), fgm: num(t['13']), fga: num(t['14']), tpm: num(t['17']) } };
};

/**
 * One pool entry -> a slim record. `season` filters out last season's rows that ESPN mixes in.
 * Keeps only what the pages read, so a whole pool stays around 150 KB.
 */
export function parseProfile(e, season, { outlook = false, box = false } = {}) {
  const base = parseEntry(e, season);
  const p = e.player || e.playerPoolEntry?.player || {};
  const stats = (p.stats || []).filter((s) => s.seasonId == null || s.seasonId === season);
  const find = (id) => stats.find((s) => s.id === id && !(s.scoringPeriodId > 0));
  const season0 = find(`00${season}`);
  const last7 = find(`01${season}`);
  const last30 = find(`03${season}`);
  const own = p.ownership || {};
  const rating = e.ratings || {};
  const games = stats
    .filter((s) => s.scoringPeriodId > 0 && String(s.id).startsWith('05') && (s.statSourceId ?? 0) === 0)
    .map((s) => gameRow(s, box))
    .sort((a, b) => a.sp - b.sp);

  const rec = {
    id: base.playerId,
    name: base.name,
    proTeamId: base.proTeamId,
    pos: positionsOfSlots(base.eligibleSlots),
    slots: base.eligibleSlots,
    homePos: POS[p.defaultPositionId] || null,
    injury: base.injury,
    jersey: p.jersey || null,
    teamId: num(e.onTeamId), // fantasy team that owns him, 0 when he is a free agent
    status: e.status || (num(e.onTeamId) ? 'ONTEAM' : 'FREEAGENT'),
    gp: base.seasonGP,
    avg: r2(base.seasonAvg),
    total: num(season0?.appliedTotal),
    l7: r2(num(last7?.appliedAverage)),
    l15: r2(base.last15Avg),
    l30: r2(num(last30?.appliedAverage)),
    proj: r2(base.projAvg),
    own: num(own.percentOwned),
    started: num(own.percentStarted),
    adp: num(own.averageDraftPosition) || null,
    rank: rating['0']?.totalRanking || null, // ESPN sends 0 for players with no stats yet
    posRank: rating['0']?.positionalRanking || null, // ESPN sends 0 for players with no stats yet
    rank7: rating['1']?.totalRanking || null, // ESPN sends 0 for players with no stats yet
    rank30: rating['3']?.totalRanking || null, // ESPN sends 0 for players with no stats yet
    per: perGame(season0),
    games,
    newsAt: p.lastNewsDate || null,
  };
  if (outlook) rec.outlook = String(p.seasonOutlook || '');
  return rec;
}

// Last season's line from a single-player answer (the pool leaves it out): { gp, avg, per } or null
export function parseLastSeason(e, season) {
  const p = e.player || {};
  const row = (p.stats || []).find((s) => s.id === `00${season - 1}` && !(s.scoringPeriodId > 0));
  return row ? { season: season - 1, gp: num(row.stats?.['42']), avg: r2(num(row.appliedAverage)), per: perGame(row) } : null;
}

export function parsePool(raw, season, opts) {
  return (raw?.players || []).map((e) => parseProfile(e, season, opts)).filter((p) => p.id);
}

// Merge the parts the pool does not carry: who owns him (fantasy team), the injury report, bios.
export function enrich(players, { league, injuries, bios, pro }) {
  const owner = new Map();
  for (const t of league?.teams || []) for (const p of t.roster) owner.set(p.playerId, t);
  return players.map((p) => {
    const t = owner.get(p.id);
    const inj = injuries?.get(p.id);
    const bio = bios?.get(p.id);
    // A team that is not on the board (hidden) still owns its players: they are not free agents
    return {
      ...p,
      fantasyTeam: t ? { id: t.id, name: t.name } : p.teamId ? { id: p.teamId, name: 'Another team' } : null,
      free: !t && !p.teamId,
      team: pro?.abbrev?.get(p.proTeamId) || '',
      returnMs: inj?.returnMs ?? null,
      injuryDetail: inj?.detail || inj?.comment || '',
      age: bio?.age ?? null,
      height: bio?.height || null,
      weight: bio?.weight || null,
    };
  });
}

// A pool record in the shape the roster/trade/projection code expects
export const asRosterPlayer = (p) => ({
  playerId: p.id, name: p.name, proTeamId: p.proTeamId, slot: 12, injury: p.injury, seasonAvg: p.avg, seasonGP: p.gp,
  eligibleSlots: p.slots, last15Avg: p.l15, projAvg: p.proj, bySP: {},
});

/* ---------- Derived numbers (only from real stats) ---------- */

// Last five fantasy scores, oldest first
export const lastFive = (p) => p.games.slice(-5).map((g) => g.pts);

// Standard deviation of fantasy points per game: lower is steadier
export function spread(p) {
  const xs = p.games.map((g) => g.pts);
  if (xs.length < 3) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

// Form: recent average against the season average, in percent. Needs a real recent sample.
export function form(p) {
  const recent = p.l7 || p.l15;
  return p.avg && recent ? ((recent - p.avg) / p.avg) * 100 : null;
}

// Share of players (with at least `minGP` games) that this value beats, 0-100. `value` picks the number.
export function percentileOf(players, p, value, { minGP = 1 } = {}) {
  const v = value(p);
  if (v == null) return null;
  const xs = players.filter((x) => x.gp >= minGP).map(value).filter((x) => x != null);
  if (xs.length < 2) return null;
  return Math.round((100 * xs.filter((x) => x < v).length) / (xs.length - 1));
}

/* ---------- Filtering and sorting for the table ---------- */

export const SORTS = {
  name: (p) => p.name,
  pos: (p) => p.pos[0] ? POS_ORDER.indexOf(p.pos[0]) : 9,
  team: (p) => p.team,
  age: (p) => p.age,
  avg: (p) => p.avg,
  proj: (p) => p.proj,
  l5: (p) => (p.games.length ? lastFive(p).reduce((a, b) => a + b, 0) / Math.min(5, p.games.length) : null),
  l7: (p) => p.l7,
  l15: (p) => p.l15,
  l30: (p) => p.l30,
  rank: (p) => p.rank,
  own: (p) => p.own,
  gp: (p) => p.gp,
  form: (p) => form(p),
  status: (p) => (p.injury === 'ACTIVE' ? 0 : 1),
};

export function filterPlayers(players, f = {}) {
  const q = String(f.q || '').trim().toLowerCase();
  return players.filter((p) => {
    if (q && !`${p.name} ${p.team}`.toLowerCase().includes(q)) return false;
    if (f.pos && !p.pos.includes(f.pos)) return false;
    if (f.team && p.team !== f.team) return false;
    if (f.avail === 'free' && !p.free) return false;
    if (f.avail === 'owned' && p.free) return false;
    if (f.owner && p.fantasyTeam?.id !== Number(f.owner)) return false;
    if (f.health === 'healthy' && p.injury !== 'ACTIVE') return false;
    if (f.health === 'hurt' && p.injury === 'ACTIVE') return false;
    if (f.minGP && p.gp < f.minGP) return false;
    return true;
  });
}

// Sort by a key in SORTS. Missing values always sink to the bottom; `asc` puts small numbers (or A) first.
export function sortPlayers(players, key = 'avg', asc = false) {
  const get = SORTS[key] || SORTS.avg;
  return [...players].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return (asc ? c : -c) || a.name.localeCompare(b.name);
  });
}
