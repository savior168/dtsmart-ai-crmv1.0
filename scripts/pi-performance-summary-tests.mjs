import assert from 'node:assert/strict';
import { performanceOwnerFilter, summarizePiPerformance } from '../lib/reports/pi-performance.ts';
import { businessRange } from '../lib/reports/business-date-range.ts';

const orders = [
  { id: 'usd', order_number: 'U', customer_id: 'c1', customer_name: 'A', sales_user_id: 's1', currency: 'USD', total_amount: 100, confirmed_at: '2026-10-28T00:00:00Z', items: [{ item_name: 'Screen', brand: '', model: '', quantity: 2, amount: 100, unit_price_cny: null }] },
  { id: 'cny', order_number: 'C', customer_id: 'c2', customer_name: 'B', sales_user_id: 's2', currency: 'CNY', total_amount: 600, confirmed_at: '2026-10-28T00:00:00Z', items: [{ item_name: 'Screen', brand: '', model: '', quantity: 3, amount: 600, unit_price_cny: 200 }] },
  { id: 'old', order_number: 'O', customer_id: 'c3', customer_name: 'C', sales_user_id: 's1', currency: 'USD', total_amount: 999, confirmed_at: '2026-10-28T00:00:00Z', items: [] },
  { id: 'cancel', order_number: 'X', customer_id: 'c4', customer_name: 'D', sales_user_id: 's1', currency: 'USD', total_amount: 888, confirmed_at: '2026-10-28T00:00:00Z', items: [] },
];
const metadata = [
  { id: 'usd', total_cny: null, fx_rate_cny_to_payment: null, archived_at: null, status: 'WAITING_STOCK' },
  { id: 'cny', total_cny: 600, fx_rate_cny_to_payment: 1, archived_at: null, status: 'READY_TO_SHIP' },
  { id: 'old', total_cny: 999, fx_rate_cny_to_payment: 0.15, archived_at: '2026-10-28T00:00:00Z', status: 'CONFIRMED' },
  { id: 'cancel', total_cny: 888, fx_rate_cny_to_payment: 0.15, archived_at: null, status: 'CANCELLED' },
];
const all = summarizePiPerformance(orders, metadata, null);
assert.equal(all.totals.orders, 2);
assert.equal(all.totals.cny, 600);
assert.equal(all.totals.usd, 100);
assert.equal(all.totals.missing_cny, 1);
assert.equal(all.totals.missing_usd, 1);
assert.equal(all.products[0].quantity, 5);
assert.equal(all.products[0].cny, 600);
assert.equal(all.products[0].usd, 100);
assert.equal(all.products[0].missing_cny, 1);
assert.equal(all.products[0].missing_usd, 1);
const own = summarizePiPerformance(orders, metadata, 's1');
assert.equal(own.totals.orders, 1);
assert.equal(own.totals.usd, 100);
assert.equal(own.totals.cny, 0);
assert.deepEqual(performanceOwnerFilter('SALES', 's1', 's1'), ['s1']);
assert.deepEqual(performanceOwnerFilter('SUPERVISOR', 'manager', 's2'), ['s2']);
assert.deepEqual(performanceOwnerFilter('SUPERVISOR', 'manager', null), ['manager']);
assert.deepEqual(performanceOwnerFilter('ADMIN', 'admin', null), null);
const evaRows = [
  { id: 'eva-cny', order_number: 'PI-RMB', customer_id: 'customer', customer_name: 'Customer', sales_user_id: 'eva', currency: 'CNY', total_amount: 27000, confirmed_at: '2026-10-26T03:38:14Z', items: [{ item_name: 'Screen', brand: 'B', model: 'M', quantity: 10, amount: 27000, unit_price_cny: 2700 }] },
  { id: 'eva-usd', order_number: 'PI-USD', customer_id: 'customer', customer_name: 'Customer', sales_user_id: 'eva', currency: 'USD', total_amount: 3000, confirmed_at: '2026-10-13T03:48:40Z', items: [{ item_name: 'Screen', brand: 'B', model: 'M', quantity: 10, amount: 3000, unit_price_cny: null }] },
];
const evaMetadata = [
  { id: 'eva-cny', total_cny: 27000, fx_rate_cny_to_payment: 1, archived_at: null, status: 'READY_TO_SHIP' },
  { id: 'eva-usd', total_cny: null, fx_rate_cny_to_payment: null, archived_at: null, status: 'WAITING_STOCK' },
];
const evaPerformance = summarizePiPerformance(evaRows, evaMetadata, 'eva');
assert.equal(evaPerformance.totals.orders, 2, '主管本人已提交备货的PI必须计入有效业绩单数');
assert.equal(evaPerformance.totals.cny, 27000, '人民币PI金额必须计入人民币汇总');
assert.equal(evaPerformance.totals.usd, 3000, '美元PI金额必须计入美元汇总');
assert.equal(evaPerformance.totals.missing_cny, 1, '缺少历史换算快照的美元单不得伪算人民币');
assert.equal(evaPerformance.totals.missing_usd, 1, '缺少历史换算快照的人民币单不得伪算美元');
assert.equal(evaPerformance.customers[0].order_count, 2, '客户业绩排名应覆盖同客户各币种PI');
assert.deepEqual(businessRange('2026-10-28', '2026-10-28'), {
  from: '2026-10-27T16:00:00.000Z',
  to: '2026-10-28T16:00:00.000Z',
});
console.log('PI performance summary: PASS');
