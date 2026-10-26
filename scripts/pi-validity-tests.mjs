import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isValidPiValidityDate } from "../lib/pi-validity.ts";

for (const date of ["2026-10-26", "2024-02-29", "2026-01-01"]) assert.equal(isValidPiValidityDate(date), true, date);
for (const date of ["", "2026-02-29", "2026-13-01", "2026-1-01", "26-10-26", "2026-10-26T00:00:00Z"]) assert.equal(isValidPiValidityDate(date), false, date);

const form = readFileSync(new URL("../components/pi-order-form.tsx", import.meta.url), "utf8");
const input = form.match(/PI有效期<Required\s*\/>\s*<input[^>]*type="date"[^>]*>/)?.[0] || "";
assert.match(input, /required/);
assert.match(input, /value=\{validUntil\}/);
assert.match(form, /const \[validUntil, setValidUntil\] = useState\(""\)/, "new PI must start with no prefilled validity date");
assert.match(form, /if \(!isValidPiValidityDate\(validUntil\)\) \{ setError\("请选择有效的 PI 有效期"\); return; \}/);

console.log("PI validity date validation and no-default regression checks passed.");
