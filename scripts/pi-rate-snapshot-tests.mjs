import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { mergeReferenceRates, shouldSaveSnapshot } = await jiti.import("../lib/pi-rate-snapshot.ts");

const now = Date.parse("2026-10-14T12:00:00Z");
const official = { currency: "USD", cny_per_unit: 6.72, source: "CFETS", reference_date: "2026-10-14" };
const fallback = { cny: 6.75, date: "2026-10-14", source: "AGGREGATED" };
assert.equal(mergeReferenceRates({ USD: fallback }, [official], now).USD.cny, 6.72);
assert.equal(mergeReferenceRates({ USD: fallback }, [{ ...official, reference_date: "2026-09-01" }], now).USD.cny, 6.75);
assert.equal(mergeReferenceRates({}, [official], now).USD.source, "CFETS");
assert.equal(shouldSaveSnapshot(official, fallback, now), false);
assert.equal(shouldSaveSnapshot({ ...official, reference_date: "2026-09-01" }, fallback, now), true);
assert.equal(shouldSaveSnapshot(undefined, fallback, now), true);
assert.equal(shouldSaveSnapshot({ ...official, source: "AGGREGATED" }, { cny: 6.72, date: "2026-10-14", source: "CFETS" }, now), true);
console.log("PI每日汇率快照优先级与失效回退测试通过。");
