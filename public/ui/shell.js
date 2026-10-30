// The frame around every page: main navigation, contextual tabs, account chip, refresh button, banner, footer.
import { esc } from './dom.js';
import { link } from './router.js';

export function renderNav(pages, route, el) {
  el.innerHTML = pages.map((p) => `<a href="${link(p.id)}"${p.id === route.section ? ' aria-current="page"' : ''}>${esc(p.label)}</a>`).join('');
}

export function renderSubnav(page, route, nav, inner) {
  const tabs = page?.tabs;
  nav.hidden = !tabs?.length;
  if (!tabs?.length) return;
  const cur = route.tab || tabs[0].id;
  inner.innerHTML = tabs.map((t) => `<a href="${link(page.id, t.id)}"${t.id === cur ? ' aria-current="page"' : ''}>${esc(t.label)}</a>`).join('');
}

export function renderAccount(btn, team) {
  btn.hidden = false;
  btn.innerHTML = team ? `<i>Team</i><b>${esc(team.name)}</b>` : '<b>Sign in</b>';
  btn.title = team ? 'Your team' : 'Pick your team';
}
