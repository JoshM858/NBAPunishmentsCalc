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
    if (!String(input).startsWith(BASE)) return real(input, init);
    const cookie = init.headers?.Cookie || '';
    calls.push({ url: url.pathname + url.search, cookie });
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
    const sp = url.searchParams.get('scoringPeriodId');
    return reply(200, await demo.league(url.searchParams.getAll('view'), { sp: sp ? Number(sp) : undefined }));
  };
  return { demo, calls, restore: () => (globalThis.fetch = real) };
}
