import assert from "node:assert/strict";
import { calculatePiFees } from "../lib/pi-fees.ts";

const input = {
  last_balance: { source: "CNY", amount: 50 },
  discount: { source: "PAYMENT", amount: 1 },
  other: { source: "CNY", amount: 20 },
  paypal_rate_percent: 5,
};
const result = calculatePiFees(100, 20, 10, 0.2, "PayPal", input);
assert.deepEqual(result.lastBalance, { cny: 50, payment: 10 });
assert.deepEqual(result.discount, { cny: 5, payment: 1 });
assert.deepEqual(result.other, { cny: 20, payment: 4 });
assert.deepEqual(result.paypalFee, { cny: 8.75, payment: 1.75 });
assert.equal(result.totalCny, 183.75);
assert.equal(result.totalPayment, 36.75);
assert.equal(calculatePiFees(100, 20, 0, 0.2, "T/T Bank Transfer", input).paypalFee.payment, 0);
assert.throws(() => calculatePiFees(1, 1, 0, 1, "PayPal", { ...input, discount: { source: "CNY", amount: 100 } }), /折扣不得超过/);
assert.throws(() => calculatePiFees(1, 1, 0, 1, "PayPal", { ...input, paypal_rate_percent: 101 }), /PayPal/);
console.log("PI dual-currency fee calculations passed");
