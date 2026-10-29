import assert from "node:assert/strict";
import { businessRate, businessRateForCurrency, cnyPerPayment, paymentPerCny, roundReferenceRateToTwoDecimals } from "../lib/pi-exchange-rate-math.ts";
import { createJiti } from "jiti";
import { isRecentRateDate, parseBaiduFinScopeReferenceRate, parseFrankfurterCnyRates } from "../lib/pi-rate-sources.ts";
const jiti = createJiti(import.meta.url);
const { parseCfetsSafeHtml } = await jiti.import("../lib/pi-cfets-feed.ts");

assert.equal(businessRate(7.25, { adjustment_mode: "OFFSET", adjustment_value: -0.05 }), 7.2);
assert.equal(roundReferenceRateToTwoDecimals(6.6616), 6.66);
assert.equal(businessRateForCurrency("USD", 6.6616, { adjustment_mode: "FIXED", adjustment_value: 99 }), 6.56);
assert.equal(businessRateForCurrency("EUR", 7.426, { adjustment_mode: "OFFSET", adjustment_value: 0 }), 7.33);
assert.equal(businessRateForCurrency("GBP", 8.8765), 8.78);
assert.equal(businessRateForCurrency("AUD", 4.6974), 4.60);
assert.equal(businessRateForCurrency("CAD", 4.7636), 4.66);
assert.equal(businessRateForCurrency("NZD", 3.7452), 3.65);
assert.equal(businessRateForCurrency("JPY", 0.04567, { adjustment_mode: "OFFSET", adjustment_value: 0 }), 0.04567);
assert.equal(businessRateForCurrency("AUD", null), null);
assert.equal(businessRate(7.25, { adjustment_mode: "PERCENT", adjustment_value: -2 }), 7.105);
assert.equal(businessRate(null, { adjustment_mode: "FIXED", adjustment_value: 209 }), 209);
assert.equal(businessRate(null, { adjustment_mode: "OFFSET", adjustment_value: 0 }), null);
assert.equal(businessRate(0.01, { adjustment_mode: "OFFSET", adjustment_value: -0.05 }), null);
assert.equal(paymentPerCny(209), 0.004784688995);
assert.ok(Math.abs(cnyPerPayment(paymentPerCny(209)) - 209) < 0.000001);
assert.equal(paymentPerCny(0), 0);
const officialValues = [672.49,751.65,4.2412,85.688,889.56,468.6,376.64,524.42,806.13,471.8,
  120.27,60.815,1253.07,245.44,19996,54.743,55.975,4835.85,58.099,99.45,148.48,141.89,735.519,273.41,500.85];
const officialHtml = `人民币汇率中间价列表<!-- <tr class="first"><td>2026-10-15</td></tr> -->` +
  `<tr class="first"><td>2026-10-14</td>${officialValues.map((value) => `<td>${value}</td>`).join("")}</tr>`;
const official = parseCfetsSafeHtml(officialHtml, Date.parse("2026-10-14T12:00:00Z"));
assert.equal(official.USD.cny, 6.7249);
assert.equal(official.JPY.cny, 0.042412);
assert.ok(Math.abs(official.MYR.cny - 100 / 60.815) < 1e-12);
assert.ok(Math.abs(official.KRW.cny - 100 / 19996) < 1e-12);
assert.equal(official.USD.source, "CFETS");
assert.throws(() => parseCfetsSafeHtml(officialHtml, Date.parse("2026-11-14T00:00:00Z")), /没有近期完整/);
assert.throws(() => parseCfetsSafeHtml(officialHtml.replace("<td>500.85</td>", ""), Date.parse("2026-10-14T12:00:00Z")), /没有近期完整/);
assert.equal(isRecentRateDate("2026-10-13", Date.parse("2026-10-14T00:00:00Z")), true);
assert.equal(isRecentRateDate("2026-09-13", Date.parse("2026-10-14T00:00:00Z")), false);
const baiduRate = parseBaiduFinScopeReferenceRate({
  ResultCode: 0,
  Result: { from_currency: { code: "USD" }, to_currency: { code: "CNY", num: "6.6616" }, update_time: "2026-10-29 12:05" },
}, "USD", Date.parse("2026-10-29T04:06:00Z"));
assert.deepEqual(baiduRate, { cny: 6.6616, date: "2026-10-29", updatedAt: "2026-10-29 12:05", source: "BAIDU_FINSCOPE" });
assert.throws(() => parseBaiduFinScopeReferenceRate({
  ResultCode: 0, Result: { from_currency: { code: "EUR" }, to_currency: { code: "CNY", num: "7.4" }, update_time: "2026-10-29 12:05" },
}, "USD", Date.parse("2026-10-29T04:06:00Z")), /无效或已过期/);
assert.throws(() => parseBaiduFinScopeReferenceRate({
  ResultCode: 0, Result: { from_currency: { code: "USD" }, to_currency: { code: "CNY", num: "7.4" }, update_time: "2026-10-20 12:05" },
}, "USD", Date.parse("2026-10-29T04:06:00Z")), /无效或已过期/);
const blended = parseFrankfurterCnyRates([
  { date: "2026-10-13", base: "CNY", quote: "NGN", rate: 198.92 },
  { date: "2026-09-13", base: "CNY", quote: "VND", rate: 3866.89 },
  { date: "2026-10-13", base: "USD", quote: "EUR", rate: 1.1 },
  { date: "2026-10-13", base: "CNY", quote: "USD", rate: 0 },
], Date.parse("2026-10-14T00:00:00Z"));
assert.ok(Math.abs(blended.NGN.cny - 1 / 198.92) < 1e-12);
assert.equal(blended.NGN.source, "AGGREGATED");
assert.equal(blended.VND, undefined);
assert.equal(blended.EUR, undefined);
assert.equal(blended.USD, undefined);
console.log("PI汇率方向、业务调整和无数据回退测试通过。");
