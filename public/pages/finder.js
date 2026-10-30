// Trade finder: pick the players you would move (and anyone you want), and it searches every other team for offers
// where neither side's weekly points or chance of finishing last move much. The search is in suggest.js.
import { suggestTrades, FINDER } from '../suggest.js';
import { findLoserTrades } from '../wishlose.js';
import { tradeBaseline, tradeSummary } from '../trade.js';
import { esc, fmt1, panel, pct, signed, starRow } from '../ui/dom.js';
import { headshot } from '../ui/player.js';
import { link } from '../ui/router.js';
import { focusPin, signInClick, signInHtml, signInSubmit } from '../ui/signin.js';

const fs = { mode: 'trades', benefit: null, target: '', loseResult: null, give: new Set(), want: new Set(), partner: '', risk: FINDER.maxRisk, result: null, running: false, progress: null, wantSeed: null };
const mv = (r) => (r ? `${pct(r.before)} → ${pct(r.after)}` : '–');
const TIERS = { 'win-win': ['Win-win', 'good'], balanced: ['Balanced', 'accent'], closest: ['Near miss', 'warn'] };

export async function renderFinder(app, el, route) {
  const me = app.account.team();
  if (!me) {
    el.innerHTML = signInHtml(app.account, app.ctx.league.teams, 'to find trades for your players');
    el.onclick = (e) => signInClick(e, app.account);
    el.onsubmit = (e) => signInSubmit(e, app.account);
    focusPin(el);
    return;
  }
  const teams = app.ctx.league.teams;
  const others = teams.filter((t) => t.id !== me.id);
  const [tctx, pool] = await Promise.all([app.tradeContext(), app.store.get().catch(() => null)]);
  if (app.route !== route) return;

  // Arriving from a player's "Trade ideas" button: ask for him and look straight away
  const wantParam = Number(route.query.get('want'));
  const arrived = wantParam && fs.wantSeed !== wantParam;
  if (arrived) {
    fs.wantSeed = wantParam;
    fs.want = new Set([wantParam]);
    fs.give = new Set();
    fs.partner = '';
    fs.result = null;
  }

  const byId = (id) => pool?.byId.get(id);
  const ppg = (p) => tctx.valueOf(p).ppg;
  const mine = [...me.roster].sort((a, b) => ppg(b) - ppg(a));
  const theirs = others.flatMap((t) => t.roster.map((p) => ({ ...p, owner: t }))).sort((a, b) => ppg(b) - ppg(a));
  const nameOf = (id) => teams.flatMap((t) => t.roster).find((p) => p.playerId === id)?.name || `Player ${id}`;

  const row = (p, set, key, sub) => `<label class="pl"><input type="checkbox" data-set="${key}" data-id="${p.playerId}"${set.has(p.playerId) ? ' checked' : ''}><span class="pn">${esc(p.name)}</span><span class="note">${esc(sub || '')}</span><span class="pv">${fmt1(ppg(p))}</span></label>`;
  const teamName = (id) => teams.find((t) => t.id === id)?.name || `Team ${id}`;
  const benefit = fs.benefit && teams.some((t) => t.id === fs.benefit) ? fs.benefit : me.id;
  const benefitName = teamName(benefit);
  const idea = (i, n) => {
    const [tierLabel, tierCls] = TIERS[i.tier] || TIERS.closest;
    const summary = tradeSummary({ stars: i.stars, label: i.label, winner: i.gains.me === i.gains.them ? null : i.gains.me > i.gains.them ? 'a' : 'b', a: { gain: i.gains.me }, b: { gain: i.gains.them } }, { a: benefitName, b: i.partnerName, give: i.give.map((p) => p.name), get: i.get.map((p) => p.name) });
    return `<article class="idea">
      <header><span class="badge ${tierCls}">${tierLabel}</span><b>${esc(i.partnerName)}</b>${starRow(i.stars)}<span class="vlabel">${esc(i.label)}</span></header>
      <div class="idea-body">
        <div><span class="note">You give</span>${i.give.map((p) => `<p><a class="plink" href="${link('players', p.playerId)}"><b>${esc(p.name)}</b></a></p>`).join('')}</div>
        <div class="idea-arrow" aria-hidden="true">⇄</div>
        <div><span class="note">You get</span>${i.get.map((p) => `<p><a class="plink" href="${link('players', p.playerId)}"><b>${esc(p.name)}</b></a></p>`).join('')}</div>
      </div>
      <p class="idea-gains">${esc(benefitName)} <b class="${i.gains.me < -2 ? 'neg' : 'pos'}">${signed(i.gains.me)}</b> · ${esc(i.partnerName)} <b class="${i.gains.them < -2 ? 'neg' : 'pos'}">${signed(i.gains.them)}</b> <small>points a week</small></p>
      ${i.risk ? `<p class="note">Chance of finishing last (${i.risk.me.week ? 'this week' : 'a typical week'}): you ${mv(i.risk.me.week ?? i.risk.me.typical)}, ${esc(i.partnerName)} ${mv(i.risk.them.week ?? i.risk.them.typical)}</p>` : ''}
      ${i.effect ? `<p class="note">Chance ${esc(teamName(Number(fs.target)))} finish last (${i.effect.label.startsWith('Rest') ? 'this week' : 'a typical week'}): <b>${pct(i.effect.target.before)} → ${pct(i.effect.target.after)}</b> · ${esc(teamName(benefit))}: ${pct(i.effect.me.before)} → ${pct(i.effect.me.after)}</p>` : ''}
      ${i.reasons.length ? `<ul class="movers">${i.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      ${i.why ? `<p class="note">${esc(i.why)}</p>` : ''}
      <p class="idea-actions">${benefit === me.id ? `<button type="button" class="btn primary sm" data-open="${n}">Open in trade centre</button> ` : ''}<button type="button" class="btn sm" data-copy="${n}">Copy offer</button></p>
      <textarea hidden data-summary="${n}">${esc(summary)}</textarea>
    </article>`;
  };

  const resultHtml = () => {
    if (fs.running) {
      const p = fs.progress;
      return panel('Searching…', `<p class="lede">${esc(p?.label || 'Starting')} (step ${p?.stage ?? 1} of 4)</p><div class="meter"><span style="width:${((p?.stage ?? 1) / 4) * 100}%"></span></div><p class="note" style="margin-top:8px">This takes a few seconds: it checks thousands of combinations and runs the exact lineup maths on the best ones.</p>`);
    }
    const r = fs.mode === 'lose' ? fs.loseResult : fs.result;
    if (!r) return '';
    const list = r.ideas.length ? r.ideas : r.closest || [];
    const heading = r.ideas.length ? `${r.ideas.length} offer${r.ideas.length === 1 ? '' : 's'} found` : 'No offer fits those rules';
    const lead = fs.mode === 'lose' && (r.ideas.length || list.length) ? `<p class="lede">Trades for ${esc(benefitName)} with the other teams (never with ${esc(teamName(Number(fs.target)))}) that make ${esc(teamName(Number(fs.target)))} likelier to finish last, best first. A trade makes its partner stronger, which leaves ${esc(teamName(Number(fs.target)))} further behind. Shifts are small: that is what a fair trade can do.</p>` : '';
    return panel(heading, `${lead}${r.notes.length ? `<ul class="movers">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${list.length ? `${r.ideas.length ? '' : `<p class="lede">${fs.mode === 'lose' ? 'The closest trades, which barely move the odds:' : 'Here are the nearest misses, with the reason each one fell short.'}</p>`}<div class="ideas">${list.map((i, n) => idea(i, n)).join('')}</div>` : (fs.mode === 'lose' ? '' : '<p class="empty" style="padding:0">Nothing came close. Try offering more players, widening the allowed shift, or leaving the partner open.</p>')}
      <p class="note" style="margin-top:12px">Checked ${r.tried.toLocaleString('en-AU')} combinations. Your untouchables are never offered. Judging only: make the real trade in ESPN.</p>`);
  };

  const losePanel = () => `<section class="panel"><header class="panel-h"><h2>Make a team lose</h2></header><div class="panel-b">
      <p class="lede">Choose who benefits and which team you want to finish last. It searches trades for the beneficiary with every other team (not the one you want to lose) that make that team likelier to finish last, without costing the beneficiary points or raising their own chance of finishing last.</p>
      <div class="filters flat" style="padding-left:0">
        <label class="field"><span>Who benefits</span><select data-f="benefit">${teams.map((t) => `<option value="${t.id}"${t.id === benefit ? ' selected' : ''}>${esc(t.name)}${t.id === me.id ? ' (you)' : ''}</option>`).join('')}</select></label>
        <label class="field"><span>Who should finish last</span><select data-f="target"><option value="">Choose a team</option>${teams.filter((t) => t.id !== benefit).map((t) => `<option value="${t.id}"${String(t.id) === String(fs.target) ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        <button type="button" class="btn primary" data-runlose${fs.running || !fs.target ? ' disabled' : ''}>${fs.running ? 'Searching…' : 'Find trades'}</button>
      </div></div></section>`;

  const draw = () => {
    el.innerHTML = `<div class="grid">
      <div>${`<div class="seg" role="group" aria-label="Finder mode"><button type="button" data-mode="trades" aria-pressed="${fs.mode === 'trades'}">Find trades</button><button type="button" data-mode="lose" aria-pressed="${fs.mode === 'lose'}">Make a team lose</button></div>`}</div>
      ${fs.mode === 'lose' ? losePanel() : `<section class="panel"><header class="panel-h"><h2>Trade finder</h2><span class="note">${esc(me.name)}</span></header><div class="panel-b">
        <p class="lede">Tick the players you would move. Optionally tick players you want from other teams. It looks for offers that help both sides, or at least don’t hurt either much, without changing anyone’s chance of finishing last by more than the limit.</p>
        <div class="grid cols-2">
          <div><h4 class="mini-h">Players I’d move</h4><div class="pick-box">${mine.map((p) => row(p, fs.give, 'give', byId(p.playerId)?.pos.join('/'))).join('')}</div></div>
          <div><h4 class="mini-h">Players I want (optional)</h4><div class="pick-box">${theirs.slice(0, 60).map((p) => row(p, fs.want, 'want', `${p.owner.name}`)).join('')}</div></div>
        </div>
        <div class="filters flat" style="padding-left:0">
          <label class="field"><span>Only trade with</span><select data-f="partner"><option value="">Any team</option>${others.map((t) => `<option value="${t.id}"${String(t.id) === String(fs.partner) ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Largest shift in anyone’s last-place chance</span><select data-f="risk">${[[0.03, '3 points (tight)'], [0.06, '6 points (standard)'], [0.1, '10 points (loose)']].map(([v, l]) => `<option value="${v}"${v === fs.risk ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <button type="button" class="btn primary" data-run${fs.running || (!fs.give.size && !fs.want.size) ? ' disabled' : ''}>${fs.running ? 'Searching…' : 'Find trades'}</button>
        </div>
      </div></section>`}
      <div id="fd-results">${resultHtml()}</div>
    </div>`;
  };

  async function run() {
    fs.running = true;
    fs.result = null;
    fs.progress = { stage: 1, label: 'Starting' };
    draw();
    let boards = new Map();
    if (app.src.kind === 'api') {
      try {
        const b = await (await fetch('api/board', { cache: 'no-store' })).json();
        boards = new Map(Object.entries(b.teams || {}).map(([id, rec]) => [Number(id), rec]));
      } catch {}
    }
    const input = { ...app.ctx, now: app.src.now(), dayDone: app.boardDone() };
    try {
      fs.result = await suggestTrades({
        ctx: tctx, teams, meId: me.id, give: [...fs.give], want: [...fs.want], partnerId: fs.partner ? Number(fs.partner) : null, boards,
        baseline: () => (fs.base ||= tradeBaseline(input)), maxRisk: fs.risk, limit: 6,
        onProgress: (p) => { fs.progress = p; if (app.route === route) el.querySelector('#fd-results').innerHTML = resultHtml(); },
      });
    } catch (err) {
      fs.result = { ideas: [], closest: [], notes: [`The search failed: ${err.message}`], tried: 0 };
    }
    fs.running = false;
    if (app.route === route) draw();
  }

  async function runLose() {
    fs.running = true;
    fs.loseResult = null;
    fs.progress = { stage: 1, label: 'Starting' };
    draw();
    const input = { ...app.ctx, now: app.src.now(), dayDone: app.boardDone() };
    try {
      fs.loseResult = await findLoserTrades({
        ctx: tctx, teams, beneficiaryId: benefit, targetId: Number(fs.target), baseline: () => (fs.base ||= tradeBaseline(input)),
        onProgress: (p) => { fs.progress = { stage: p.stage, label: p.label }; if (app.route === route) el.querySelector('#fd-results').innerHTML = resultHtml(); },
      });
    } catch (err) {
      fs.loseResult = { ideas: [], notes: [`The search failed: ${err.message}`], tried: 0 };
    }
    fs.running = false;
    if (app.route === route) draw();
  }

  el.onchange = (e) => {
    const t = e.target;
    if (t.dataset.set) {
      const set = fs[t.dataset.set];
      const id = Number(t.dataset.id);
      t.checked ? set.add(id) : set.delete(id);
      el.querySelector('[data-run]').disabled = fs.running || (!fs.give.size && !fs.want.size);
    } else if (t.dataset.f === 'benefit') {
      fs.benefit = Number(t.value);
      if (String(fs.target) === t.value) fs.target = '';
      draw();
    } else if (t.dataset.f === 'target') {
      fs.target = t.value;
      el.querySelector('[data-runlose]').disabled = fs.running || !fs.target;
    } else if (t.dataset.f === 'partner') fs.partner = t.value;
    else if (t.dataset.f === 'risk') fs.risk = Number(t.value);
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) { fs.mode = b.dataset.mode; return draw(); }
    if (b.dataset.runlose != null && !fs.running) return runLose();
    if (b.dataset.run != null && !fs.running) return run();
    const cur = fs.mode === 'lose' ? fs.loseResult : fs.result;
    const list = cur && (cur.ideas.length ? cur.ideas : cur.closest || []);
    if (b.dataset.open != null && list) {
      const i = list[Number(b.dataset.open)];
      if (benefit !== me.id) return; // the builder only works for the signed-in team
      app.trade.open(i.partnerId, { give: i.give.map((p) => p.playerId), get: i.get.map((p) => p.playerId) });
      location.hash = link('transactions');
    } else if (b.dataset.copy != null) {
      const text = el.querySelector(`[data-summary="${b.dataset.copy}"]`).value;
      try { await navigator.clipboard.writeText(text); } catch { const ta = el.querySelector(`[data-summary="${b.dataset.copy}"]`); ta.hidden = false; ta.select(); document.execCommand('copy'); ta.hidden = true; }
      const before = b.textContent;
      b.textContent = 'Copied!';
      setTimeout(() => (b.textContent = before), 1600);
    }
  };

  draw();
  if (arrived) run();
}
