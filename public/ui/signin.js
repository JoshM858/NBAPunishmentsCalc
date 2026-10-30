// "Who are you?" panel, used by My Team and the Trade Centre.
import { esc } from './dom.js';

export function signInHtml(account, teams, why = 'to see your players and test trades') {
  const { pins, pending: pid, pinError } = account.state;
  const pending = pins ? teams.find((t) => t.id === pid) : null;
  const intro = pins
    ? `Pick your team and enter its PIN ${why}. Ask the league organiser if you don’t know it.`
    : `Pick your team ${why}. This just remembers your team on this device. Everything here is already visible to the whole league, so there is no password.`;
  const form = pending
    ? `<form class="pin" data-a="pinform">
        <label for="pin-input">PIN for <b>${esc(pending.name)}</b></label>
        <input id="pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12" required>
        <button type="submit" class="btn primary">Sign in</button>
        ${pinError ? `<p class="warn" role="alert">${esc(pinError)}</p>` : ''}
      </form>`
    : '';
  return `<section class="panel signin"><header class="panel-h"><h2>Who are you?</h2></header><div class="panel-b">
      <p class="lede">${intro}</p>
      <div class="picks">${teams.map((t) => `<button type="button" class="team-pick${pending?.id === t.id ? ' picked' : ''}" data-a="signin" data-id="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.owner)}</span></button>`).join('')}</div>
      ${form}
    </div></section>`;
}

// Event handlers for the panel above: pass them to a page's el.onclick / el.onsubmit (or use bindSignIn for a persistent root).
export function signInClick(e, account) {
  const b = e.target.closest('[data-a=signin]');
  if (!b) return false;
  account.choose(Number(b.dataset.id));
  return true;
}

export function signInSubmit(e, account) {
  const f = e.target.closest('[data-a=pinform]');
  if (!f || account.state.pending == null) return false;
  e.preventDefault();
  account.signInWithPin(account.state.pending, f.querySelector('input').value);
  return true;
}

export function bindSignIn(root, account) {
  root.addEventListener('click', (e) => signInClick(e, account));
  root.addEventListener('submit', (e) => signInSubmit(e, account));
}

export function focusPin(root) {
  root.querySelector('#pin-input')?.focus({ preventScroll: true });
}
