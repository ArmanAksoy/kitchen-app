const fs = require('fs');
const path = require('path');

/** Pulls the pure logic block out of index.html and runs it under Node. */
function loadK() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('const K = (() => {');
  const end = html.indexOf('\n})();', start);
  if (start < 0 || end < 0) throw new Error('Could not find the K block in index.html');
  // Run in this realm (not a vm sandbox) so assert.deepStrictEqual sees plain objects.
  return new Function(html.slice(start, end + 6) + '\nreturn K;')();
}

/**
 * What the AI is expected to return for a typical Maxi receipt.
 * 8 lines add up to 35.39, taxes 1.05, total 36.44.
 */
function sampleReceipt() {
  return {
    shop: 'Maxi', shop_type: 'grocery', location: 'Maxi Côte-des-Neiges, 6825 ch. de la Côte-des-Neiges', date: '2026-10-02', time: '18:07',
    lines: [
      { type: 'item', raw: 'PC YOG GREC 0% 750G', name: 'Yogourt grec 0% PC 750 g', code: '06038312345', qty: 2, unit: 'unit', unit_price: 4.99, total: 9.98, pack_size: 750, pack_unit: 'g', unreadable: false },
      { type: 'item', raw: 'SN POIS CHICHES', name: 'Pois chiches Sans Nom', code: '06038366414', qty: 3, unit: 'unit', unit_price: 1.29, total: 3.87, pack_size: null, pack_unit: null, unreadable: false },
      { type: 'item', raw: 'BANANES', name: 'Bananes', code: '4011', qty: 0.765, unit: 'kg', unit_price: 1.52, total: 1.16, pack_size: null, pack_unit: null, unreadable: false },
      { type: 'item', raw: 'POULET HT CUISSE', name: 'Hauts de cuisse de poulet', code: '', qty: 1.204, unit: 'kg', unit_price: 8.8, total: 10.6, pack_size: null, pack_unit: null, unreadable: false },
      { type: 'item', raw: 'OEUFS GROS 12', name: 'Oeufs gros, 12', code: '06038300001', qty: 1, unit: 'unit', unit_price: 4.49, total: 4.49, pack_size: 12, pack_unit: 'unit', unreadable: false },
      { type: 'fee', raw: 'CONSIGNE', name: 'Consigne', code: '', qty: 1, unit: 'unit', unit_price: 0.3, total: 0.3, pack_size: null, pack_unit: null, unreadable: false },
      { type: 'discount', raw: 'RABAIS PC OPTIMUM', name: 'Rabais PC Optimum', code: '', qty: 1, unit: 'unit', unit_price: null, total: 2, pack_size: null, pack_unit: null, unreadable: false },
      { type: 'item', raw: 'ESSUIE-TOUT 6RL', name: 'Essuie-tout, 6 rouleaux', code: '06038388888', qty: 1, unit: 'unit', unit_price: 6.99, total: 6.99, pack_size: null, pack_unit: null, unreadable: false }
    ],
    taxes: [{ name: 'TPS', amount: 0.35 }, { name: 'TVQ', amount: 0.7 }],
    subtotal: 35.39, total: 36.44
  };
}

module.exports = { loadK, sampleReceipt };
