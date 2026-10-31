// Minimal .env reader (KEY=VALUE lines) so the local server needs no dependencies.
import { readFileSync } from 'node:fs';
import { DEFAULTS } from './api.js';

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    const quoted = /^(["'])(.*)\1$/.exec(v);
    if (quoted) v = quoted[2];
    else v = v.replace(/\s+#.*$/, ''); // trailing comment on an unquoted value
    out[m[1]] = v;
  }
  return out;
}

// .env values, overridden by real environment variables (what GitHub Actions provides).
// PW_ENV_FILE points at a different file (the tests use a missing one so a developer's real .env can't leak in).
export function loadEnv(file = process.env.PW_ENV_FILE || new URL('../.env', import.meta.url)) {
  let fromFile = {};
  try {
    fromFile = parseEnv(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const keys = ['LEAGUE_ID', 'SEASON', 'ESPN_S2', 'ESPN_SWID', 'HIDE_TEAMS', 'WEEK_START', 'TIMEZONE', 'TEAM_PINS', 'SESSION_SECRET', 'REFRESH_SECONDS', 'PORT', 'HOST'];
  const env = { ...fromFile };
  for (const k of keys) if (process.env[k] !== undefined) env[k] = process.env[k];
  for (const [k, v] of Object.entries(DEFAULTS)) if (env[k] === undefined) env[k] = v; // this league, unless set
  return { env, hasFile: Object.keys(fromFile).length > 0 };
}
