import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

console.log("Permission contract regression tests passed.");
