import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

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
assert.match(importView, /disabled=\{!canCreate \|\| busy \|\| !rows\.length\}/, "未授权导入时提交按钮必须禁用");
const templateApi = read("app/api/import/template/route.ts");
assert.match(templateApi, /requirePermission\("imports\.create"\)/, "导入模板接口必须服务端校验执行权限");

const evidencePage = "app/(customer-evidence)/ai-screening/customers/[customerId]/evidence/page.tsx";
assert.ok(existsSync(resolve(process.cwd(), evidencePage)), "客户AI分析依据必须位于独立权限布局");
assert.ok(!existsSync(resolve(process.cwd(), "app/ai-screening/customers/[customerId]/evidence/page.tsx")), "客户依据页不能再继承AI任务布局");
assert.match(read(evidencePage), /protectAnyPage\(\["customers\.ai_evidence_view", "ai\.results\.view"\]\)/, "页面应允许客户依据或AI结果任一权限");
const evidenceApi = read("app/api/ai/evidence/[customerId]/route.ts");
assert.match(evidenceApi, /canReadCustomerAiEvidence\(\{[\s\S]*customerOwnerId: customer\.data\.owner_id[\s\S]*isDirectReport/, "客户依据授权必须以当前归属人和直属下属为准");
assert.match(evidenceApi, /\}\)\) throw new Error\("FORBIDDEN"\)/, "无客户归属或依据权限者必须被拒绝");
assert.match(evidenceApi, /if \(canViewTask\) resultQuery = resultQuery\.eq\("task_id", requestedTaskId\)/, "仅已授权任务可读取指定任务结果");
assert.match(evidenceApi, /can_view_task: canViewTask && account\.role === "ADMIN"/, "客户依据页面不能将共享任务入口暴露给普通角色");
assert.match(evidenceApi, /presentCustomerAiEvidenceResult\(result\.data, account\.role === "ADMIN"\)/, "非管理员不能返回任务费用等原始结果字段");
assert.match(read("app/api/customers/[id]/crm/route.ts"), /canReadCustomerAiEvidence\(\{[\s\S]*isDirectReport: Boolean\(directReport\.data\)/, "客户详情应支持主管查看直属下属客户依据");
const evidenceView = read("components/ai-screening/evidence-view.tsx");
assert.match(evidenceView, /data\?\.can_view_task&&taskId/, "客户归属访问不能显示任务详情和报告入口");
assert.match(evidenceView, /data\?\.can_view_task\?<p>总令牌/, "客户归属访问不能展示任务实际费用");
const customerCrm = read("components/customer-crm-detail-view.tsx");
assert.match(customerCrm, /data\.can_view_ai_evidence&&customer\.ai_screening_done/, "客户详情入口必须遵循服务端依据权限");
assert.doesNotMatch(customerCrm, /data\.ai_result\.task_id/, "客户详情进入依据时不能附带无权查看的任务编号");
const roleDefaults = read("supabase/migrations/202608310003_granular_user_permissions.sql");
assert.match(roleDefaults, /'SUPERVISOR','customers\.ai_evidence_view'/, "主管默认允许查看授权客户依据");
assert.match(roleDefaults, /'SALES','customers\.ai_evidence_view'/, "销售默认允许查看本人客户依据");

console.log("Permission contract regression tests passed.");
