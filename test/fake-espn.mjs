// Pretends to be ESPN by answering fetch() with the demo league, so the proxy and snapshot builder
// can be tested without network access.
import { createDemo } from '../public/demo.js';

const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/';

// mode: 'ok' | 'private' (401 unless cookies sent) | { status, body, type, location } for a canned reply
export function installFakeEspn({ mode = 'ok', withSchedule = false, leagueId = '424242' } = {}) {
  const demo = createDemo({ withSchedule });
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (String(input).startsWith('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries')) {
      // One injured demo player (id 1001), out until 20 Nov, with no firm timetable
      const link = [{ rel: ['playercard', 'desktop'], href: 'https://www.espn.com/nba/player/_/id/1001/demo-player' }];
      return new Response(JSON.stringify({ injuries: [{ id: '1', displayName: 'Demo Team', injuries: [{ status: 'Out', shortComment: 'Out without a timetable for a return.', athlete: { links: link }, details: { type: 'Knee', detail: 'Sprain', returnDate: '2026-11-20' } }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(input).startsWith('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/')) {
      const abbr = url.pathname.split('/').at(-2);
      calls.push({ url: url.pathname, cookie: '' });
      if (abbr === 'zz') return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ team: { abbreviation: abbr.toUpperCase() }, athletes: [{ id: '6578', age: 34, displayHeight: "6' 8\"", displayWeight: '225 lbs', experience: { years: 14 }, jersey: '40', dateOfBirth: '1992-05-30T07:00Z', fullName: 'Not Kept' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (!String(input).startsWith(BASE)) return real(input, init);
    const cookie = init.headers?.Cookie || '';
    calls.push({ url: url.pathname + url.search, cookie, filter: init.headers?.['x-fantasy-filter'] });
    const reply = (status, body, headers = {}) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json;charset=utf-8', ...headers } });

    if (typeof mode === 'object') {
      return new Response(mode.body ?? '', { status: mode.status, headers: { 'content-type': mode.type ?? 'application/json', ...(mode.location ? { location: mode.location } : {}) } });
    }
    if (url.pathname.endsWith('/2027') && url.searchParams.get('view') === 'proTeamSchedules_wl') return reply(200, await demo.pro());
    const m = /\/segments\/0\/leagues\/(\d+)$/.exec(url.pathname);
    if (!m) return reply(404, { messages: ['Not Found'] });
    if (m[1] !== leagueId) return reply(404, { messages: ['Not Found'], details: [{ type: 'GENERAL_NOT_FOUND' }] });
    if (mode === 'private' && !cookie.includes('espn_s2=')) return reply(401, { details: [{ type: 'AUTH_LEAGUE_NOT_VISIBLE', message: 'You are not authorized to view this League.' }] });
    if (url.searchParams.get('view') === 'kona_player_info') { // free agents, in ESPN's shape
      const players = (await demo.freeAgents()).map((p) => ({ player: { id: p.playerId, fullName: p.name, proTeamId: p.proTeamId, injuryStatus: p.injury, eligibleSlots: p.eligibleSlots, stats: [{ id: '002027', appliedAverage: p.seasonAvg, stats: { 42: p.seasonGP } }, { id: '102027', appliedAverage: p.projAvg }] } }));
      return reply(200, { players });
    }
    const sp = url.searchParams.get('scoringPeriodId');
    return reply(200, await demo.league(url.searchParams.getAll('view'), { sp: sp ? Number(sp) : undefined }));
  };
  return { demo, calls, restore: () => (globalThis.fetch = real) };
}
