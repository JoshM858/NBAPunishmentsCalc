// Trade block: every manager's Target list, Trading block and Untouchables (like the 2K MyNBA trade screens),
// visible to the whole league and editable only by that team. Stored on the server (see README, Trade block).
import { esc, fmt1, panel, plural } from '../ui/dom.js';
import { headshot } from '../ui/player.js';
import { link } from '../ui/router.js';
import { focusPin, signInClick, signInHtml, signInSubmit } from '../ui/signin.js';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
};

async function fetchBoard() {
  const res = await fetch('api/board', { cache: 'no-store' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(body?.error || 'Couldn’t load the trade block.');
  return body;
}

export async function renderBlock(app, el, route) {
  if (app.src.kind === 'static' || app.demo) {
    el.innerHTML = panel('Trade block', `<p class="empty">The trade block is saved on a server, so it isn’t part of the GitHub Pages version (that site is read-only). Use the Cloudflare or PC version to share target lists, trading blocks and untouchables.</p>`);
    return;
  }
  el.innerHTML = '<p class="loading">Loading the trade block…</p>';
  let board;
  let pool;
  try {
    [board, pool] = await Promise.all([fetchBoard(), app.store.get().catch(() => null)]);
  } catch (err) {
    if (app.route === route) el.innerHTML = panel('Trade block', `<p class="warn">${esc(err.message)}</p>`);
    return;
  }
  if (app.route !== route) return;

  const teams = app.ctx.league.teams;
  const me = app.account.team();
  const byId = pool?.byId || new Map();
  const info = (id) => {
    const p = byId.get(id);
    if (p) return p;
    for (const t of teams) {
      const r = t.roster.find((x) => x.playerId === id);
      if (r) return { id, name: r.name, pos: [], team: app.ctx.pro.abbrev.get(r.proTeamId) || '', avg: r.seasonAvg, fantasyTeam: { id: t.id, name: t.name } };
    }
    return { id, name: `Player ${id}`, pos: [], team: '', avg: null, fantasyTeam: null };
  };
  const teamName = (id) => teams.find((t) => t.id === id)?.name || 'Another team';
  const L = board.limits;
  const editable = Boolean(me) && board.canEdit && (board.teamId == null || board.teamId === me.id); // the server decides who may edit; this only mirrors it
  const mine = board.teams[me?.id] || {};
  const ed = { block: [...(mine.block || [])], targets: [...(mine.targets || [])], untouchables: [...(mine.untouchables || [])], positions: [...(mine.positions || [])], note: mine.note || '' };
  const ui = { picker: null, q: '', status: '', saving: false };

  /* ----- pieces ----- */

  const card = (id, removeKey) => {
    const p = info(id);
    return `<div class="slot filled">${headshot(id)}<div class="slot-main"><a class="plink" href="${link('players', id)}"><b>${esc(p.name)}</b></a><small>${esc(p.pos.join('/'))}${p.team ? ` · ${esc(p.team)}` : ''}${p.fantasyTeam && removeKey === 'targets' ? ` · ${esc(p.fantasyTeam.name)}` : ''}</small></div><span class="slot-avg">${fmt1(p.avg)}</span>${removeKey ? `<button type="button" class="link" data-rm="${removeKey}" data-id="${id}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}</div>`;
  };
  const column = (key, title, max, hint) => {
    const list = ed[key];
    const slots = Array.from({ length: max }, (_, i) => (list[i] != null ? card(list[i], key) : `<button type="button" class="slot" data-add="${key}">Add player</button>`));
    return `<section class="panel"><header class="panel-h"><h2>${title}</h2><span class="note">${list.length} of ${max}</span></header><div class="panel-b slots"><p class="note">${hint}</p>${slots.join('')}</div></section>`;
  };

  const pickerOptions = () => {
    const q = ui.q.trim().toLowerCase();
    const mineIds = new Set((me?.roster || []).map((p) => p.playerId));
    const taken = new Set(ed[ui.picker]);
    const source = ui.picker === 'targets'
      ? (pool?.players || []).filter((p) => p.fantasyTeam && p.fantasyTeam.id !== me.id && p.proTeamId)
      : (me?.roster || []).map((r) => info(r.playerId));
    return source.filter((p) => !taken.has(p.id) && (!q || `${p.name} ${p.team}`.toLowerCase().includes(q))).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0)).slice(0, 40).map((p) => `<li><button type="button" data-pick="${p.id}"><b>${esc(p.name)}</b><small>${esc(p.pos.join('/'))} · ${esc(p.team)}${ui.picker === 'targets' && p.fantasyTeam ? ` · ${esc(p.fantasyTeam.name)}` : ''}</small><em>${fmt1(p.avg)}</em></button></li>`).join('') || '<li class="empty">No players match.</li>';
  };

  const editor = () => {
    if (!me) return signInHtml(app.account, teams, 'to edit your own target list, trading block and untouchables');
    if (!board.enabled) return panel('Your lists', '<p class="warn">Saving isn’t switched on for this site yet.</p><p class="note">The trade block needs somewhere to store its lists. In Cloudflare, add a KV namespace bound as <code>BOARD</code> (README: Trade block). On the PC version it works without setup.</p>');
    const gate = !board.canEdit ? `<p class="warn">${app.account.state.pins ? 'Sign in with your team PIN to edit your lists.' : 'Turn on team PINs so each manager can edit only their own lists (README: Trade block).'}</p>` : '';
    return `${gate}<div class="grid cols-3 keep">${column('targets', 'Target list', L.targets, 'Players on other teams you want.')}${column('block', 'Trading block', L.block, 'Your players you will move.')}${column('untouchables', 'Untouchables', L.untouchables, 'Players you will not trade.')}</div>
      <section class="panel"><header class="panel-h"><h2>Positions you need</h2><span class="note">up to ${L.positions}</span></header><div class="panel-b">
        <div class="chips">${POSITIONS.map((p) => `<button type="button" class="seg-chip" data-pos="${p}" aria-pressed="${ed.positions.includes(p)}">${p}</button>`).join('')}</div>
        <label class="field" style="margin-top:12px"><span>Note to the league (${L.note} characters)</span><input id="bk-note" type="text" maxlength="${L.note}" value="${esc(ed.note)}" placeholder="What are you after?"></label>
        <p style="margin-top:12px"><button type="button" class="btn primary" data-save ${editable && !ui.saving ? '' : 'disabled'}>${ui.saving ? 'Saving…' : 'Save my lists'}</button> <span class="${ui.status.startsWith('Saved') ? 'ok' : 'warn'}" role="status">${esc(ui.status)}</span></p>
      </div></section>`;
  };

  const matches = () => {
    if (!me) return '';
    const myBlock = new Set(mine.block || []);
    const lines = [];
    for (const [tid, rec] of Object.entries(board.teams)) {
      if (Number(tid) === me.id) continue;
      for (const id of rec.block || []) if ((mine.targets || []).includes(id)) lines.push(`<li><b>${esc(teamName(Number(tid)))}</b> is shopping <b>${esc(info(id).name)}</b>, who is on your target list.</li>`);
      for (const id of rec.targets || []) if (myBlock.has(id)) lines.push(`<li><b>${esc(teamName(Number(tid)))}</b> wants <b>${esc(info(id).name)}</b>, who is on your trading block.</li>`);
      for (const id of rec.targets || []) if (!myBlock.has(id) && me.roster.some((p) => p.playerId === id) && !(mine.untouchables || []).includes(id)) lines.push(`<li><b>${esc(teamName(Number(tid)))}</b> has <b>${esc(info(id).name)}</b> on their target list. He is on your team.</li>`);
    }
    return panel('Matches for you', lines.length ? `<ul class="movers">${lines.join('')}</ul>` : '<p class="empty">No overlap yet. Fill in your lists and check back as other managers fill theirs.</p>');
  };

  const leagueBoard = () => {
    const others = teams.filter((t) => t.id !== me?.id);
    const cards = others.map((t) => {
      const r = board.teams[t.id];
      const list = (title, ids) => ids?.length ? `<div class="bk-list"><h4>${title}</h4>${ids.map((id) => `<a class="bk-p" href="${link('players', id)}">${headshot(id)}<span>${esc(info(id).name)}</span><em>${fmt1(info(id).avg)}</em></a>`).join('')}</div>` : '';
      return `<section class="panel bk-team"><header class="panel-h"><h2>${esc(t.name)}</h2>${r ? `<span class="note">${esc(ago(r.updatedAt))}</span>` : ''}</header><div class="panel-b">
        <p class="note">${esc(t.owner || '')}</p>
        ${r ? `${r.note ? `<p class="bk-note">“${esc(r.note)}”</p>` : ''}${r.positions?.length ? `<p>${r.positions.map((p) => `<span class="badge accent">${p}</span>`).join(' ')} <span class="note">needed</span></p>` : ''}${list('Trading block', r.block)}${list('Target list', r.targets)}${list('Untouchables', r.untouchables)}` : '<p class="empty" style="padding:0">Nothing posted yet.</p>'}
        ${me ? `<p style="margin-top:10px"><button type="button" class="btn sm" data-trade="${t.id}">Start a trade</button></p>` : ''}
      </div></section>`;
    }).join('');
    return `<div class="grid cols-3">${cards}</div>`;
  };

  const draw = () => {
    el.innerHTML = `<div class="grid">${editor()}${matches()}<h3 class="sect">League trade block</h3>${leagueBoard()}
      ${ui.picker ? `<div class="sheet picker" role="dialog" aria-label="Add a player"><button type="button" class="closer" data-close>✕ Close</button><div class="verdict"><h3>Add to ${ui.picker === 'targets' ? 'target list' : ui.picker === 'block' ? 'trading block' : 'untouchables'}</h3><input id="bk-q" type="search" placeholder="Search by name or team" value="${esc(ui.q)}" autocomplete="off" style="width:100%"><ul class="pick-list">${pickerOptions()}</ul></div></div>` : ''}</div>`;
    if (ui.picker) el.querySelector('#bk-q')?.focus({ preventScroll: true });
    else if (!me) focusPin(el);
  };

  el.onclick = async (e) => {
    if (signInClick(e, app.account)) return;
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.add) { ui.picker = t.dataset.add; ui.q = ''; return draw(); }
    if (t.dataset.close != null) { ui.picker = null; return draw(); }
    if (t.dataset.pick) {
      const id = Number(t.dataset.pick);
      const key = ui.picker;
      if (ed[key].length < L[key]) ed[key].push(id);
      if (key === 'untouchables') ed.block = ed.block.filter((x) => x !== id);
      if (key === 'block') ed.untouchables = ed.untouchables.filter((x) => x !== id);
      ui.picker = null;
      ui.status = '';
      return draw();
    }
    if (t.dataset.rm) { ed[t.dataset.rm] = ed[t.dataset.rm].filter((x) => x !== Number(t.dataset.id)); ui.status = ''; return draw(); }
    if (t.dataset.pos) {
      const p = t.dataset.pos;
      ed.positions = ed.positions.includes(p) ? ed.positions.filter((x) => x !== p) : ed.positions.length < L.positions ? [...ed.positions, p] : ed.positions;
      ui.status = '';
      return draw();
    }
    if (t.dataset.trade) {
      app.trade.open(Number(t.dataset.trade), { get: (board.teams[t.dataset.trade]?.block || []).filter((id) => ed.targets.includes(id)) });
      location.hash = link('transactions');
      return;
    }
    if (t.dataset.save != null && editable) {
      ui.saving = true; ui.status = ''; draw();
      try {
        const res = await fetch('api/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamId: me.id, ...ed }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Couldn’t save. Try again.');
        board.teams[me.id] = body;
        Object.assign(mine, body);
        ui.status = `Saved ${plural(body.block.length + body.targets.length + body.untouchables.length, 'player')} to your lists.`;
      } catch (err) {
        ui.status = err.message;
      }
      ui.saving = false;
      draw();
    }
  };
  el.onsubmit = (e) => signInSubmit(e, app.account);
  el.oninput = (e) => {
    if (e.target.id === 'bk-q') { ui.q = e.target.value; el.querySelector('.pick-list').innerHTML = pickerOptions(); }
    else if (e.target.id === 'bk-note') { ed.note = e.target.value; ui.status = ''; }
  };
  el.onkeydown = (e) => { if (e.key === 'Escape' && ui.picker) { ui.picker = null; draw(); } };
  draw();
}
