import assert from "node:assert/strict";
import { buildReleaseAnnouncement, inferAffectedRoles, inferReleaseCategory } from "../lib/notifications/release-announcement.ts";

const customerRoles = inferAffectedRoles(["app/api/customers/public-pool/claim/route.ts", "components/customer-public-pool-view.tsx"]);
assert.ok(customerRoles.includes("SALES") && customerRoles.includes("SUPERVISOR"));
const stockRoles = inferAffectedRoles(["app/stock-orders/[id]/page.tsx"]);
assert.ok(stockRoles.includes("WAREHOUSE") && stockRoles.includes("ORDER_CLERK"));
assert.equal(inferReleaseCategory("fix: prevent invalid customer claim"), "BUG_FIX");
assert.equal(inferReleaseCategory("feat: add supplier reconciliation"), "FEATURE");
assert.equal(inferReleaseCategory("优化工作台客户模块"), "OPTIMIZATION");
assert.equal(inferReleaseCategory("security: enforce permission guard"), "SECURITY");

const releases = [
  { sha: "abc1234", message: "修复公海客户认领渠道判断", url: "https://github.com/example/repo/commit/abc1234", deployedAt: "2026-11-07T02:00:00Z", files: ["app/api/customers/public-pool/claim/route.ts"], deploymentUrl: "https://prod.example", affectedRoles: customerRoles, category: "BUG_FIX" },
  { sha: "def5678", message: "修复仓库入库进度展示", url: "https://github.com/example/repo/commit/def5678", deployedAt: "2026-11-07T03:00:00Z", files: ["app/stock-orders/[id]/page.tsx"], deploymentUrl: "https://prod.example", affectedRoles: stockRoles, category: "BUG_FIX" },
];
const salesSummary = buildReleaseAnnouncement(releases, "2026-11-07", "2026-11-07", ["SALES"], "BUG_FIX");
assert.match(salesSummary.title, /🛠️/);
assert.match(salesSummary.content, /公海客户认领/);
assert.doesNotMatch(salesSummary.content, /仓库入库进度/);
assert.match(salesSummary.content, /Vercel 成功的正式部署记录/);
const featureSummary = buildReleaseAnnouncement(releases, "2026-11-07", "2026-11-07", ["SALES"], "FEATURE");
assert.match(featureSummary.content, /未发现符合此类型/);
const longSummary = buildReleaseAnnouncement(Array.from({ length: 30 }, (_, index) => ({
  sha: `long${index}`, message: "修复客户和订单功能异常".repeat(8), url: `https://github.com/example/repo/commit/${index}${"a".repeat(80)}`,
  deployedAt: "2026-11-07T02:00:00Z", files: [], deploymentUrl: `https://${"deployment".repeat(8)}.vercel.app`,
  affectedRoles: customerRoles, category: "BUG_FIX",
})), "2026-11-07", "2026-11-07", null, "BUG_FIX");
assert.ok(longSummary.content.length <= 4000, `generated content too long: ${longSummary.content.length}`);
assert.match(longSummary.content, /已按长度限制收敛/);

const boundarySummary = buildReleaseAnnouncement(Array.from({ length: 10 }, (_, index) => ({
  sha: `boundary${index}`, message: `修复客户和订单功能异常 ${index} `.repeat(12).slice(0, 100),
  url: `https://github.com/${"very-long-owner-name/very-long-repository-name/commit/"}${index}${"a".repeat(40)}`,
  deployedAt: "2026-11-07T02:00:00Z", files: [], deploymentUrl: `https://${"long-deployment-name-".repeat(5)}${index}.vercel.app`,
  affectedRoles: customerRoles, category: "BUG_FIX",
})), "2026-11-01", "2026-11-07", null, "BUG_FIX");
assert.ok(boundarySummary.content.length <= 4000, `boundary summary too long: ${boundarySummary.content.length}`);

console.log("GitHub/Vercel 发布公告分类、角色筛选与来源内容回归测试通过");
