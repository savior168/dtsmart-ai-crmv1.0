import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

for (const path of [
  "app/quotes/page.tsx", "app/quotes/new/page.tsx", "app/quotes/[id]/page.tsx",
  "app/orders/page.tsx", "app/orders/[id]/page.tsx",
  "app/stock-orders/page.tsx", "app/stock-orders/[id]/page.tsx",
  "app/notifications/page.tsx", "app/settings/costs/page.tsx",
  "app/api/quotes/[id]/confirm/route.ts", "app/api/stock-orders/[id]/status/route.ts",
  "app/api/quotes/template/route.ts", "app/api/followups/export/route.ts", "app/api/reports/sales/export/route.ts",
  "app/api/cost-center/export/route.ts", "components/warehouse-dashboard.tsx",
]) assert.equal(existsSync(resolve(root, path)), true, `缺少闭环文件：${path}`);

const auth = read("lib/auth/current-user.ts");
assert.match(auth, /canWriteOwnedRecord[\s\S]*account\.role === "ADMIN" \|\| ownerId === account\.id/, "跨用户写权限必须仅允许记录归属人或系统管理员");

const customerUpdate = read("app/api/customers/[id]/route.ts");
assert.match(customerUpdate, /account\.role === "ADMIN" \|\| customer\.owner_id === user\.id/, "客户修改必须拒绝主管修改他人客户");
const customerBatch = read("app/api/customers/batch/route.ts");
assert.match(customerBatch, /account\.role !== "ADMIN"[\s\S]*\.eq\("owner_id", user\.id\)/, "批量更新必须将主管限定为本人客户");
const followupUpdate = read("app/api/followups/[id]/route.ts");
assert.match(followupUpdate, /canWriteOwnedRecord\(account,existing\.data\.user_id\)/, "跟进修改必须按创建人校验，主管跨用户只读");
const singleCustomerAnalysis = read("app/api/ai/analyze/route.ts");
assert.match(singleCustomerAnalysis, /\.eq\("id", body\.customer_id\)\.eq\("owner_id", user\.id\)/, "单客户AI筛选必须限定当前归属人，主管不得替他人发起分析");
const quoteDetail = read("app/api/quotes/[id]/route.ts");
assert.match(quoteDetail, /quote\.owner_id === account\.id \|\| account\.role === "ADMIN"/, "报价写按钮必须只开放给归属人或系统管理员");
assert.match(quoteDetail, /can_attach:[\s\S]*\["DRAFT","GENERATED","SENT"\]/, "报价发送后必须允许补充客户确认凭证");
const attachmentDetail = read("app/api/attachments/[id]/route.ts");
assert.match(attachmentDetail, /报价发送后附件作为业务凭证保留，不能删除/, "已发送报价的附件必须作为业务凭证保留");
const stockApi = read("app/api/stock-orders/[id]/route.ts");
assert.match(stockApi, /\["WAREHOUSE","ADMIN"\]\.includes\(account\.role\)/, "备货状态只能由仓库员或系统管理员更新");
assert.doesNotMatch(stockApi, /unit_price|total_amount|phone|email,address/, "仓库接口不得返回销售价格、客户联系方式或利润数据");

const migration = read("supabase/migrations/202609010001_sales_quote_stock_cost_center.sql");
const orderMigration = read("supabase/migrations/202609010002_sales_order_workflow.sql");
const lifecycleMigration = read("supabase/migrations/202609010003_document_lifecycle_guardrails.sql");
assert.match(migration, /target\.owner_id<>actor\.id and actor\.role<>'ADMIN'[\s\S]*只能修改归属自己的报价单/, "数据库报价修改必须拒绝主管修改他人报价");
assert.match(migration, /target\.owner_id <> actor\.id and actor\.role<>'ADMIN'[\s\S]*只有报价归属销售员或系统管理员可以确认客户/, "客户确认必须由报价归属销售员或系统管理员执行");
assert.match(migration, /actor\.role not in \('WAREHOUSE','ADMIN'\)/, "数据库备货状态只允许仓库员或系统管理员更新");
assert.match(migration, /p_status in \('SHORTAGE','CANCELLED'\)[\s\S]*必须填写原因说明/, "缺货异常和取消必须记录原因");
assert.match(migration, /quote_id uuid not null unique references public\.quotes/, "每张确认报价只能生成一张备货单");
assert.match(migration, /target\.valid_until is not null and target\.valid_until < current_date[\s\S]*报价已超过有效期/, "过期报价不得直接确认并生成备货单");
assert.match(migration, /schedule_followup_notification[\s\S]*FOLLOWUP_DUE[\s\S]*deliver_at[\s\S]*action_status/, "计划跟进时间必须形成可处理的站内通知");
assert.match(migration, /STOCK_ORDER_CREATED[\s\S]*'PENDING'[\s\S]*STOCK_STATUS_CHANGED[\s\S]*'INFO'/, "报价与备货上下游通知必须区分待处理和仅通知");
assert.match(migration, /Immutable billing audit identifiers deliberately have no lifecycle foreign[\s\S]*user_id uuid,[\s\S]*customer_id uuid,[\s\S]*task_id uuid,/, "统一费用台账不得依赖会被物理删除的用户、客户或任务外键");
assert.match(migration, /billing ledger is append-only[\s\S]*cost_center_settings[\s\S]*accounting_start_at/, "重置正式费用统计只能调整账期边界，不能删除费用账本");
assert.match(migration, /supervisors can act on their own customers only/, "迁移必须明确主管跨用户只读边界");
assert.match(migration, /public\.current_user_is_admin\(\) or coalesce\(owner_user_id,owner_id,created_by\)=auth\.uid\(\)/, "客户RLS必须只允许归属人或系统管理员写入");
assert.doesNotMatch(migration, /'WAREHOUSE','system\.audit\.view'/, "仓库员菜单只保留工作台、备货和安全设置");
assert.match(orderMigration,/order_number text not null unique[\s\S]*quote_id uuid not null unique references public\.quotes/,"销售订单必须有用户填写的唯一订单号并唯一关联报价单");
assert.match(orderMigration,/add column if not exists sales_order_id uuid references public\.sales_orders[\s\S]*add column if not exists order_number text[\s\S]*alter column sales_order_id set not null[\s\S]*alter column order_number set not null/,"备货单必须同时绑定订单ID和订单号");
assert.match(orderMigration,/created_order\.destination_country,'DRAFT'[\s\S]*等待销售员完善备货信息/,"确认报价后应先创建待完善备货单而不是直接通知仓库");
assert.match(orderMigration,/submit_stock_order[\s\S]*status='WAITING'[\s\S]*STOCK_ORDER_CREATED/,"只有销售员完善备货信息后才提交并通知仓库");
assert.match(orderMigration,/previous='WAITING'[\s\S]*previous='PREPARING'[\s\S]*previous='SHORTAGE'/,"备货状态必须按允许状态机流转");
assert.match(lifecycleMigration,/target\.status in \('CONFIRMED','SUPERSEDED'\)[\s\S]*报价已进入后续业务流程，不能取消/, "已进入后续流程的报价不得被越权取消");

const menu = read("components/app-shell.tsx");
assert.match(menu, /label: "客户中心"[\s\S]*客户库[\s\S]*客户导入[\s\S]*跟进管理/, "客户中心必须归类客户库、客户导入和跟进管理");
assert.match(menu, /label: "销售管理"[\s\S]*报价单[\s\S]*销售订单/, "报价单与销售订单必须归入销售管理");
assert.match(menu, /label: "仓库管理"[\s\S]*stock\.view/, "备货单必须归入仓库管理");
assert.match(menu, /label: "AI获客"[\s\S]*disabled: true/, "AI获客本期只能预留，不能伪装成已开发功能");
assert.match(menu, /label: "系统管理"[\s\S]*用户与权限[\s\S]*操作日志[\s\S]*安全设置[\s\S]*费用中心/, "系统管理必须使用清晰二级菜单");

const costView = read("components/cost-center-view.tsx");
assert.match(costView, /单价待配置[\s\S]*这不代表接口免费/, "未配置第三方单价时不得错误显示为免费");
assert.match(costView, /api\/cost-center\/export/, "费用中心必须支持导出完整明细");
assert.match(costView, /历史测试期/, "费用中心必须可单独查看历史测试期");
assert.match(costView, /清空正式期统计/, "费用中心必须支持重置正式统计起点");
assert.match(costView, /不会删除任何真实调用记录/, "费用中心重置统计不得删除历史账本");
const shell = read("components/app-shell.tsx");
assert.match(shell, /toastNotices[\s\S]*fixed bottom-5 right-5[\s\S]*立即查看[\s\S]*稍后处理/, "关键通知必须在右下角弹出并可直达业务详情");
assert.match(shell, /canLoadNotices = Boolean\(profile\)[\s\S]*if \(!canLoadNotices\)[\s\S]*setInterval\(refresh, 60000\)/, "登录页或未核验会话不得轮询通知接口");
const notifications = read("components/notifications-view.tsx");
assert.match(notifications, /未读[\s\S]*待处理[\s\S]*已归档[\s\S]*标记已处理/, "通知中心必须同时管理阅读与业务处理状态");
const quoteForm = read("components/quote-form.tsx");
assert.match(quoteForm, /api\/quotes\/template[\s\S]*下载导入模板[\s\S]*导入Excel[\s\S]*粘贴表格/, "报价创建必须支持模板、Excel导入和剪贴板粘贴");
assert.doesNotMatch(quoteForm,/\["序号","产品","品牌","型号","质量","描述（客户）","中文质量\/描述（仓库）"/,"报价产品表不得混入仓库专用列");
assert.match(quoteForm,/订单编号（必填）[\s\S]*确认并创建订单/,"客户确认时必须由销售员填写订单编号");
const costApi=read("app/api/cost-center/route.ts");
assert.doesNotMatch(costApi,/user:users\(name,email\)/,"无外键费用账本不得使用PostgREST嵌套用户关联");
const reportView = read("components/sales-reports-view.tsx");
assert.match(reportView, /breakdowns[\s\S]*trend/, "报表中心必须使用真实数据库聚合结果");
assert.doesNotMatch(reportView, /\[35,\s*29,\s*21,\s*15\]|\[82,\s*70,\s*61,\s*48,\s*41\]/, "报表中心不得保留静态演示数据");

console.log("销售闭环、仓库数据最小化及四角色跨用户权限回归测试通过。");
