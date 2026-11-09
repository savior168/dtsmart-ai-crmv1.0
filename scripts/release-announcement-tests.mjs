import assert from "node:assert/strict";
import { buildReleaseAnnouncement, explainEmptyReleaseMatch, inferAffectedRoles, inferReleaseCategory, inferReleaseModules } from "../lib/notifications/release-announcement.ts";

const customerRoles = inferAffectedRoles(["app/api/customers/public-pool/claim/route.ts", "components/customer-public-pool-view.tsx"]);
assert.ok(customerRoles.includes("SALES") && customerRoles.includes("SUPERVISOR"));
const stockRoles = inferAffectedRoles(["app/stock-orders/[id]/page.tsx"]);
assert.ok(stockRoles.includes("WAREHOUSE") && stockRoles.includes("ORDER_CLERK"));
assert.deepEqual(inferAffectedRoles(["scripts/one-off-maintenance.mjs"]), [], "unknown files must not be guessed as relevant to every selected role");
assert.deepEqual(inferAffectedRoles(["lib/auth/current-user.ts"]), ["ALL"], "shared authorization changes affect all roles");
assert.ok(inferAffectedRoles(["components/crm-dashboard.tsx"]).includes("WAREHOUSE"), "workbench changes must be included for each dashboard role");
assert.equal(inferReleaseCategory("fix: prevent invalid customer claim"), "BUG_FIX");
assert.equal(inferReleaseCategory("feat: add supplier reconciliation"), "FEATURE");
assert.equal(inferReleaseCategory("优化工作台客户模块"), "OPTIMIZATION");
assert.equal(inferReleaseCategory("security: enforce permission guard"), "SECURITY");
assert.deepEqual(inferReleaseModules(["app/api/orders/[id]/change/route.ts", "components/stock-order-detail.tsx"]), ["PI订单与订单变更", "备货单与仓库"]);
assert.deepEqual(inferReleaseModules(["components/crm-dashboard.tsx"]), ["工作台与数据总览"]);
assert.deepEqual(inferReleaseModules(["app/api/admin/notifications/release-summary/route.ts", "components/notification-admin-panel.tsx"]), ["通知与公告"], "admin notification APIs must not be mislabeled as system settings");

const releases = [
  { sha: "abc1234", message: "修复公海客户认领渠道判断", details: "允许四种联系方式中任一项满足认领校验。", url: "https://github.com/example/repo/commit/abc1234", deployedAt: "2026-11-07T02:00:00Z", files: ["app/api/customers/public-pool/claim/route.ts"], deploymentUrl: "https://prod.example", affectedRoles: customerRoles, category: "BUG_FIX" },
  { sha: "def5678", message: "修复仓库入库进度展示", url: "https://github.com/example/repo/commit/def5678", deployedAt: "2026-11-07T03:00:00Z", files: ["app/stock-orders/[id]/page.tsx"], deploymentUrl: "https://prod.example", affectedRoles: stockRoles, category: "BUG_FIX" },
];
const salesSummary = buildReleaseAnnouncement(releases, "2026-11-07", "2026-11-07", ["SALES"], "BUG_FIX");
assert.match(salesSummary.title, /🛠️/);
assert.match(salesSummary.title, /客户与客户公海/);
assert.match(salesSummary.content, /公海客户认领/);
assert.match(salesSummary.content, /四种联系方式/);
assert.match(salesSummary.content, /正式上线：/);
assert.doesNotMatch(salesSummary.content, /仓库入库进度/);
assert.match(salesSummary.content, /Vercel 成功的正式部署记录/);
const featureSummary = buildReleaseAnnouncement(releases, "2026-11-07", "2026-11-07", ["SALES"], "FEATURE");
assert.match(featureSummary.content, /未发现符合筛选条件/);
const allSummary = buildReleaseAnnouncement(releases, "2026-11-07", "2026-11-07", ["SALES"], "ALL");
assert.match(allSummary.title, /正式发布/);
assert.match(allSummary.content, /客户与客户公海/);
assert.match(allSummary.content, /问题修复：修复公海客户认领渠道判断/);
assert.doesNotMatch(allSummary.content, /仓库入库进度/);
const allAudienceSummary = buildReleaseAnnouncement(releases, "2026-11-07", "2026-11-07", null, "ALL");
assert.match(allAudienceSummary.content, /仓库入库进度展示/);
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
assert.match(explainEmptyReleaseMatch(0, 0), /没有核验到 Vercel 正式环境成功部署记录/);
assert.match(explainEmptyReleaseMatch(2, 0), /没有找到可关联的 GitHub 提交/);
assert.match(explainEmptyReleaseMatch(2, 1), /没有提交符合当前角色与通知类型筛选/);

console.log("GitHub/Vercel 发布公告分类、角色筛选与来源内容回归测试通过");
