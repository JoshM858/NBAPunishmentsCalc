// The Terms and Conditions gate. You must pick your team (with your PIN if PINs are on) and answer "Do you accept?".
// Accepting is written to the server's record (append-only, with the time, so nobody can back out) and cannot be
// undone from the site. There is no decline or close button. Without server storage (GitHub Pages) it falls back to
// a flag in this browser.
import { openLegal } from './legal.js';
import { esc } from './dom.js';
import { focusPin, signInClick, signInHtml, signInSubmit } from './signin.js';

const KEY = 'pw:agreed';
const local = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const setLocal = (teamId) => { try { localStorage.setItem(KEY, JSON.stringify({ teamId, at: Date.now() })); } catch {} };

export const hasAgreed = () => Boolean(local());
export function agreedOn() {
  try {
    const t = JSON.parse(local())?.at;
    return t ? new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  } catch {
    return null;
  }
}

// The server's record: { enabled, version, accepted: { teamId: { at, version, verified } } }, or null when there is none
export async function fetchRecord() {
  try {
    const res = await fetch('api/accept', { cache: 'no-store' });
    return res.ok && (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  } catch {
    return null;
  }
}

// True when this team is already on record for the current terms (or, with no server record, this browser agreed)
export async function isAccepted(app) {
  if (app.demo) return true;
  const team = app.account.team();
  const rec = app.src?.kind === 'api' ? await fetchRecord() : null;
  if (rec?.enabled) return Boolean(team && rec.accepted[team.id]?.version >= rec.version);
  return hasAgreed();
}

export function openAgreement(app, { onDone = () => {} } = {}) {
  if (document.getElementById('agree-modal')) return;
  const root = document.createElement('div');
  root.id = 'agree-modal';
  root.className = 'modal-back';
  document.body.append(root);
  let busy = false;
  let error = '';

  const draw = () => {
    const team = app.account.team();
    const body = team
      ? `<p class="lede"><b>${esc(team.name)}</b>${team.owner ? ` (${esc(team.owner)})` : ''}, do you accept the <button type="button" class="link" data-legal="terms">Terms and Conditions</button> and the <button type="button" class="link" data-legal="privacy">Privacy policy</button>?</p>
         <p class="note">Accepting is recorded with today’s date and time against your team, and it can’t be undone. <button type="button" class="link" data-a="notme">Not your team?</button></p>
         ${error ? `<p class="warn" role="alert">${esc(error)}</p>` : ''}
         <footer><span class="grow"></span><button type="button" class="btn primary" data-accept${busy ? ' disabled' : ''}>${busy ? 'Recording…' : 'I accept'}</button></footer>`
      : `<p class="lede">Before you can use the site, say who you are. Then you will be asked to accept the <button type="button" class="link" data-legal="terms">Terms and Conditions</button> and <button type="button" class="link" data-legal="privacy">Privacy policy</button>.</p>
         ${signInHtml(app.account, app.ctx.league.teams, 'to continue')}`;
    root.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="ag-title"><header><h2 id="ag-title">Terms and Conditions</h2></header>${body}</div>`;
    if (!team) focusPin(root);
    else root.querySelector('[data-accept]')?.focus();
  };

  // Picking a team that is already on record lets you straight in; any other team is asked
  app.account.onChange(async () => {
    if (!root.isConnected) return;
    if (await isAccepted(app)) {
      root.remove();
      onDone();
    } else draw();
  });
  root.addEventListener('click', async (e) => {
    if (signInClick(e, app.account)) return;
    const l = e.target.closest('[data-legal]');
    if (l) return openLegal(l.dataset.legal);
    if (e.target.closest('[data-a=notme]')) return app.account.signOut();
    if (!e.target.closest('[data-accept]') || busy) return;
    const team = app.account.team();
    busy = true;
    error = '';
    draw();
    try {
      const rec = app.src?.kind === 'api' ? await fetchRecord() : null;
      if (rec?.enabled) {
        const res = await fetch('api/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamId: team.id, version: rec.version }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'Couldn’t record that. Try again.');
      }
      setLocal(team.id);
      root.remove();
      onDone();
    } catch (err) {
      busy = false;
      error = err.message;
      draw();
    }
  });
  root.addEventListener('submit', (e) => signInSubmit(e, app.account));
  root.addEventListener('keydown', (e) => e.key === 'Tab' && root.querySelector('[data-accept]') && !document.getElementById('legal-modal') && (e.preventDefault(), root.querySelector('[data-accept]').focus()));
  draw();
}
