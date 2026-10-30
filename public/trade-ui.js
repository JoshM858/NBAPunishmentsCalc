// The Trade tab. While you trade, the page is just the workspace: your team on the left and the team you are
// trading with on the right, both lineups on one screen with no scrolling. Add more teams for a multi-way trade.
// The maths is in trade.js.
import { evaluateMultiTrade, explainMoves, multiSummary, shortDate, simulateTrade, tradeBaseline, tradeContext, tradeSummary } from './trade.js';
import { signInHtml, bindSignIn, focusPin } from './ui/signin.js';
import { esc, pct, signed, starRow } from './ui/dom.js';

const MAX_TEAMS = 6;
const SHORT = { OUT: 'out', INJURY_RESERVE: 'IR', SUSPENSION: 'susp', DAY_TO_DAY: 'DTD', GTD: 'GTD', QUESTIONABLE: 'Q', DOUBTFUL: 'D' };

// `data()` returns { ctx, src } for the league that is currently loaded.
export function createTradeUI({ data, account }) {
  const panel = document.createElement('div');
  panel.className = 'trade-ui';
  const st = { view: 'browse', order: [], picks: new Map(), sheet: null, sim: false, simResult: null, simTimer: null, baseline: null, fa: undefined, tctx: null, last: null };
  const league = () => data().ctx.league;
  const teamOf = (id) => league().teams.find((t) => t.id === id);

  /* ---------- Who you are (see account.js) ---------- */

  function startOver() {
    st.view = 'browse';
    st.order = [];
    st.picks.clear();
    st.sheet = null;
    st.sim = false;
    st.simResult = null;
    clearTimeout(st.simTimer);
    st.last = null;
  }

  account.onChange(() => {
    startOver();
    if (panel.isConnected) render();
  });
  bindSignIn(panel, account);

  // Called after every (re)load of the league. A trade in progress survives a refresh.
  function reset() {
    st.fa = undefined;
    st.tctx = null;
    st.baseline = null;
    st.simResult = null;
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

  // One flat list of one-line rows so every row can share the column's height.
  function rosterList(team, ctx, { pickable }) {
    const groups = [['Starting', (p) => p.slot <= 11], ['Bench', (p) => p.slot === 12], ['Injured reserve', (p) => p.slot >= 13]];
    const n = st.order.length;
    const rows = groups.flatMap(([title, test]) => {
      const players = team.roster.filter(test).sort((a, b) => ctx.valueOf(b).ppg - ctx.valueOf(a).ppg);
      if (!players.length) return [];
      return [`<li class="grp">${title}</li>`, ...players.map((p) => {
        const v = ctx.valueOf(p);
        const back = ctx.returnOf(p);
        const status = p.injury && p.injury !== 'ACTIVE' ? SHORT[p.injury] || p.injury.replace(/_/g, ' ').toLowerCase() : back ? 'hurt' : '';
        const full = [p.injury && p.injury !== 'ACTIVE' ? p.injury.replace(/_/g, ' ').toLowerCase() : '', back ? `back about ${shortDate(back)}` : ''].filter(Boolean).join(', ');
        const chip = status ? `<span class="inj" title="${esc(full)}">${esc(status)}${back ? `<span class="when"> ${shortDate(back)}</span>` : ''}</span>` : '';
        const pick = st.picks.get(p.playerId);
        const tip = `${p.name}: ${v.ppg.toFixed(1)} points a game when he plays, plays about ${Math.round(v.rate * 100)}% of games${full ? `; ${full}` : ''}`;
        const body = `<span class="pn">${esc(p.name)}</span>${chip}<span class="pv">${v.ppg.toFixed(1)}<small class="pct"> ×${Math.round(v.rate * 100)}%</small></span>`;
        if (!pickable) return `<li class="prow" title="${esc(tip)}"><div class="pl static">${body}</div></li>`;
        const dest = pick && n > 2
          ? `<label class="dest">→ <select data-t="dest" data-id="${p.playerId}" aria-label="Where ${esc(p.name)} goes">${st.order.filter((id) => id !== team.id).map((id) => `<option value="${id}"${pick.to === id ? ' selected' : ''}>${esc(teamOf(id).name)}</option>`).join('')}</select></label>`
          : '';
        return `<li class="prow${pick ? ' picked' : ''}" title="${esc(tip)}"><label class="pl"><input type="checkbox" data-t="tick" data-id="${p.playerId}" data-team="${team.id}"${pick ? ' checked' : ''}>${body}</label>${dest}</li>`;
      })];
    });
    return `<ul class="rfit">${rows.join('')}</ul>`;
  }

  const topPlayers = (team, ctx) => [...team.roster].sort((a, b) => ctx.valueOf(b).ppg - ctx.valueOf(a).ppg).slice(0, 3).map((p) => p.name.split(' ').slice(-1)[0]).join(', ');

  /* ---------- Simulating the trade ---------- */

  const baseline = () => {
    const d = data();
    if (!st.baseline || st.baseline.ctx !== d.ctx || st.baseline.now !== d.now || st.baseline.dayDone !== d.dayDone) {
      st.baseline = { ctx: d.ctx, now: d.now, dayDone: d.dayDone, value: tradeBaseline({ ...d.ctx, now: d.now, dayDone: d.dayDone }) };
    }
    return st.baseline.value;
  };

  const movesKey = (moves) => JSON.stringify(moves.map((m) => [m.playerId, m.from, m.to]).sort());

  // The result for these picks if it has been worked out, else null (and it is worked out a moment later so
  // the screen does not freeze while you tick players)
  function simFor(moves) {
    const key = movesKey(moves);
    if (st.simResult?.key === key && st.simResult.ctx === data().ctx && st.simResult.pf === st.baseline?.value) return st.simResult.value;
    clearTimeout(st.simTimer);
    st.simTimer = setTimeout(() => {
      if (!st.sim || st.view !== 'build') return;
      const b = baseline();
      st.simResult = { key, ctx: data().ctx, pf: b, value: simulateTrade(b, moves) };
      render();
    }, 30);
    return null;
  }

  const nameIn = (rows, id) => rows.find((r) => r.id === id)?.name ?? `Team ${id}`;
  const riskIn = (rows, id, k) => rows.find((r) => r.id === id)?.[k] ?? 0;

  // "no worries city 53% → Hang Low 38%": who is projected last place now and after the trade
  function lastPlaceLine(wk, me) {
    const who = (id) => (id === me ? 'You' : nameIn(wk.rows, id));
    const from = `${esc(who(wk.loser0))} ${pct(riskIn(wk.rows, wk.loser0, 'risk0'))}`;
    const to = `${esc(who(wk.loser1))} ${pct(riskIn(wk.rows, wk.loser1, 'risk1'))}`;
    return wk.loser0 === wk.loser1 ? `${from} → ${pct(riskIn(wk.rows, wk.loser1, 'risk1'))}` : `${from} → <b>${to}</b>`;
  }

  function oddsTable(wk, me) {
    const who = (r) => (r.id === me ? `${esc(r.name)} <span class="youtag">you</span>` : esc(r.name));
    const rows = [...wk.rows].sort((a, b) => b.risk1 - a.risk1).map((r) => {
      const d = r.risk1 - r.risk0;
      const move = d > 0.02 ? `<span class="up">▲ ${Math.round(d * 100)}</span>` : d < -0.02 ? `<span class="down">▼ ${Math.round(-d * 100)}</span>` : '<span class="flat">–</span>';
      const last = r.id === wk.loser1 ? ' <span class="lastchip">last</span>' : '';
      return `<tr class="${r.id === wk.loser1 ? 'last' : ''}"><th scope="row">${who(r)}${last}</th><td class="num">${pct(r.risk0)}</td><td class="num strong">${pct(r.risk1)}</td><td class="num">${move}</td><td class="num dim">${Math.round(r.final0).toLocaleString('en-AU')} → ${Math.round(r.final1).toLocaleString('en-AU')}</td></tr>`;
    });
    const headline = wk.loser0 === wk.loser1
      ? `<b>${esc(nameIn(wk.rows, wk.loser1))}</b> stays the projected last place (${pct(riskIn(wk.rows, wk.loser0, 'risk0'))} → ${pct(riskIn(wk.rows, wk.loser1, 'risk1'))}).`
      : `<b>${esc(nameIn(wk.rows, wk.loser0))}</b> is no longer projected last. <b>${esc(nameIn(wk.rows, wk.loser1))}</b> is now (${pct(riskIn(wk.rows, wk.loser1, 'risk1'))}).`;
    return `<h4>${esc(wk.label)}</h4><p class="headline">${headline}</p>
      <div class="scroll"><table class="odds"><thead><tr><th scope="col">Team</th><th scope="col" class="num">Last now</th><th scope="col" class="num">After</th><th scope="col" class="num"></th><th scope="col" class="num">Projected pts</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function simSheet(result, me) {
    if (!result) return '<div class="verdict sim"><h3>If this trade happens</h3><p class="note">Simulating…</p></div>';
    const parts = [result.thisWeek, result.nextWeek].filter(Boolean);
    return `<div class="verdict sim"><h3>If this trade happens</h3>
      <p class="lede">Each team’s chance of finishing last, before and after the trade. “After” has the trade done: points already scored this week stay with the team that scored them, and players who move start on the new team’s bench today.</p>
      ${parts.map((wk) => oddsTable(wk, me)).join('')}
    </div>`;
  }

  /* ---------- Views ---------- */

  function signInView() {
    panel.innerHTML = signInHtml(account, league().teams);
    focusPin(panel);
  }

  function browseView(me) {
    const ctx = ctxOf();
    const others = league().teams.filter((t) => t.id !== me.id);
    panel.innerHTML = `<div class="fit">
      <p class="who">Signed in as <b>${esc(me.name)}</b>${me.owner ? ` (${esc(me.owner)})` : ''}. <button type="button" class="link" data-t="signout">Not you? Switch team</button></p>
      <div class="split">
        <section class="col mine"><h3>${esc(me.name)} <span class="youtag">you</span></h3>${rosterList(me, ctx, { pickable: false })}</section>
        <aside class="col"><h3>Trade with…</h3>
          <div class="cards" style="--rows:${others.length}">${others.map((t) => `<button type="button" class="team-card" data-t="open" data-id="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.owner)}</span><small>${esc(topPlayers(t, ctx))}</small></button>`).join('')}</div>
        </aside>
      </div>
    </div>`;
  }

  // The result for the picks so far: the pinned bar, the details panel and the text to copy
  function resultFor(me, teams, ctx) {
    const moves = [...st.picks].map(([playerId, m]) => ({ playerId, ...m }));
    const senders = new Set(moves.map((m) => m.from));
    if (moves.length < 2 || senders.size < 2) {
      const hint = st.order.length > 2 ? 'Tick players from at least two teams, and say where each one goes.' : 'Tick at least one player from each team to rate the trade.';
      return { line: `<span class="hint">${hint}</span>`, sheet: '', summary: '', notes: 0 };
    }
    const r = evaluateMultiTrade(ctx, teams, moves);
    const youGain = r.teams.find((t) => t.id === me.id)?.gain ?? 0;
    const active = r.teams.filter((t) => t.involved).sort((a, b) => b.gain - a.gain);
    const cls = (g) => (g < -2 ? 'neg' : 'pos');
    const name = (id) => (id === me.id ? 'You' : teamOf(id).name);
    const line = `${starRow(r.stars)} <b>${r.stars}</b> <span class="vlabel">${esc(r.label)}</span><span class="vgain">${active.map((t) => `${esc(name(t.id))} <b class="${cls(t.gain)}">${signed(t.gain)}</b>`).join(' · ')} <small>pts/week</small> <button type="button" class="link why" data-t="sheet">why?</button></span>`;

    const head = r.winnerId == null ? 'Dead even.' : teams.length > 2 ? `${esc(name(r.winnerId))} gain${r.winnerId === me.id ? '' : 's'} the most and ${esc(name(r.loserId))} ${r.loserId === me.id ? 'gain' : 'gains'} the least.` : r.winnerId === me.id ? 'You come out ahead.' : `${esc(name(r.winnerId))} comes out ahead.`;
    const lines = [];
    if (youGain < -2) lines.push(`<p class="warn">This costs you about ${Math.abs(youGain).toFixed(0)} points a week.</p>`);
    else if (active.length && active.every((t) => t.gain > 2)) lines.push('<p class="ok">Every team gains, so this helps everyone.</p>');
    for (const t of r.teams) if (t.mustDrop) lines.push(`<p class="warn">${esc(name(t.id))} would have ${t.mustDrop} too many players and have to drop ${t.mustDrop === 1 ? 'one' : t.mustDrop}.</p>`);
    for (const id of r.idle) lines.push(`<p class="note">${esc(teamOf(id).name)} isn’t in any swap yet. Tick a player to send to them, or remove the team.</p>`);
    for (const n of r.notes) lines.push(`<p class="note">${esc(n)}</p>`);

    const named = moves.map((m) => ({ ...m, name: teamOf(m.from).roster.find((p) => p.playerId === m.playerId)?.name ?? '?' }));
    const summary = teams.length === 2
      ? tradeSummary({ stars: r.stars, label: r.label, winner: r.winnerId == null ? null : r.winnerId === me.id ? 'a' : 'b', a: { gain: youGain }, b: { gain: r.teams.find((t) => t.id === teams[1].id).gain } }, { a: me.name, b: teams[1].name, give: named.filter((m) => m.from === me.id).map((m) => m.name), get: named.filter((m) => m.from === teams[1].id).map((m) => m.name) })
      : multiSummary(r, named);

    const leagueId = data().ctx.cfg.leagueId;
    const espn = leagueId ? `<a class="link" href="https://fantasy.espn.com/basketball/league?leagueId=${encodeURIComponent(leagueId)}" target="_blank" rel="noopener">Open the league in ESPN to make the trade</a>` : '';
    const why = explainMoves(ctx, teams, moves);
    const whyRows = why.rows.map((w) => `<tr><th scope="row">${esc(w.name)}<small>${esc(w.fromName === me.name ? 'yours' : w.fromName)} → ${esc(teamOf(w.to).name === me.name ? 'you' : teamOf(w.to).name)}</small></th><td class="num">${w.ppg.toFixed(1)}</td><td class="num">${Math.round(w.rate * 100)}%</td><td class="num strong">${w.perGame.toFixed(1)}</td><td class="num">${w.canPlay}${w.missed ? `<small>${w.gamesLeft} − ${w.missed} out</small>` : ''}</td><td class="num strong ${w.perWeek < 0 ? 'neg' : ''}">${w.perWeek >= 0 ? '+' : '−'}${Math.abs(w.perWeek).toFixed(1)}</td></tr>`).join('');
    const sheet = `<div class="verdict">
        <h3>${esc(r.label)}</h3>
        <p>${head}</p>
        <div class="gains">${active.map((t) => `<p><span>${esc(name(t.id))}</span><b class="${cls(t.gain)}">${signed(t.gain)}</b> points a week</p>`).join('')}</div>
        ${lines.join('')}
        <h4>Where the numbers come from</h4>
        <div class="why">${why.story.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
        <div class="split-gain">${active.map((t) => {
          const swap = why.swaps[t.id] ?? 0;
          const fit = t.gain - swap;
          return `<p><b>${esc(name(t.id))}</b> ${signed(t.gain)} a week = players ${signed(swap)}, lineup fit ${signed(fit)}</p>`;
        }).join('')}</div>
        <div class="scroll"><table class="odds whytable"><thead><tr><th scope="col">Player</th><th scope="col" class="num">Points a game when he plays</th><th scope="col" class="num">Plays</th><th scope="col" class="num">Per team game</th><th scope="col" class="num">Games he can play</th><th scope="col" class="num">Worth a week above a free agent</th></tr></thead><tbody>${whyRows}</tbody></table></div>
        <p class="note">A free agent is worth about ${why.replacement.toFixed(1)} points per team game${why.replacementFromData ? ' (the 6th best healthy free agent right now)' : ' (a typical level)'}.</p>
        <p class="actions">${espn}</p>
        <details><summary>How the stars are worked out</summary>
          <p class="note">Each player is valued by the points he is expected to score when he plays (his games so far, pulled toward ESPN’s preseason projection) times how often he plays. Each team’s best lineup is then compared for every remaining game day, before and after the trade, against what a free agent could give you${ctx.replacementFromData ? ' (using the real free-agent list)' : ' (a typical free agent)'}. The star rating is how unsure we are who really wins: 5 stars means it is too close to call, and fewer stars mean one side clearly wins. In a multi-way trade it compares the team that gains most with the one that gains least. Injuries can swing any trade, so these are odds, not a promise. This tool only judges a trade; make the real one in ESPN.</p>
        </details>
      </div>`;
    return { line, sheet, summary, notes: lines.filter((l) => /warn|note/.test(l)).length };
  }

  function builderView(me) {
    const ctx = ctxOf();
    const teams = st.order.map(teamOf).filter(Boolean);
    const n = teams.length;
    const result = resultFor(me, teams, ctx);
    st.last = result.summary;
    const valid = Boolean(result.summary);
    const moves = [...st.picks].map(([playerId, m]) => ({ playerId, ...m }));
    // Simulating: the odds with the trade done, shown in the bar and in full in the panel
    const sim = st.sim && valid ? simFor(moves) : null;
    const simLine = sim
      ? `<div class="simline">If traded, last place: ${[sim.thisWeek && `this week ${lastPlaceLine(sim.thisWeek, me.id)}`, sim.nextWeek && `a typical week ${lastPlaceLine(sim.nextWeek, me.id)}`].filter(Boolean).join(' · ')}</div>`
      : st.sim && valid ? '<div class="simline">Simulating…</div>' : '';
    const sheet = st.sheet === 'details' && result.sheet ? result.sheet : st.sheet === 'sim' && st.sim && valid ? simSheet(sim, me.id) : '';
    const spare = league().teams.filter((t) => !st.order.includes(t.id));
    const partnerChoices = league().teams.filter((t) => t.id !== me.id);
    const cols = teams
      .map((t, i) => {
        const head = i === 0
          ? `<h3>${esc(t.name)} <span class="youtag">you</span></h3>`
          : n === 2
            ? `<h3><select data-t="partner" aria-label="Team to trade with">${partnerChoices.map((o) => `<option value="${o.id}"${o.id === t.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></h3>`
            : `<h3>${esc(t.name)} <button type="button" class="link" data-t="remove" data-id="${t.id}">Remove</button></h3>`;
        return `<section class="tcol${i === 0 ? ' mine' : ''}">${head}${rosterList(t, ctx, { pickable: true })}</section>`;
      })
      .join('');
    panel.innerHTML = `<div class="fit build">
      <div class="tbar">
        <div class="topline">
          <button type="button" class="action ghost" data-t="cancel">✕ Cancel</button>
          <button type="button" class="action" data-t="copy"${result.summary ? '' : ' disabled'}>Copy summary</button>
          ${spare.length && n < MAX_TEAMS ? `<select class="multi" data-t="add" aria-label="Add a team for a multi-way trade"><option value="">${n === 2 ? '＋ Multi-way' : '＋ Add team'}</option>${spare.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>` : ''}
          <button type="button" class="action${st.sim ? ' on' : ''}" data-t="simulate" aria-pressed="${st.sim}"${valid ? '' : ' disabled'}>Simulate</button>
          ${st.sim && valid ? `<button type="button" class="action ghost" data-t="odds" aria-expanded="${st.sheet === 'sim'}">Odds ${st.sheet === 'sim' ? '▴' : '▾'}</button>` : ''}
          ${result.sheet ? `<button type="button" class="action ghost" data-t="sheet" aria-expanded="${st.sheet === 'details'}">Why &amp; details${result.notes ? ` (${result.notes})` : ''} ${st.sheet === 'details' ? '▴' : '▾'}</button>` : ''}
        </div>
        <div class="vline" aria-live="polite">${result.line}</div>
        ${simLine}
      </div>
      <div class="cols${n > 2 ? ' many' : ''}" style="--n:${n}">${cols}</div>
    </div>
    ${sheet ? `<div class="sheet" role="dialog" aria-label="${st.sheet === 'details' ? 'Trade details' : 'Simulated trade'}"><button type="button" class="closer" data-t="closesheet" aria-label="Close">✕ Close</button>${sheet}</div>` : ''}`;
  }

  function render() {
    if (!data().ctx) return;
    const me = account.team();
    const building = Boolean(me) && st.view === 'build' && st.order.length >= 2 && st.order.every(teamOf);
    document.body.classList.toggle('trading', building);
    if (!me) signInView();
    else if (building) builderView(me);
    else {
      st.view = 'browse';
      browseView(me);
    }
    fit();
  }

  // Make the workspace exactly as tall as the space left on screen, so nothing needs scrolling
  function fit() {
    const el = panel.querySelector('.fit');
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const height = window.visualViewport?.height ?? window.innerHeight;
    el.style.setProperty('--fit', `${Math.max(340, height - top - 8)}px`);
    const bar = panel.querySelector('.tbar');
    panel.style.setProperty('--bar-bottom', `${bar ? bar.getBoundingClientRect().bottom + 6 : 120}px`);
  }
  window.addEventListener("resize", () => panel.isConnected && fit());

  /* ---------- Actions ---------- */

  const defaultDest = (from) => {
    const i = st.order.indexOf(from);
    const n = st.order.length;
    return n === 2 ? st.order[1 - i] : st.order[(i + 1) % n];
  };

  // Re-render after a change, keeping keyboard focus where it was
  function redraw(focus) {
    render();
    if (focus) panel.querySelector(focus)?.focus({ preventScroll: true });
  }

  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-t]');
    if (!btn || !data().ctx) return;
    const act = btn.dataset.t;
    const id = Number(btn.dataset.id);
    if (act === 'signout') account.signOut();
    else if (act === 'open') {
      st.order = [account.team().id, id];
      st.picks.clear();
      st.view = 'build';
      render();
      window.scrollTo(0, 0);
      fit();
    } else if (act === 'cancel') {
      startOver();
      render();
    } else if (act === 'sheet') {
      st.sheet = st.sheet === 'details' ? (st.sim ? 'sim' : null) : 'details';
      redraw();
    } else if (act === 'closesheet') {
      st.sheet = null;
      redraw();
    } else if (act === 'odds') {
      st.sheet = st.sheet === 'sim' ? null : 'sim';
      redraw();
    } else if (act === 'simulate') {
      st.sim = !st.sim;
      st.sheet = st.sim ? 'sim' : st.sheet === 'sim' ? null : st.sheet;
      if (!st.sim) clearTimeout(st.simTimer);
      redraw();
    } else if (act === 'remove') {
      st.sheet = null;
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
    st.sheet = null; // any change to the trade puts the lineups back in reach; the bar keeps showing the result
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
    const before = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = before), 1800);
  }

  return { panel, render, reset, prefetch, state: st };
}
