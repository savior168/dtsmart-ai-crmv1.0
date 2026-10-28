import assert from 'node:assert/strict';
import { performanceOwnerFilter, summarizePiPerformance } from '../lib/reports/pi-performance.ts';
import { businessRange } from '../lib/reports/business-date-range.ts';

const orders = [
  { id: 'usd', order_number: 'U', customer_id: 'c1', customer_name: 'A', sales_user_id: 's1', currency: 'USD', total_amount: 100, confirmed_at: '2026-10-28T00:00:00Z', items: [{ item_name: 'Screen', brand: '', model: '', quantity: 2, amount: 100 }] },
  { id: 'cny', order_number: 'C', customer_id: 'c2', customer_name: 'B', sales_user_id: 's2', currency: 'CNY', total_amount: 600, confirmed_at: '2026-10-28T00:00:00Z', items: [{ item_name: 'Screen', brand: '', model: '', quantity: 3, amount: 600 }] },
  { id: 'old', order_number: 'O', customer_id: 'c3', customer_name: 'C', sales_user_id: 's1', currency: 'USD', total_amount: 999, confirmed_at: '2026-10-28T00:00:00Z', items: [] },
  { id: 'cancel', order_number: 'X', customer_id: 'c4', customer_name: 'D', sales_user_id: 's1', currency: 'USD', total_amount: 888, confirmed_at: '2026-10-28T00:00:00Z', items: [] },
];
const metadata = [
  { id: 'usd', total_cny: null, fx_rate_cny_to_payment: null, archived_at: null, status: 'CONFIRMED' },
  { id: 'cny', total_cny: 600, fx_rate_cny_to_payment: 1, archived_at: null, status: 'CONFIRMED' },
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
const own = summarizePiPerformance(orders, metadata, 's1');
assert.equal(own.totals.orders, 1);
assert.equal(own.totals.usd, 100);
assert.equal(own.totals.cny, 0);
assert.deepEqual(performanceOwnerFilter('SALES', 's1', 's1'), ['s1']);
assert.deepEqual(performanceOwnerFilter('SUPERVISOR', 'manager', 's2'), ['s2']);
assert.deepEqual(performanceOwnerFilter('SUPERVISOR', 'manager', null), ['manager']);
assert.deepEqual(performanceOwnerFilter('ADMIN', 'admin', null), null);
assert.deepEqual(businessRange('2026-10-28', '2026-10-28'), {
  from: '2026-10-27T16:00:00.000Z',
  to: '2026-10-28T16:00:00.000Z',
});
console.log('PI performance summary: PASS');
