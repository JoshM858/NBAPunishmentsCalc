// The pages, in navigation order. A page is { id, label, tabs?, render(app, el, route) }.
import analytics from './analytics.js';
import dashboard from './dashboard.js';
import league from './league.js';
import matchups from './matchups.js';
import players from './players.js';
import team from './team.js';
import transactions from './transactions.js';

export const PAGES = [dashboard, team, players, league, transactions, matchups, analytics];
