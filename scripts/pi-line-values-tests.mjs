import assert from "node:assert/strict";
import { validPiMoney, validPiQuantity, validPiSellingPrice } from "../lib/pi-line-values.ts";

for (const value of ["1", "12", "9999999999", 5]) assert.equal(validPiQuantity(value), true);
for (const value of ["", "0", "-1", "1.5", "1e2", "10000000000", "Infinity", "01"]) assert.equal(validPiQuantity(value), false);
for (const value of ["0", "0.01", "1.20", "999999999999.99", 8.5]) assert.equal(validPiMoney(value), true);
for (const value of ["", "-1", "1.001", "1e2", "1000000000000", "NaN", "01.00"]) assert.equal(validPiMoney(value), false);
assert.equal(validPiSellingPrice("10.01", "10.00"), true);
assert.equal(validPiSellingPrice("10.00", "10.00"), false);
assert.equal(validPiSellingPrice("9.99", "10.00"), false);
assert.equal(validPiSellingPrice("0", "0"), false);
console.log("PI数量、人民币价格精度及售价高于成本校验通过。");
