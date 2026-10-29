// Where data comes from: the /api routes (local server or Cloudflare Worker) or a prebuilt snapshot
// (GitHub Pages). Both give the pipeline the same interface.

// `get(path, { fresh })` returns parsed JSON or throws an Error with a plain-language message.
export function createApiSource(get) {
  return {
    kind: 'api',
    config: () => get('api/config'),
    pro: () => get('api/pro-schedule'),
    freeAgents: () => get('api/free-agents').then((b) => b.players),
    league(views, { sp, fresh, past } = {}) {
      const q = new URLSearchParams();
      for (const v of views) q.append('view', v);
      if (sp) q.set('scoringPeriodId', sp);
      if (fresh) q.set('fresh', '1');
      if (past) q.set('past', '1');
      return get(`api/league?${q}`, { fresh });
    },
    now: () => Date.now(),
  };
}

// ESPN's public scoreboard (open to browsers): which games are scheduled, in play or final on a US date.
// Returns null when it can't be reached, and the page falls back to estimating from the clock.
export async function fetchScoreboard(sp, dateKey, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateKey}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = await res.json();
    return { sp, games: (body.events || []).map((e) => ({ id: e.id, start: Date.parse(e.date), state: e.status?.type?.state, detail: e.status?.type?.detail })) };
  } catch {
    return null;
  }
}

export const SNAPSHOT_VERSION = 1;

export function createSnapshotSource(snap) {
  const generated = Date.parse(snap.generatedAt);
  return {
    kind: 'static',
    offline: true,
    generatedAt: generated,
    config: async () => snap.config,
    pro: async () => snap.pro,
    freeAgents: async () => snap.freeAgents || [],
    league: async (views, { sp } = {}) => {
      if (!sp) return snap.league;
      const day = snap.days?.[sp];
      if (!day) throw new Error(`The snapshot doesn't include day ${sp}. Run the GitHub workflow again.`);
      return day;
    },
    // Projections use the moment the snapshot was taken, so points and "games left" agree.
    now: () => generated,
    history: () => new Map(Object.entries(snap.history || {}).map(([sp, m]) => [Number(sp), new Map(Object.entries(m).map(([t, v]) => [Number(t), v]))])),
  };
}

export function checkSnapshot(snap) {
  if (!snap || typeof snap !== 'object' || snap.version !== SNAPSHOT_VERSION || !snap.league || !snap.pro || !snap.config || !Number.isFinite(Date.parse(snap.generatedAt))) {
    throw new Error('The data snapshot is missing or unreadable. Run the "Build and deploy" workflow again from the Actions tab.');
  }
  return snap;
}
