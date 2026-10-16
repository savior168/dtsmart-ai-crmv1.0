import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

const permissionCatalog = read("lib/auth/permissions.ts");
const sidebar = read("components/app-shell.tsx");
const catalogCodes = new Set([...permissionCatalog.matchAll(/code: "([^"]+)"/g)].map((match) => match[1]));
for (const [, href, permission] of sidebar.matchAll(/href: "(\/[^"]*)"[^\n]*permission: "([^"]+)"/g)) {
  assert.ok(catalogCodes.has(permission), `${href} 的菜单权限 ${permission} 必须登记在角色权限目录`);
  const page = href === "/" ? "app/page.tsx" : `app${href}/page.tsx`;
  assert.ok(existsSync(resolve(process.cwd(), page)), `${href} 菜单必须对应真实页面`);
  const guards = [read(page)];
  const parts = href.split("/").filter(Boolean);
  for (let i = parts.length; i > 0; i--) {
    const layout = `app/${parts.slice(0, i).join("/")}/layout.tsx`;
    if (existsSync(resolve(process.cwd(), layout))) guards.push(read(layout));
  }
  const guarded = guards.some((source) => source.includes(`protectPage("${permission}")`)
    || source.includes(`requirePermission("${permission}")`)
    || (["system.users.view", "system.notifications.view"].includes(permission) && source.includes("requireAdmin()")));
  assert.ok(guarded, `${href} 菜单权限 ${permission} 必须由页面或布局在服务端校验`);
}
assert.match(read("app/api/pi-exchange-rates/route.ts"), /account\.role === "ADMIN"[\s\S]*rates\.map\(\(\{ currency, label, business_cny \}\)/, "销售读取业务汇率不能泄露管理员的参考来源、手工值和调整规则");
for (const [code, page, api, method] of [
  ["pi.rates.view", "app/settings/pi-exchange-rates/page.tsx", null, null],
  ["pi.accounts.view", "app/settings/pi-payment-accounts/page.tsx", null, null],
  ["pi.rates.manage", null, "app/api/pi-exchange-rates/route.ts", "PATCH"],
  ["pi.accounts.manage", null, "app/api/pi-payment-accounts/route.ts", "POST"],
]) {
  assert.match(permissionCatalog, new RegExp(`code: "${code.replaceAll(".", "\\.")}"[^\\n]*core: true`), `${code} 必须是管理员专属权限`);
  if (page) assert.match(read(page), new RegExp(`requirePermission\\("${code.replaceAll(".", "\\.")}\\"\\)`), `${page} 必须校验页面权限`);
  if (api) assert.match(read(api), new RegExp(`export async function ${method}[\\s\\S]*requirePermission\\("${code.replaceAll(".", "\\.")}\\"\\)`), `${api} 必须校验操作权限`);
}
assert.match(sidebar, /href: "\/settings\/pi-exchange-rates", permission: "pi.rates.view"/, "汇率菜单必须使用独立页面权限");
assert.match(sidebar, /href: "\/settings\/pi-payment-accounts", permission: "pi.accounts.view"/, "收款账户菜单必须使用独立页面权限");
assert.match(permissionCatalog, /code: "system\.notifications\.view"[^\n]*core: true/, "通知与公告入口必须仅系统管理员可见");
assert.match(read("app/api/admin/notifications/route.ts"), /requireAdmin\(\)/, "通知策略接口必须核验系统管理员");
assert.match(read("app/api/admin/notifications/announcements/route.ts"), /requireAdmin\(\)/, "公告发布接口必须核验系统管理员");

const roleApi = read("app/api/admin/roles/route.ts");
assert.match(roleApi, /const pagePermission = permissionPageCode\(permission\)/, "角色权限接口必须解析所属页面");
assert.match(roleApi, /请先开启所属页面权限，再开启数据范围或功能按钮/, "服务端必须拒绝父页面关闭时直接开启子权限");
assert.match(roleApi, /const isPagePermission = pagePermission === permission[\s\S]*pageChildren[\s\S]*changes = \[[\s\S]*roleCannotUseCrossUserData[\s\S]*item\.kind === "DATA"[\s\S]*onConflict: "role_code,permission_code"/, "页面总开关必须在服务端原子同步全部可配置子权限，并保持角色数据边界");
assert.match(roleApi, /NextResponse\.json\(\{ ok: true, changes \}\)/, "角色权限接口必须向前端返回实际同步结果");

const adminPanels = read("components/admin-settings-panels.tsx");
assert.match(adminPanels, /const changes=Array\.isArray\(body\.changes\)[\s\S]*new Map\(changes\.map[\s\S]*changed\.get\(row\.permission_code\)/, "角色权限前端必须使用后端实际变更同步父子开关状态");

const importPage = read("app/import/page.tsx");
assert.match(importPage, /canCreate=\{hasPermission\(account, "imports\.create"\)\}/, "导入页面必须将执行权限传给前端");
const importView = read("components/import-view.tsx");
assert.match(importView, /canCreate: boolean/, "导入组件必须显式接收执行权限");
assert.match(importView, /当前角色仅可查看导入页面/, "未授权导入时必须明确展示只读状态");
assert.match(importView, /disabled=\{!canCreate\}/, "未授权导入时模板下载必须禁用");
assert.match(importView, /disabled=\{!canCreate \|\| busy \|\| !previewReady\}/, "未授权或预检未成功时提交按钮必须禁用");
const templateApi = read("app/api/import/template/route.ts");
assert.match(templateApi, /requirePermission\("imports\.create"\)/, "导入模板接口必须服务端校验执行权限");

const evidencePage = "app/(customer-evidence)/ai-screening/customers/[customerId]/evidence/page.tsx";
assert.ok(existsSync(resolve(process.cwd(), evidencePage)), "客户AI分析依据必须位于独立权限布局");
assert.ok(!existsSync(resolve(process.cwd(), "app/ai-screening/customers/[customerId]/evidence/page.tsx")), "客户依据页不能再继承AI任务布局");
assert.match(read(evidencePage), /protectPage\("customers\.ai_evidence_view"\)/, "完整客户依据页面必须使用管理员级权限");
const evidenceApi = read("app/api/ai/evidence/[customerId]/route.ts");
assert.match(evidenceApi, /canReadCustomerAiEvidence\(\{[\s\S]*customerOwnerId: customer\.data\.owner_id[\s\S]*isDirectReport/, "客户依据授权必须以当前归属人和直属下属为准");
assert.match(evidenceApi, /\}\)\) throw new Error\("FORBIDDEN"\)/, "无客户归属或依据权限者必须被拒绝");
assert.match(evidenceApi, /if \(canViewTask\) resultQuery = resultQuery\.eq\("task_id", requestedTaskId\)/, "仅已授权任务可读取指定任务结果");
assert.match(evidenceApi, /can_view_task: canViewTask && account\.role === "ADMIN"/, "客户依据页面不能将共享任务入口暴露给普通角色");
assert.match(evidenceApi, /presentCustomerAiEvidenceResult\(result\.data, account\.role === "ADMIN"\)/, "非管理员不能返回任务费用等原始结果字段");
assert.match(read("app/api/customers/[id]/crm/route.ts"), /fullAiEvidenceAccess = account\.role === "ADMIN"[\s\S]*ai_facts: canViewAiEvidence \? aiFacts : \[\]/, "客户详情仅能向管理员返回完整依据");
const evidenceView = read("components/ai-screening/evidence-view.tsx");
assert.match(evidenceView, /data\?\.can_view_task&&taskId/, "客户归属访问不能显示任务详情和报告入口");
assert.match(evidenceView, /data\?\.can_view_task\?<p>总令牌/, "客户归属访问不能展示任务实际费用");
const customerCrm = read("components/customer-crm-detail-view.tsx");
assert.match(customerCrm, /data\.can_view_ai_evidence&&customer\.ai_screening_done/, "客户详情入口必须遵循服务端依据权限");
assert.doesNotMatch(customerCrm, /data\.ai_result\.task_id/, "客户详情进入依据时不能附带无权查看的任务编号");
assert.match(read("lib/auth/permissions.ts"), /code: "customers\.ai_evidence_view"[^\n]*core: true/, "完整客户依据必须为管理员级权限");
assert.match(read("lib/auth/permissions.ts"), /code: "ai\.acquisition\.view"[^\n]*core: true[\s\S]*code: "ai\.tasks\.view"[^\n]*core: true/, "非管理员不得因旧授权进入AI菜单");
const rawAiReadBoundary = read("supabase/migrations/202610100003_ai_raw_admin_read_boundary.sql");
for (const table of ["tasks", "task_items", "results", "evidence"]) {
  assert.match(rawAiReadBoundary, new RegExp(`on public\\.ai_screening_${table} as restrictive[\\s\\S]*?for select to authenticated[\\s\\S]*?using \\(public\\.current_user_is_admin\\(\\)\\)`), `AI ${table} 原始数据必须在数据库 RLS 中仅允许管理员读取`);
}
assert.match(read("lib/auth/current-user.ts"), /CORE_PERMISSION_CODES\.has\(permission\) \|\| CORE_PERMISSION_CODES\.has\(pagePermission\)/, "旧权限授权不得绕过核心页面及子功能");
assert.match(customerCrm, /if \(!data\.can_view_ai_evidence\) return/, "普通角色AI分析页签只展示业务摘要");

console.log("Permission contract regression tests passed.");
