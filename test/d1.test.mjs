import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../src/api.js';

// A tiny stand-in for Cloudflare's D1 API on top of SQLite, so the same adapter code runs in the test
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  return {
    exec: async (sql) => db.exec(sql),
    prepare: (sql) => {
      const st = db.prepare(sql);
      const make = (args) => ({
        bind: (...a) => make(a),
        first: async (col) => { const r = st.get(...args); return r ? (col ? r[col] : r) : null; },
        run: async () => { st.run(...args); return {}; },
        all: async () => ({ results: st.all(...args) }),
      });
      return make([]);
    },
  };
}

const ctx = { waitUntil() {} };
const DB = fakeD1();
const env = { LEAGUE_ID: '555', SEASON: '2027', HIDE_TEAMS: '', REFRESH_SECONDS: '0', PLATFORM: 'local', DB };
const call = async (path, init, e = env) => {
  const res = await handleApi(new Request(`http://d1.test${path}`, init), e, ctx);
  return { res, body: await res.json() };
};

// Trade block through D1 (the PC version names the team in the request)
assert.equal((await call('/api/board')).body.enabled, true, 'D1 counts as storage');
const saved = await call('/api/board', { method: 'POST', body: JSON.stringify({ teamId: 3, block: [1, 2], targets: [9], untouchables: [2], positions: ['PG'], note: 'hi' }) });
assert.equal(saved.res.status, 200);
assert.deepEqual(saved.body.block, [1]);
assert.deepEqual((await call('/api/board')).body.teams[3].targets, [9], 'reads back');
await call('/api/board', { method: 'POST', headers: { 'x-real-ip': '2.2.2.2' }, body: JSON.stringify({ teamId: 3, targets: [8] }) }); // another device: the one-save-a-second limit is per device
assert.deepEqual((await call('/api/board')).body.teams[3].targets, [8], 'saving again replaces');

// The Terms record through D1: once per team and version, original time kept
const first = await call('/api/accept', { method: 'POST', body: JSON.stringify({ teamId: 3, version: 2 }) });
assert.equal(first.res.status, 200);
await new Promise((r) => setTimeout(r, 10));
const again = await call('/api/accept', { method: 'POST', body: JSON.stringify({ teamId: 3, version: 2 }) });
assert.equal(again.body.at, first.body.at);
assert.equal(Object.keys((await call('/api/accept')).body.accepted).join(), '3');

// Keys with LIKE characters never match other teams' keys
await DB.exec("INSERT INTO kv (k, v, t) VALUES ('board:5%5:1', '{}', 0), ('board:555:%', '{}', 0)");
assert.deepEqual(Object.keys((await call('/api/board')).body.teams).sort(), ['%', '3'], 'a % in another league’s key (board:5%5:1) is not treated as a wildcard');
// KV wins when both are bound
const store = new Map();
const KV = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v), list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }) };
await call('/api/board', { method: 'POST', headers: { 'x-real-ip': '3.3.3.3' }, body: JSON.stringify({ teamId: 4, block: [7] }) }, { ...env, BOARD: KV });
assert.ok([...store.keys()].some((k) => k.endsWith(':4')), 'BOARD is used when both exist');
// No storage at all: a clear message
assert.equal((await call('/api/board', { method: 'POST', headers: { 'x-real-ip': '4.4.4.4' }, body: JSON.stringify({ teamId: 3 }) }, { ...env, DB: undefined })).res.status, 503);
console.log('D1 tests passed');
