// Transactions: the trade workspace (rate, simulate and compare trades). More tabs arrive with the Trade Centre.
export default {
  id: 'transactions',
  label: 'Transactions',
  render(app, el) {
    el.replaceChildren(app.trade.panel);
    app.trade.render();
  },
};
