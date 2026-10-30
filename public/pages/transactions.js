// Transactions: the trade workspace (rate, simulate, compare), the trade block, the trade finder and the activity feed.
import { renderActivity } from './activity.js';
import { renderBlock } from './block.js';
import { renderFinder } from './finder.js';

export default {
  id: 'transactions',
  label: 'Transactions',
  tabs: [{ id: '', label: 'Trade centre' }, { id: 'finder', label: 'Trade finder' }, { id: 'block', label: 'Trade block' }, { id: 'activity', label: 'Activity' }],
  async render(app, el, route) {
    if (route.tab === 'finder') return renderFinder(app, el, route);
    if (route.tab === 'block') return renderBlock(app, el, route);
    if (route.tab === 'activity') return renderActivity(app, el, route);
    el.replaceChildren(app.trade.panel);
    app.trade.render();
  },
};
