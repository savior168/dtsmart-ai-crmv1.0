import assert from "node:assert/strict";
import { publicReleaseReason } from "../lib/customers/public-release-summary.ts";

assert.equal(publicReleaseReason(null), "未填写释放原因");
assert.equal(publicReleaseReason("客户暂无需求，2026-09-29 已释放"), "客户暂无需求，2026-09-29 已释放");
assert.equal(
  publicReleaseReason("联系 +86 15502066998，邮箱 sales@example.com，官网 https://example.com/contact"),
  "联系 [号码已隐藏]，邮箱 [邮箱已隐藏]，官网 [链接已隐藏]",
);
assert.ok(publicReleaseReason("原因".repeat(120)).length <= 161);

console.log("public release summary tests passed");
