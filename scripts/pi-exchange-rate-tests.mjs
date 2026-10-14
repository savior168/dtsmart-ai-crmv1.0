import assert from "node:assert/strict";
import { businessRate, cnyPerPayment, paymentPerCny } from "../lib/pi-exchange-rate-math.ts";
import { parseEcbFeed } from "../lib/pi-ecb-feed.ts";

assert.equal(businessRate(7.25, { adjustment_mode: "OFFSET", adjustment_value: -0.05 }), 7.2);
assert.equal(businessRate(7.25, { adjustment_mode: "PERCENT", adjustment_value: -2 }), 7.105);
assert.equal(businessRate(null, { adjustment_mode: "FIXED", adjustment_value: 209 }), 209);
assert.equal(businessRate(null, { adjustment_mode: "OFFSET", adjustment_value: 0 }), null);
assert.equal(businessRate(0.01, { adjustment_mode: "OFFSET", adjustment_value: -0.05 }), null);
assert.equal(paymentPerCny(209), 0.004784688995);
assert.ok(Math.abs(cnyPerPayment(paymentPerCny(209)) - 209) < 0.000001);
assert.equal(paymentPerCny(0), 0);
const sample = "<Cube time='2026-10-13'><Cube currency='USD' rate='1.1188'/><Cube currency='CNY' rate='7.4890'/></Cube>";
const feed = parseEcbFeed(sample, Date.parse("2026-10-14T00:00:00Z"));
assert.equal(feed.date, "2026-10-13");
assert.ok(Math.abs(feed.perEuro.CNY / feed.perEuro.USD - 6.69378) < 0.0001);
assert.throws(() => parseEcbFeed(sample, Date.parse("2026-11-14T00:00:00Z")), /已过期/);
console.log("PI汇率方向、业务调整和无数据回退测试通过。");
