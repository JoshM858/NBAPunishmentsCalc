// The Trade tab. Your team fills the left and the other teams are on the right. Tap one to put the two rosters
// side by side and rate a swap, or add more teams for a multi-way trade. The maths is in trade.js.
import { evaluateMultiTrade, multiSummary, shortDate, tradeContext, tradeSummary } from './trade.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const signed = (v) => `${v < -0.05 ? '−' : '+'}${Math.abs(v).toFixed(1)}`;
const starRow = (n) => `<span class="stars" role="img" aria-label="${n} out of 5 stars">${[1, 2, 3, 4, 5].map((i) => `<span class="star ${n >= i ? 'on' : n >= i - 0.5 ? 'half' : ''}">★</span>`).join('')}</span>`;
const MAX_TEAMS = 6;

// `data()` returns { ctx, src } for the league that is currently loaded.
export function createTradeUI({ panel, data }) {
  const st = { me: null, pins: false, pending: null, pinError: '', view: 'browse', order: [], picks: new Map(), fa: undefined, tctx: null, last: null };
  const league = () => data().ctx.league;
  const teamOf = (id) => league().teams.find((t) => t.id === id);

  /* ---------- Who you are ---------- */

  const meKey = () => `pw:me:${data().ctx.cfg.leagueId ?? 'site'}`;
  const known = (id) => league().teams.some((t) => t.id === id);

  function loadMe() {
    try {
      const id = Number(localStorage.getItem(meKey()));
      return known(id) ? id : null;
    } catch {
      return null;
    }
  }

  // With team PINs on, the server remembers who you are (a signed cookie), not this browser.
  async function serverMe() {
    try {
      const id = (await (await fetch('api/me', { cache: 'no-store' })).json()).teamId;
      return known(id) ? id : null;
    } catch {
      return null;
    }
  }

  function startOver() {
    st.view = 'browse';
    st.order = [];
    st.picks.clear();
    st.last = null;
  }

  function setMe(id) {
    st.me = id;
    startOver();
    try {
      if (id == null) localStorage.removeItem(meKey());
      else localStorage.setItem(meKey(), String(id));
    } catch {}
    render();
  }

  async function signInWithPin(id, pin) {
    st.pinError = '';
    try {
      const res = await fetch('api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamId: id, pin }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) st.pinError = body.error || 'Couldn’t sign in. Try again.';
      else {
        st.pending = null;
        st.me = id;
        startOver();
      }
    } catch {
      st.pinError = 'Couldn’t reach the server. Try again.';
    }
    render();
  }

  async function signOut() {
    if (st.pins) await fetch('api/logout', { method: 'POST' }).catch(() => {});
    st.pending = null;
    st.pinError = '';
    setMe(null);
  }

  // Called after every (re)load of the league. A trade in progress survives a refresh.
  async function reset(pins) {
    const before = st.me;
    st.pins = Boolean(pins);
    st.fa = undefined;
    st.tctx = null;
    st.me = st.pins ? await serverMe() : loadMe();
    if (st.me !== before) startOver();
  }

  // Free agents set the replacement level. Loaded once per refresh; without them a typical level is used.
  async function prefetch() {
    const { src } = data();
    if (st.fa !== undefined || !src?.freeAgents) return;
    st.fa = null;
    try {
      st.fa = await src.freeAgents();
    } catch {
      st.fa = [];
    }
    st.tctx = null;
    render();
  }

  const ctxOf = () => (st.tctx ||= tradeContext({ league: league(), pro: data().ctx.pro, freeAgents: st.fa || [], injuries: data().ctx.injuries }));

  /* ---------- Pieces ---------- */

  function rosterList(team, ctx, { pickable }) {
    const groups = [['Starting', (p) => p.slot <= 11], ['Bench', (p) => p.slot === 12], ['Injured reserve', (p) => p.slot >= 13]];
    const n = st.order.length;
    return groups
      .map(([title, test]) => {
        const rows = team.roster.filter(test).sort((a, b) => ctx.valueOf(b).ppg - ctx.valueOf(a).ppg);
        if (!rows.length) return '';
        const items = rows
          .map((p) => {
            const v = ctx.valueOf(p);
            const back = ctx.returnOf(p);
            const status = p.injury && p.injury !== 'ACTIVE' ? p.injury.replace(/_/g, ' ').toLowerCase() : back ? 'hurt' : '';
            const chip = status ? `<span class="inj">${esc(status)}${back ? `, back ~${shortDate(back)}` : ''}</span>` : '';
            const pick = st.picks.get(p.playerId);
            const body = `<span class="pn">${esc(p.name)}</span><span class="pv">${v.ppg.toFixed(1)}<small> pts/game · plays ${Math.round(v.rate * 100)}%</small></span>${chip}`;
            if (!pickable) return `<li class="prow"><div class="pl static">${body}</div></li>`;
            const dest = pick && n > 2
              ? `<label class="dest">goes to <select data-t="dest" data-id="${p.playerId}" aria-label="Where ${esc(p.name)} goes">${st.order.filter((id) => id !== team.id).map((id) => `<option value="${id}"${pick.to === id ? ' selected' : ''}>${esc(teamOf(id).name)}</option>`).join('')}</select></label>`
              : '';
            return `<li class="prow${pick ? ' picked' : ''}"><label class="pl"><input type="checkbox" data-t="tick" data-id="${p.playerId}" data-team="${team.id}"${pick ? ' checked' : ''}>${body}</label>${dest}</li>`;
          })
          .join('');
        return `<h4 class="grp">${title}</h4><ul class="plist">${items}</ul>`;
      })
      .join('');
  }

  const topPlayers = (team, ctx) => [...team.roster].sort((a, b) => ctx.valueOf(b).ppg - ctx.valueOf(a).ppg).slice(0, 3).map((p) => p.name.split(' ').slice(-1)[0]).join(', ');

  /* ---------- Views ---------- */

  function signInView() {
    const teams = league().teams;
    const pending = st.pins ? teams.find((t) => t.id === st.pending) : null;
    const intro = st.pins
      ? 'Pick your team and enter its PIN to see your players and test trades. Ask the league organiser if you don’t know it.'
      : 'Pick your team to see your players and test trades. This just remembers your team on this device. Everything here is already visible to the whole league, so there is no password.';
    const form = pending
      ? `<form class="pin" data-t="pinform">
          <label for="pin-input">PIN for <b>${esc(pending.name)}</b></label>
          <input id="pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12" required>
          <button type="submit" class="action">Sign in</button>
          ${st.pinError ? `<p class="warn" role="alert">${esc(st.pinError)}</p>` : ''}
        </form>`
      : '';
    panel.innerHTML = `<h2 class="panel-title">Who are you?</h2>
      <p class="lede">${intro}</p>
      <div class="picks">${teams.map((t) => `<button type="button" class="team-pick${pending?.id === t.id ? ' picked' : ''}" data-t="signin" data-id="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.owner)}</span></button>`).join('')}</div>
      ${form}`;
    if (pending) panel.querySelector('#pin-input')?.focus({ preventScroll: true });
  }

  const youLine = (me) => `<p class="lede who">Signed in as <b>${esc(me.name)}</b>${me.owner ? ` (${esc(me.owner)})` : ''}. <button type="button" class="link" data-t="signout">Not you? Switch team</button></p>`;

  function browseView(me) {
    const ctx = ctxOf();
    const others = league().teams.filter((t) => t.id !== me.id);
    panel.innerHTML = `${youLine(me)}
      <div class="split">
        <section class="col"><h2 class="panel-title">Your team</h2>${rosterList(me, ctx, { pickable: false })}</section>
        <aside class="col"><h2 class="panel-title">Trade with</h2>
          <p class="lede">Tap a team to put your rosters side by side.</p>
          <div class="cards">${others.map((t) => `<button type="button" class="team-card" data-t="open" data-id="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.owner)}</span><small>${esc(topPlayers(t, ctx))}</small></button>`).join('')}</div>
        </aside>
      </div>`;
  }

  // The result for the picks so far: { bar, details } (the bar stays pinned to the top while you scroll)
  function resultFor(me, teams, ctx) {
    const moves = [...st.picks].map(([playerId, m]) => ({ playerId, ...m }));
    const senders = new Set(moves.map((m) => m.from));
    if (moves.length < 2 || senders.size < 2) {
      const hint = st.order.length > 2
        ? 'Tick players from at least two teams, and say where each one goes.'
        : 'Tick at least one player from each team to rate the trade.';
      return { bar: `<p class="hint">${hint}</p>`, details: '', summary: '' };
    }
    const r = evaluateMultiTrade(ctx, teams, moves);
    const youGain = r.teams.find((t) => t.id === me.id)?.gain ?? 0;
    const active = r.teams.filter((t) => t.involved).sort((a, b) => b.gain - a.gain);
    const cls = (g) => (g < -2 ? 'neg' : 'pos');
    const bar = `<p class="vstars">${starRow(r.stars)} <b>${r.stars} stars</b> <span class="vlabel">${esc(r.label)}</span></p>
      <p class="vgain">${active.map((t) => `${t.id === me.id ? 'You' : esc(t.name)} <b class="${cls(t.gain)}">${signed(t.gain)}</b>`).join(' · ')} <small>points a week</small></p>`;

    const name = (id) => (id === me.id ? 'You' : teamOf(id).name);
    const head = r.winnerId == null ? 'Dead even.' : teams.length > 2 ? `${esc(name(r.winnerId))} gain${r.winnerId === me.id ? '' : 's'} the most and ${esc(name(r.loserId))} ${r.loserId === me.id ? 'gain' : 'gains'} the least.` : r.winnerId === me.id ? 'You come out ahead.' : `${esc(name(r.winnerId))} comes out ahead.`;
    const lines = [];
    if (youGain < -2) lines.push(`<p class="warn">This costs you about ${Math.abs(youGain).toFixed(0)} points a week.</p>`);
    else if (active.length && active.every((t) => t.gain > 2)) lines.push('<p class="ok">Every team gains, so this helps everyone.</p>');
    for (const t of r.teams) if (t.mustDrop) lines.push(`<p class="warn">${esc(name(t.id))} would have ${t.mustDrop} too many players and have to drop ${t.mustDrop === 1 ? 'one' : t.mustDrop}.</p>`);
    for (const id of r.idle) lines.push(`<p class="note">${esc(teamOf(id).name)} isn’t in any swap yet. Tick a player to send to them, or remove the team.</p>`);
    for (const n of r.notes) lines.push(`<p class="note">${esc(n)}</p>`);

    const named = moves.map((m) => ({ ...m, name: teamOf(m.from).roster.find((p) => p.playerId === m.playerId)?.name ?? '?' }));
    let summary;
    if (teams.length === 2) {
      const other = teams[1];
      summary = tradeSummary({ stars: r.stars, label: r.label, winner: r.winnerId == null ? null : r.winnerId === me.id ? 'a' : 'b', a: { gain: youGain }, b: { gain: r.teams.find((t) => t.id === other.id).gain } }, { a: me.name, b: other.name, give: named.filter((m) => m.from === me.id).map((m) => m.name), get: named.filter((m) => m.from === other.id).map((m) => m.name) });
    } else summary = multiSummary(r, named);

    const leagueId = data().ctx.cfg.leagueId;
    const espn = leagueId ? `<a class="link" href="https://fantasy.espn.com/basketball/league?leagueId=${encodeURIComponent(leagueId)}" target="_blank" rel="noopener">Open the league in ESPN to make the trade</a>` : '';
    const details = `<div class="verdict">
        <h3>${esc(r.label)}</h3>
        <p>${head}</p>
        <div class="gains">${active.map((t) => `<p><span>${esc(name(t.id))}</span><b class="${cls(t.gain)}">${signed(t.gain)}</b> points a week</p>`).join('')}</div>
        ${lines.join('')}
        <p class="actions"><button type="button" class="action" data-t="copy">Copy trade summary</button> ${espn}</p>
        <details><summary>How the stars are worked out</summary>
          <p class="note">Each player is valued by the points he is expected to score when he plays (his games so far, pulled toward ESPN’s preseason projection) times how often he plays. Each team’s best lineup is then compared for every remaining game day, before and after the trade, against what a free agent could give you${ctx.replacementFromData ? ' (using the real free-agent list)' : ' (a typical free agent)'}. The star rating is how unsure we are who really wins: 5 stars means it is too close to call, and fewer stars mean one side clearly wins. In a multi-way trade it compares the team that gains most with the one that gains least. Injuries can swing any trade, so these are odds, not a promise. This tool only judges a trade; make the real one in ESPN.</p>
        </details>
      </div>`;
    return { bar, details, summary };
  }

  function builderView(me) {
    const ctx = ctxOf();
    const teams = st.order.map(teamOf).filter(Boolean);
    const n = teams.length;
    const result = resultFor(me, teams, ctx);
    st.last = result.summary;
    const spare = league().teams.filter((t) => !st.order.includes(t.id));
    const partnerChoices = league().teams.filter((t) => t.id !== me.id);
    const cols = teams
      .map((t, i) => {
        const head = i === 0
          ? `<h3>${esc(t.name)} <span class="tag">you</span></h3>`
          : n === 2
            ? `<h3><select data-t="partner" aria-label="Team to trade with">${partnerChoices.map((o) => `<option value="${o.id}"${o.id === t.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></h3>`
            : `<h3>${esc(t.name)} <button type="button" class="link" data-t="remove" data-id="${t.id}">Remove</button></h3>`;
        return `<section class="tcol${i === 0 ? ' mine' : ''}">${head}${rosterList(t, ctx, { pickable: true })}</section>`;
      })
      .join('');
    panel.innerHTML = `<div class="tbar">
        <div class="topline">
          <button type="button" class="action ghost" data-t="cancel">✕ Cancel</button>
          ${spare.length && n < MAX_TEAMS ? `<select class="multi" data-t="add" aria-label="Add a team for a multi-way trade"><option value="">${n === 2 ? '＋ Multi-way trade' : '＋ Add another team'}</option>${spare.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>` : ''}
        </div>
        ${result.bar}
      </div>
      <div class="cols${n > 2 ? ' many' : ''}" style="--n:${n}">${cols}</div>
      <div class="result">${result.details}</div>`;
  }

  function render() {
    if (!data().ctx) return;
    const me = teamOf(st.me);
    if (!me) return signInView();
    if (st.view === 'build' && st.order.length >= 2 && st.order.every(teamOf)) return builderView(me);
    st.view = 'browse';
    browseView(me);
  }

  /* ---------- Actions ---------- */

  const defaultDest = (from) => {
    const i = st.order.indexOf(from);
    const n = st.order.length;
    return n === 2 ? st.order[1 - i] : st.order[(i + 1) % n];
  };

  // Re-render after a change, keeping the scroll position and keyboard focus where they were
  function redraw(focus) {
    const top = window.scrollY;
    render();
    window.scrollTo(0, top);
    if (focus) panel.querySelector(focus)?.focus({ preventScroll: true });
  }

  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-t]');
    if (!btn || !data().ctx) return;
    const act = btn.dataset.t;
    const id = Number(btn.dataset.id);
    if (act === 'signin') {
      if (st.pins) {
        st.pending = id;
        st.pinError = '';
        render();
      } else setMe(id);
    } else if (act === 'signout') signOut();
    else if (act === 'open') {
      st.order = [st.me, id];
      st.picks.clear();
      st.view = 'build';
      render();
      window.scrollTo(0, panel.getBoundingClientRect().top + window.scrollY - 8);
    } else if (act === 'cancel') {
      startOver();
      render();
    } else if (act === 'remove') {
      st.order = st.order.filter((x) => x !== id);
      for (const [pid, m] of st.picks) {
        if (m.from === id) st.picks.delete(pid);
        else if (m.to === id) st.picks.set(pid, { ...m, to: defaultDest(m.from) });
      }
      redraw();
    } else if (act === 'copy') copy(btn);
  });

  panel.addEventListener('change', (e) => {
    const el = e.target.closest('[data-t]');
    if (!el || !data().ctx) return;
    const act = el.dataset.t;
    if (act === 'tick') {
      const pid = Number(el.dataset.id);
      if (el.checked) st.picks.set(pid, { from: Number(el.dataset.team), to: defaultDest(Number(el.dataset.team)) });
      else st.picks.delete(pid);
      redraw(`[data-t="tick"][data-id="${pid}"]`);
    } else if (act === 'dest') {
      const pid = Number(el.dataset.id);
      st.picks.set(pid, { ...st.picks.get(pid), to: Number(el.value) });
      redraw(`[data-t="dest"][data-id="${pid}"]`);
    } else if (act === 'partner') {
      const old = st.order[1];
      st.order[1] = Number(el.value);
      for (const [pid, m] of st.picks) if (m.from === old || m.to === old) st.picks.delete(pid);
      redraw('[data-t="partner"]');
    } else if (act === 'add' && el.value) {
      st.order.push(Number(el.value));
      redraw();
    }
  });

  panel.addEventListener('submit', (e) => {
    if (e.target.closest('[data-t=pinform]') && st.pending != null) {
      e.preventDefault();
      signInWithPin(st.pending, e.target.querySelector('input').value);
    }
  });

  async function copy(btn) {
    if (!st.last) return;
    try {
      await navigator.clipboard.writeText(st.last);
    } catch {
      const box = Object.assign(document.createElement('textarea'), { value: st.last });
      document.body.append(box);
      box.select();
      document.execCommand('copy');
      box.remove();
    }
    btn.textContent = 'Copied. Paste it into the group chat';
    setTimeout(() => (btn.textContent = 'Copy trade summary'), 2500);
  }

  return { render, reset, prefetch, state: st };
}
