import assert from "node:assert/strict";
import { linkedPiUnitPrices, roundPiMoney } from "../lib/pi-line-currency.ts";

assert.deepEqual(linkedPiUnitPrices("100.00", "CNY", 0.15), { cny: "100.00", payment: "15.00" });
assert.deepEqual(linkedPiUnitPrices("15.00", "PAYMENT", 0.15), { cny: "100.00", payment: "15.00" });
assert.deepEqual(linkedPiUnitPrices("15.01", "PAYMENT", 0.15), { cny: "100.07", payment: "15.01" });
assert.deepEqual(linkedPiUnitPrices("", "PAYMENT", 0.15), { cny: "", payment: "" });
assert.deepEqual(linkedPiUnitPrices("15.00", "PAYMENT", 0), { cny: "", payment: "15.00" });
assert.deepEqual(linkedPiUnitPrices("0.05", "CNY", 0.1), { cny: "0.05", payment: "0.01" });
assert.deepEqual(linkedPiUnitPrices("0.01", "PAYMENT", 0.4), { cny: "0.03", payment: "0.01" });
const switchedCurrency = linkedPiUnitPrices("100.00", "CNY", 0.12);
assert.deepEqual(switchedCurrency, { cny: "100.00", payment: "12.00" });
assert.equal(roundPiMoney(15.01 * 3), 45.03);
console.log("PI双币种产品单价换算测试通过");
