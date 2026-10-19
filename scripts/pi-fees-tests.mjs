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
const example = calculatePiFees(2860, 428.7, 680, 0.15, "PayPal", {
  last_balance: { source: "CNY", amount: 120 },
  discount: { source: "PAYMENT", amount: 6 },
  other: { source: "CNY", amount: 10 },
  paypal_rate_percent: 5,
});
assert.deepEqual(example.lastBalance, { cny: 120, payment: 18 }, "未付尾款应加收");
assert.deepEqual(example.discount, { cny: 40, payment: 6 }, "外币折扣应换算后扣减");
assert.deepEqual(example.other, { cny: 10, payment: 1.5 }, "其他费用应加收");
assert.deepEqual(example.paypalFee, { cny: 181.5, payment: 27.21 }, "PayPal 百分比应基于折扣后的金额加收");
assert.equal(example.totalCny, 3811.5);
assert.equal(example.totalPayment, 571.41);
assert.throws(() => calculatePiFees(100, 20, 0, 0.2, "PayPal", { ...input, other: { source: "CNY", amount: -1 } }), /非负/);
assert.throws(() => calculatePiFees(1, 1, 0, 1, "PayPal", { ...input, discount: { source: "CNY", amount: 100 } }), /折扣不得超过/);
assert.throws(() => calculatePiFees(1, 1, 0, 1, "PayPal", { ...input, paypal_rate_percent: 101 }), /PayPal/);
console.log("PI dual-currency fee calculations passed");
