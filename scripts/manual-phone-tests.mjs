import assert from "node:assert/strict";
import { normalizeManualPhone } from "../lib/contacts/manual-phone.ts";

assert.equal(normalizeManualPhone("+86 15502066998", "联系电话"), "+86 15502066998");
assert.equal(normalizeManualPhone("＋８６\u00a0１５５０２０６６９９８", "联系电话"), "+86 15502066998");
assert.equal(normalizeManualPhone("+86\u200b 15502066998", "联系电话"), "+86 15502066998");
assert.equal(normalizeManualPhone("", "联系电话"), "");
assert.throws(() => normalizeManualPhone("+86 ABC123", "联系电话"), /联系电话格式不正确/);

console.log("manual phone tests passed");
