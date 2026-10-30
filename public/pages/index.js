// The pages, in navigation order. A page is { id, label, tabs?, render(app, el, route) }.
import dashboard from './dashboard.js';
import league from './league.js';
import matchups from './matchups.js';
import transactions from './transactions.js';

export const PAGES = [dashboard, league, transactions, matchups];
