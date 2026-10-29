// Makes a random 6-digit PIN for each team and prints the TEAM_PINS line to paste into Cloudflare (as a secret) or .env.
// Nothing is saved: copy what you need from the screen. Usage: npm run pins
import { randomInt } from 'node:crypto';
import { loadEnv } from '../src/env.js';
import { createDirectSource } from '../src/direct-source.js';

const { env } = loadEnv();
try {
  const raw = await createDirectSource(env).league(['mTeam'], { fresh: true });
  const hide = new Set(String(env.HIDE_TEAMS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const teams = raw.teams
    .map((t) => ({ id: t.id, name: (t.name || `${t.location ?? ''} ${t.nickname ?? ''}`).trim() || `Team ${t.id}`, abbrev: String(t.abbrev || '').toLowerCase() }))
    .filter((t) => ![String(t.id), t.abbrev, t.name.toLowerCase()].some((k) => hide.has(k)));
  const pins = teams.map((t) => ({ ...t, pin: String(randomInt(0, 1_000_000)).padStart(6, '0') }));
  console.log('Give each manager their PIN:\n');
  for (const p of pins) console.log(`  ${p.name.padEnd(32)} team ${String(p.id).padEnd(3)} PIN ${p.pin}`);
  console.log('\nThen set this as a SECRET called TEAM_PINS (Cloudflare: Settings > Variables and Secrets > Add > Secret):\n');
  console.log(`  ${pins.map((p) => `${p.id}=${p.pin}`).join(',')}\n`);
  console.log('Optional: also add a secret SESSION_SECRET with any long random text. Changing TEAM_PINS or SESSION_SECRET signs everyone out.');
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
