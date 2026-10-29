// Fake league shaped like ESPN's API responses. Used for ?demo and the tests.

const SEASON = 2027;
const CURRENT_SP = 10;
const FINAL_SP = 170;
const DAY = 86_400_000;
const OPENER = Date.UTC(2026, 9, 20, 23, 30); // Tue 20 Oct 2026, 7:30pm ET

const PRO = ['ATL', 'BOS', 'NOP', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'LAC', 'LAL', 'MIA', 'MIL', 'MIN', 'BKN', 'NYK', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'OKC', 'UTA', 'WAS', 'TOR', 'MEM', 'CHA'];
const TEAMS = [
  ['Free Throw', 'Merchants', 'Liam'], ['Glass', 'Cleaners', 'Noah'], ['Tank', 'Commanders', 'Jack'],
  ['Box Out', 'Bandits', 'Oliver'], ['Fadeaway', 'Frauds', 'Ethan'], ['Air Ball', 'Society', 'Mason'],
  ['Paint', 'Protectors', 'Lucas'], ['Bench', 'Mob', 'Cooper'], ['Pick and', 'Pray', 'Hugo'], ['Load', 'Managers', 'Archie'],
];
const FIRST = ['Darnell', 'Tyrese', 'Marcus', 'Jalen', 'Andre', 'Kofi', 'Mateo', 'Luka', 'Dante', 'Isaiah', 'Theo', 'Malik', 'Rui', 'Cade', 'Bennett', 'Omari', 'Viktor', 'Jonah', 'Caleb', 'Xavier'];
const LAST = ['Whitlock', 'Okafor', 'Brennan', 'Castillo', 'Hale', 'Mbeki', 'Novak', 'Reyes', 'Sutton', 'Vance', 'Adeyemi', 'Kerr', 'Lindqvist', 'Marsh', 'Prior', 'Quinlan', 'Rook', 'Tate', 'Usher', 'Yates'];
const ACTIVE_SLOTS = [0, 1, 2, 3, 4, 5, 6, 11, 11, 11];
// Lineup slots each position may fill (ESPN ids: PG 0, SG 1, SF 2, PF 3, C 4, G 5, F 6, SG/SF 7, G/F 8, PF/C 9, F/C 10, UTIL 11, bench 12, IR 13)
const ELIGIBLE = [[0, 5, 8, 11, 12, 13], [1, 5, 7, 8, 11, 12, 13], [2, 6, 7, 8, 10, 11, 12, 13], [3, 6, 9, 10, 11, 12, 13], [4, 9, 10, 11, 12, 13]];

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDemo({ withSchedule = false } = {}) {
  const rand = rng(2027);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const half = (v) => Math.round(v * 2) / 2;
  const tip = (sp) => OPENER + (sp - 1) * DAY + (sp >= 13 ? 3_600_000 : 0); // DST ends 1 Nov
  const now = tip(CURRENT_SP) + 80 * 60_000;

  // Pro schedule
  const proGames = new Map(PRO.map((_, i) => [i + 1, {}]));
  for (let sp = 1; sp <= FINAL_SP; sp++) {
    const ids = PRO.map((_, i) => i + 1).sort(() => rand() - 0.5);
    const count = 4 + Math.floor(rand() * 5);
    for (let g = 0; g < count; g++) {
      const home = ids[g * 2];
      const away = ids[g * 2 + 1];
      const game = { id: sp * 100 + g, date: tip(sp) + [0, 0, 30, 60, 90, 180][g % 6] * 60_000, homeProTeamId: home, awayProTeamId: away, scoringPeriodId: sp };
      proGames.get(home)[sp] = [game];
      proGames.get(away)[sp] = [game];
    }
  }
  const proRaw = {
    settings: {
      proTeams: [{ id: 0, abbrev: 'FA', proGamesByScoringPeriod: {} }, ...PRO.map((abbrev, i) => ({ id: i + 1, abbrev, proGamesByScoringPeriod: proGames.get(i + 1) }))],
    },
  };

  // Players
  let pid = 1000;
  const teams = TEAMS.map(([location, nickname, owner], ti) => {
    const players = Array.from({ length: 14 }, (_, k) => {
      const mu = Math.max(12, 52 - k * 2.6 + gauss() * 5);
      return {
        id: ++pid,
        fullName: `${FIRST[(pid * 7) % FIRST.length]} ${LAST[(pid * 13) % LAST.length]}`,
        proTeamId: 1 + Math.floor(rand() * 30),
        mu,
        eligibleSlots: ELIGIBLE[pid % 5],
        injuryStatus: k === 13 ? 'OUT' : rand() < 0.06 ? 'DAY_TO_DAY' : 'ACTIVE',
        projAvg: mu * (0.85 + rand() * 0.3),
        games: {},
      };
    });
    return { id: ti + 1, location, nickname, owner, lazy: rand() * 0.3, players, slots: {}, daily: {} };
  });

  // Simulate days 1..CURRENT_SP: points + daily lineups
  for (const t of teams) {
    let prev = null;
    for (let sp = 1; sp <= CURRENT_SP; sp++) {
      const healthy = t.players.filter((p) => p.injuryStatus !== 'OUT');
      let active;
      if (prev && rand() < t.lazy) active = prev;
      else {
        const plays = (p) => Boolean(proGames.get(p.proTeamId)[sp]);
        active = [...healthy].sort((a, b) => plays(b) - plays(a) || b.mu - a.mu).slice(0, 10).map((p) => p.id);
      }
      prev = active;
      const slots = {};
      let i = 0;
      for (const p of t.players) slots[p.id] = p.injuryStatus === 'OUT' ? 13 : active.includes(p.id) ? ACTIVE_SLOTS[i++] : 12;
      t.slots[sp] = slots;

      let total = 0;
      for (const p of t.players) {
        const g = proGames.get(p.proTeamId)[sp]?.[0];
        if (!g || p.injuryStatus === 'OUT') continue;
        if (p.injuryStatus === 'DAY_TO_DAY' && rand() < 0.3) continue;
        let pts = Math.max(0, p.mu + gauss() * 0.32 * p.mu);
        if (sp === CURRENT_SP) {
          if (g.date > now) continue;
          pts *= Math.min(1, (now - g.date) / (150 * 60_000));
        }
        p.games[sp] = half(pts);
        if (slots[p.id] <= 11) total += p.games[sp];
      }
      t.daily[sp] = Math.round(total * 10) / 10;
    }
    t.points = Math.round(Object.values(t.daily).reduce((a, b) => a + b, 0) * 10) / 10;
  }

  const matchupPeriods = { 1: [1, 2, 3, 4, 5, 6] };
  for (let start = 7, id = 2; start <= FINAL_SP; start += 7, id++) {
    matchupPeriods[id] = Array.from({ length: Math.min(7, FINAL_SP - start + 1) }, (_, i) => start + i);
  }

  function playerStats(p, sp) {
    const played = Object.entries(p.games).filter(([s]) => +s < CURRENT_SP).map(([, v]) => v);
    const gp = played.length;
    const total = played.reduce((a, b) => a + b, 0);
    const stats = [
      { id: `00${SEASON}`, seasonId: SEASON, scoringPeriodId: 0, statSourceId: 0, statSplitTypeId: 0, appliedTotal: total, appliedAverage: gp ? total / gp : 0, stats: { 42: gp } },
      { id: `02${SEASON}`, seasonId: SEASON, scoringPeriodId: 0, statSourceId: 0, statSplitTypeId: 2, appliedTotal: total, appliedAverage: gp ? total / gp : 0 },
      { id: `10${SEASON}`, seasonId: SEASON, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedTotal: p.projAvg * 72, appliedAverage: p.projAvg },
    ];
    if (p.games[sp] !== undefined) {
      // Real per-game rows are keyed by ESPN game id, and last season's games come along too.
      const gameId = proGames.get(p.proTeamId)[sp][0].id;
      stats.push({ id: `05${gameId}`, seasonId: SEASON, scoringPeriodId: sp, statSourceId: 0, statSplitTypeId: 5, appliedTotal: p.games[sp] });
    }
    stats.push({ id: `054018${sp}`, seasonId: SEASON - 1, scoringPeriodId: sp, statSourceId: 0, statSplitTypeId: 5, appliedTotal: 77.7 });
    stats.push({ id: `00${SEASON - 1}`, seasonId: SEASON - 1, scoringPeriodId: 0, statSourceId: 0, statSplitTypeId: 0, appliedTotal: 3000, appliedAverage: 40, stats: { 42: 75 } });
    return stats;
  }

  function league(views, { sp } = {}) {
    const period = sp || CURRENT_SP;
    const v = new Set(views);
    const raw = {
      gameId: 1,
      id: 424242,
      seasonId: SEASON,
      scoringPeriodId: period,
      segmentId: 0,
      status: { currentMatchupPeriod: 2, firstScoringPeriod: 1, finalScoringPeriod: FINAL_SP, latestScoringPeriod: CURRENT_SP, isActive: true },
      teams: teams.map((t) => {
        const out = { id: t.id };
        if (v.has('mTeam')) {
          Object.assign(out, {
            abbrev: t.nickname.slice(0, 4).toUpperCase(),
            location: t.location,
            nickname: t.nickname,
            name: `${t.location} ${t.nickname}`,
            owners: [`{M${t.id}}`],
            points: t.points,
            record: { overall: { pointsFor: t.points, wins: 0, losses: 0, ties: 0 } },
          });
        }
        if (v.has('mRoster')) {
          const slots = t.slots[Math.min(period, CURRENT_SP)];
          out.roster = {
            entries: t.players.map((p) => ({
              playerId: p.id,
              lineupSlotId: slots[p.id],
              playerPoolEntry: { id: p.id, player: { id: p.id, fullName: p.fullName, proTeamId: p.proTeamId, injuryStatus: p.injuryStatus, eligibleSlots: p.eligibleSlots, stats: playerStats(p, period) } },
            })),
          };
        }
        return out;
      }),
    };
    if (v.has('mTeam')) raw.members = teams.map((t) => ({ id: `{M${t.id}}`, firstName: t.owner, displayName: t.owner.toLowerCase() }));
    if (v.has('mSettings')) {
      raw.settings = {
        name: 'Courtside Consequences',
        rosterSettings: { lineupSlotCounts: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 11: 3, 12: 3, 13: 1 } },
        scheduleSettings: { matchupPeriods },
        scoringSettings: { scoringType: 'TOTAL_POINTS' },
      };
    }
    raw.schedule = withSchedule
      ? teams.map((t) => ({ matchupPeriodId: 1, home: { teamId: t.id, pointsByScoringPeriod: Object.fromEntries(Object.entries(t.daily)) } }))
      : [];
    return raw;
  }

  return {
    config: async () => ({ configured: true, demo: true, leagueId: 'demo', season: SEASON }),
    league: async (views, opts) => structuredClone(league(views, opts)),
    pro: async () => structuredClone(proRaw),
    freeAgents: async () => Array.from({ length: 14 }, (_, i) => ({ playerId: 9000 + i, name: `${FIRST[i]} ${LAST[(i * 3) % LAST.length]}`, proTeamId: 1 + ((i * 7) % 30), injury: i === 2 ? 'OUT' : 'ACTIVE', seasonGP: 9, seasonAvg: 27 - i * 0.7, projAvg: 28 - i * 0.6, eligibleSlots: ELIGIBLE[i % 5] })),
    now: () => now,
    truth: { teams, CURRENT_SP },
  };
}
