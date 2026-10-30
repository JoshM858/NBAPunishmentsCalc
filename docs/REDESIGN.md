# Redesign: audit and plan

This is the Phase 1 report for turning Punishment Watch into an NBA 2K MyNBA-style fantasy front office.
It is written before the redesign touches any page, and updated with what was actually done at the end.

## 1. Audit

### Technology stack
- Frontend: plain HTML, CSS and JavaScript ES modules. No framework, no bundler, no build step (a rule from the original brief, kept).
- Server: one proxy for ESPN's fantasy API (`src/api.js`) that runs three ways from the same file: a dependency-free Node server (`src/server.js`, `npm start`), a Cloudflare Worker (`src/worker.js` or the single pasted file `dist/worker-dashboard.js`), and inside a GitHub Action that bakes a static snapshot for GitHub Pages (`scripts/build-snapshot.mjs`).
- Storage: **no database.** All league data comes live from ESPN. The only stored data is the trade block (Cloudflare KV, or `.data/board.json` on a PC) and a few browser `localStorage` keys (signed-in team, refresh timestamp, cached finished days).
- Auth: optional team PINs (`TEAM_PINS` secret) with a signed HttpOnly cookie. Without PINs the "login" is a team picker remembered on the device.
- Tests: 12 Node test files (`npm test`), all offline, plus scripts that test against the live league, the Cloudflare runtime (`workerd`) and a last-season backtest.

### Architecture
`ESPN API -> src/api.js (proxy, caching, errors) -> public/sources.js (api | snapshot | demo) -> public/pipeline.js (parse, rebuild weekly points) -> public/logic.js (pure scoring, weeks, odds model) -> UI`.
Separate pure engines sit beside it: `trade.js` (player value, lineup engine, stars, simulate), `suggest.js` (trade finder), `projection.js` (player projection).
The UI is `app.js` (shell, tabs, dashboard, recap, shame, game-day card) and `trade-ui.js` (trade workspace).

### Existing pages and features (all must survive)
| Today | Contents |
|---|---|
| This week | projected last place and its chance, weekly leaderboard, rank moves, per-team risk, game-day card (Victoria time, scoreboard status) |
| Day recap | live "so far" and final day results, climbers and fallers, player/dud of the day, rest-of-week outlook |
| Shame | every finished week's last place, running tally |
| Trade | sign-in (picker or PIN), side-by-side lineups, stars, multi-way, simulate odds, "why" explanation, copy summary |
| Footer | "check against ESPN season totals", data method, weeks source |
| Other | demo mode (`?demo`), setup/error screens, 5-second refresh limit, snapshot staleness banner, hidden teams, week start day, time zone |

### Data that exists, and data that does not
| The brief asks for | Real source in this league | Verdict |
|---|---|---|
| Player headshots, NBA team logos | ESPN CDN by the same player/team id | available |
| Age, jersey, height, weight | ESPN team rosters (30 calls, cached a day) | available |
| Fantasy average, last 7/15/30, projection, ownership %, ADP, injury, outlook | `kona_player_info` | available |
| Game logs (pts, reb, ast, stl, blk, to, min, fantasy points) | per-game rows from `kona_player_info` | available |
| Standings | season points, weekly points, weeks won/last | available, **but see below** |
| Wins, losses, win %, points against, streak | league type is `TOTAL_SEASON_POINTS`: ESPN reports no head-to-head matchups | **not applicable**: use weeks won, punishments, weekly rank history instead |
| Draft room | 112 picks, order, timer in `draftDetail` | history and board only; the draft is complete and ESPN runs live drafts |
| Submit trades, change lineups, pick in a draft | ESPN has no read-write API for these | **not possible**: the app rates and prepares, the manager acts in ESPN |
| Pending trades, completed trades | `mTransactions2` (no trades yet in this league) | completed trades shown when they exist; no pending proposals are visible to us |
| Schedule difficulty | no opponent ratings in ESPN's data | not shown; games per week is shown instead |
| Player "ratings" / attributes | none | **not invented**: only values calculated from real stats (percentiles, consistency, form) |

### Current design system
Wood-court theme (warm tan, navy, red), Big Shoulders + Barlow fonts, one 455-line stylesheet, card-style panels. It works but is the opposite of the target look.

### Reusable
All of `logic.js`, `pipeline.js`, `sources.js`, `trade.js`, `suggest.js`, `projection.js`, `src/*`, the snapshot builder, the PIN login, the refresh limit, the tests. The trade workspace behaviour (picks, destinations, simulate) moves into the new Trade Centre.

### Risks
1. **Scale.** About ten pages. Mitigation: shared components, one data layer, build and verify page by page with a commit per phase.
2. **Payload size.** A 400-player pool is 3.4 MB raw. Mitigation: stream it unparsed through the Worker (protects the free plan's 10 ms CPU), cache 10 minutes, slim in the browser, slimmed copy in the GitHub snapshot.
3. **Static (GitHub) mode** has no server: the pool and recent logs are baked into the snapshot; per-player history beyond the last 15 games and live bios need a server (shown honestly where missing).
4. **The Cloudflare single-file bundle** lists files explicitly. Mitigation: the bundler walks `public/` so new modules are never missed, with a test.
5. **Regressions to scoring/odds.** No change to `logic.js` scoring. The existing 12 test files must stay green throughout.
6. **Old links** (`#week`, `#recap`, `#shame`, `#trade`) must keep working: redirected by the router.

## 2. One architectural change, and why

`app.js` is a single 540-line file that owns tabs, rendering and state. Ten pages cannot live there. The change is **structure only**:
- `public/app.js` becomes the shell (load data, navigation, refresh, account).
- A hash router replaces the tab switcher (`#/players/123`, `#/transactions/block`), so filters and selected player survive back/forward and can be linked.
- Each page is a module in `public/pages/`, shared pieces are in `public/ui/` (table, charts, player header, badges).
- Data modules `players-data.js`, `standings.js`, `analytics.js` hold the pure calculations (testable).
No backend, data source, scoring or auth changes. No new dependencies.

## 3. Plan

| Phase | Work | Files |
|---|---|---|
| 2 Design system and shell | tokens (exact palette from the brief), type (Barlow Condensed + Inter), buttons, tables, panels, badges, stat bars, slots; global header, 7-section nav, contextual tabs, team selector, account, refresh; router | `css/*.css`, `index.html`, `app.js`, `ui/nav.js`, `ui/dom.js` |
| 3 Core | Dashboard, Players database (2K player-picker layout), Player profile, My Team; new routes `/api/players` (stream), `/api/player` (logs), `/api/bios`, draft view; snapshot gets pool and recent logs | `pages/dashboard.js players.js profile.js team.js`, `players-data.js`, `ui/table.js player.js`, `src/api.js` |
| 4 Rest | League, Compare, Prospects/Waivers, Trade Centre (3-column slots, Target list / Trading block / Untouchables, finder, ideas, simulate), Draft room, Matchups, Analytics, Transactions | `pages/*.js`, `standings.js analytics.js`, `ui/charts.js` |
| 5 Verify | all tests, screenshots at desktop, tablet and phone for every page, Cloudflare runtime, GitHub snapshot, README, summary | `test/*`, `scripts/*`, `README.md` |

## 4. What was built (status after Phase 5)

| Phase | Done |
|---|---|
| 2 Design system and shell | `public/css/` tokens (exact palette from the brief), base, components, shell, pages; Barlow Condensed + Inter; hash router (`ui/router.js`, old `#week/#recap/#shame/#trade` links redirect); `app.js` is now only the shell; shared sign-in (`account.js`, `ui/signin.js`); seven-section navigation with contextual tabs |
| 3 Core | `/api/players` (streamed pool), `/api/player` (one player, 40 games, last season), `/api/bios` (one NBA team per call); `players-data.js`, `players-store.js`, `lineup.js`; Dashboard, Players database (2K picker layout), Player profile, My Team; snapshot publishes pool and bios |
| 4 Remaining | League standings, Punishments, Draft board; Compare; Free agents (waiver sorts); Transactions with Trade centre (existing workspace restyled, 2K-style trade-item slots, Ideas and Proj buttons), Trade finder, Trade block (Target list, Trading block, Untouchables), Activity; Matchups with week schedule; Analytics with five charts |
| Extras asked for during the work | Confidence meter and O-SHIT meter (`meters.js`); first-run colour chooser with wheel, picker and hex at the same time (`theme.js`, `ui/theme-ui.js`) |
| 5 Verify | see below |

### Deliberate differences from the brief
- **No wins, losses, win %, points against or streaks** in standings: ESPN reports none for a total-points league. Teams are ranked by season points, with weeks won and punishments.
- **"Prospects"** has no data source (ESPN's feed has no draft-prospect list), so that page is the Free agents tab with the waiver sorts the brief lists (average, recent form, improvement, schedule, position, availability).
- **Draft Room** is a record of the finished draft (board, best and worst picks). ESPN has no way for other apps to draft or to submit trades or lineups, so My Team and the Trade centre advise and the manager acts in ESPN.
- **No invented ratings.** Percentiles, form, consistency and the meters are computed from real stats and each says how.
- **The trade workspace keeps its side-by-side, no-scroll lineups** (asked for earlier) and adds the 2K-style "You send / They send" slots on top of it instead of replacing it with three empty columns.
- No new dependencies; no build step.
