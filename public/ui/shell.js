// The frame around every page: main navigation, contextual tabs, account chip, refresh button, banner, footer.
import { esc } from './dom.js';
import { link } from './router.js';

// On a phone the account chip moves into this row (the top bar has no room), so nothing is lost.
export function renderNav(pages, route, el, team) {
  el.innerHTML = pages.map((p) => `<a href="${link(p.id)}"${p.id === route.section ? ' aria-current="page"' : ''}>${esc(p.label)}</a>`).join('')
    + `<a class="nav-acct" href="${link('team')}">${team ? `Team: ${esc(team.name)}` : 'Sign in'}</a>`;
}

export function renderSubnav(page, route, nav, inner) {
  const tabs = page?.tabs;
  nav.hidden = !tabs?.length;
  if (!tabs?.length) return;
  const cur = /^\d+$/.test(route.tab) ? tabs[0].id : route.tab || tabs[0].id; // a player id keeps "Database" lit
  inner.innerHTML = tabs.map((t) => `<a href="${link(page.id, t.id)}"${t.id === cur ? ' aria-current="page"' : ''}>${esc(t.label)}</a>`).join('');
}

export function renderAccount(btn, team) {
  btn.hidden = false;
  btn.innerHTML = team ? `<i>Team</i><b>${esc(team.name)}</b>` : '<b>Sign in</b>';
  btn.title = team ? 'Your team' : 'Pick your team';
}
