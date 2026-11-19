import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261102060003_pi_recall_stock_start_guard.sql");
const configurableDeleteMigration = read("supabase/migrations/20261105101000_configurable_pi_draft_delete.sql");
const detailApi = read("app/api/orders/[id]/route.ts");
const listApi = read("app/api/orders/route.ts");
const reviewApi = read("app/api/orders/[id]/cost-review/route.ts");
const currentUser = read("lib/auth/current-user.ts");
const detailView = read("components/order-detail-view.tsx");
const listView = read("components/orders-view.tsx");
const stockListView = read("components/stock-orders-view.tsx");
const userOptionsApi = read("app/api/users/options/route.ts");
const userScopeSelect = read("components/user-scope-select.tsx");
const piForm = read("components/pi-order-form.tsx");
const priceMigration = read("supabase/migrations/20261117090100_direct_pi_price_correction_generated_amount_fix.sql");
const financeReadMigration = read("supabase/migrations/20261118194500_finance_granted_pi_read.sql");
const exportApi = read("app/api/orders/[id]/export/route.ts");

assert.match(financeReadMigration, /sales_orders_finance_granted_pi_read[\s\S]*confirmation_method = 'DIRECT_PI'[\s\S]*current_user_role\(\) = 'FINANCE'[\s\S]*current_user_has_business_permission\('orders\.data_all'\)/,
  "财务跨用户 PI 读取必须同时受角色、PI 类型和实际权限控制");
assert.match(financeReadMigration, /sales_order_items_finance_granted_pi_read[\s\S]*current_user_has_business_permission\('orders\.data_all'\)[\s\S]*pi\.confirmation_method = 'DIRECT_PI'/,
  "财务产品项不得越界读取历史非 PI 订单");
assert.match(listApi, /\["ORDER_CLERK", "FINANCE"\]\.includes\(account\.role\)\) query = query\.eq\("confirmation_method", "DIRECT_PI"\)/,
  "财务订单列表只展示 PI");
assert.match(listApi, /const relatedClient = \["ORDER_CLERK", "FINANCE"\]\.includes\(account\.role\) \? createAdminClient\(\) : supabase/,
  "已授权财务员的 PI 列表应能显示对应的备货进度摘要");
assert.match(detailApi, /\["ORDER_CLERK", "FINANCE"\]\.includes\(account\.role\) && order\.data\.confirmation_method !== "DIRECT_PI"/,
  "财务不得通过详情读取非 PI 订单");
assert.match(exportApi, /\["ORDER_CLERK", "FINANCE"\]\.includes\(account\.role\) && order\.data\.confirmation_method !== "DIRECT_PI"/,
  "财务不得通过导出读取非 PI 订单");

for (const rpc of ["update_direct_pi_draft", "set_direct_pi_change_note",
  "delete_never_submitted_pi_draft", "cancel_sales_order"]) {
  assert.match(migration, new RegExp(`pg_get_functiondef\\('public\\.${rpc}\\(`),
    `${rpc} must retain the database-side creator guard`);
}
assert.match(migration, /coalesce\(target\.prepared_by,target\.sales_user_id\) is distinct from actor\.id/,
  "PI writes must check the preparer, not the sales owner or role alone");
assert.match(migration, /create or replace function public\.recall_direct_pi_order[\s\S]*coalesce\(target\.prepared_by,target\.sales_user_id\) is distinct from actor\.id/,
  "PI recall must be creator-only");
assert.match(migration, /create function public\.review_shipped_pi_seller_cost[\s\S]*coalesce\(target\.prepared_by,target\.sales_user_id\) is distinct from actor\.id/,
  "post-shipment seller cost review must be creator-only");
assert.match(detailApi, /confirmation_method === "DIRECT_PI"[\s\S]*\(order\.data\.prepared_by \|\| order\.data\.sales_user_id\) === account\.id/,
  "PI detail actions must use creator scope");
assert.match(detailApi, /const costReviewAccess = \(order\.data\.prepared_by \|\| order\.data\.sales_user_id\) === account\.id/,
  "seller cost review access must retain the PI creator scope");
assert.match(detailApi, /can_review_seller_cost: costReviewAccess/,
  "seller cost review button must follow the server-side creator access decision");
assert.match(detailApi, /can_cancel:\s*writable &&\s*hasPermission\(account, "orders\.cancel"\)/,
  "the cancel button must obey the configured grant and creator scope rather than a role ban");
assert.match(migration, /PI cancel clerk guard changed; manual review required/,
  "the SQL cancellation guard must not keep a blanket clerk veto after authorization is configurable");
assert.match(listApi, /\(item\.prepared_by \|\| item\.sales_user_id\) === account\.id/,
  "PI list destructive actions must use creator scope");
assert.doesNotMatch(detailApi, /can_delete_draft:\s*\(account\.role\s*===\s*"SALES"\s*\|\|\s*account\.role\s*===\s*"ADMIN"\)/,
  "草稿删除入口应由可配置权限和创建人范围控制，不应写死角色");
assert.doesNotMatch(listApi, /can_delete_draft:\s*\(account\.role\s*===\s*"SALES"\s*\|\|\s*account\.role\s*===\s*"ADMIN"\)/,
  "PI列表删除入口应与详情页使用同一权限语义");
assert.match(detailApi, /can_delete_draft:[\s\S]*order\.data\.confirmed_at === null[\s\S]*!stock\.data/,
  "详情页删除能力必须与列表API共享从未提交且未生成备货单的约束");
assert.match(listApi, /can_delete_draft:[\s\S]*item\.confirmed_at === null[\s\S]*!stockByOrderId\.has\(item\.id\)/,
  "列表页删除能力必须与详情API共享从未提交且未生成备货单的约束");
assert.match(detailView, /data\.can_delete_draft\s*\?\s*<button[\s\S]*?删除未提交草稿/,
  "PI详情删除入口必须直接跟随服务端 can_delete_draft 能力标记");
assert.match(listView, /row\.can_delete_draft\s*\?\s*<RowActionItem[\s\S]*?删除草稿/,
  "PI列表删除入口必须直接跟随服务端 can_delete_draft 能力标记");
assert.match(detailApi, /can_cancel:\s*writable &&\s*hasPermission\(account, "orders\.cancel"\)/,
  "取消PI入口必须同时服从权限配置和创建人/单据状态范围");
assert.match(detailView, /data\.can_cancel\s*\?\s*\([\s\S]*?取消订单/,
  "PI详情取消按钮必须严格由服务端 can_cancel 决定，而不是独立角色判断");
assert.match(configurableDeleteMigration, /current_user_has_business_permission\(''orders\.delete_draft''\)/,
  "PI草稿删除数据库RPC也必须服从管理员配置的功能权限");
assert.match(configurableDeleteMigration,
  /replace\(definition,[\s\S]*actor\.role not in \(''SALES'',''ADMIN''\)[\s\S]*current_user_has_business_permission\(''orders\.delete_draft''\)[\s\S]*if actor\.id is null or not public\.current_user_has_business_permission\(''orders\.delete_draft''\) then/,
  "迁移应精确删除旧角色门槛，同时保留管理员配置的功能权限校验");
assert.match(configurableDeleteMigration, /if definition = previous then[\s\S]*raise exception/,
  "若正式库函数定义与预期不符，迁移必须安全中止而非盲目覆盖");
assert.match(migration,
  /definition := pg_get_functiondef\('public\.delete_never_submitted_pi_draft\([\s\S]*target\.sales_user_id<>actor\.id[\s\S]*coalesce\(target\.prepared_by,target\.sales_user_id\) is distinct from actor\.id/,
  "迁移链应先将草稿删除范围限定为制单人，再移除覆盖配置的固定角色门槛");
const passwordRoute = read("app/api/users/password/route.ts");
assert.match(passwordRoute, /登录状态已失效，请重新登录后再修改密码/,
  "密码修改遇到失效会话时应给出可执行的中文提示");
assert.match(passwordRoute, /status: authErrorStatus\(rawMessage\)/,
  "密码修改接口应返回与认证状态匹配的HTTP状态码");
assert.match(reviewApi, /requirePermission\("orders\.cost_review"\)/,
  "cost review API must check the configured operation permission");
const creatorScope = currentUser.match(/export async function requestedPiCreatorId[\s\S]*?\r?\n}\r?\n/)?.[0] || "";
assert.match(creatorScope, /hasPermission\(account, dataPermission\)/,
  "PI creator filter must require the configured data grant");
assert.doesNotMatch(creatorScope, /ORDER_CLERK|account\.role/,
  "PI creator filter must not hard-code a role after the data grant is configured");
assert.match(stockListView, /const canFilterCreator\s*=\s*canFilterOwner/,
  "备货制单人筛选应由数据权限决定，不能写死仓库员角色");
assert.match(stockListView, /canFilterOwner\s*\?\s*<UserScopeSelect permission="stock\.data_all"/,
  "备货归属销售员筛选应随跨用户数据权限显示");
assert.match(read("app/stock-orders/page.tsx"), /canFilterOwner=\{hasPermission\(account,"stock\.data_all"\)\}/,
  "备货筛选权限应在服务端首屏确定");
assert.doesNotMatch(userOptionsApi, /creatorOptions\s*&&\s*!\["ADMIN",\s*"ORDER_CLERK"\]/,
  "制单人选项接口不能在数据权限之外再按角色拒绝仓库员");
assert.match(userScopeSelect, /setCanSelectAll\(Boolean\(body\.can_select_all\)\)/,
  "全员选项应与服务端授权范围一致");
assert.match(piForm, /const customerRequest = fetch\("\/api\/orders\/pi-customers"[\s\S]*setSalespeople\(body\.salespeople \|\| \[\]\)[\s\S]*Promise\.all/,
  "跟单员销售员选项应在独立请求完成后立即显示，不等待收款账户和汇率");
assert.match(piForm, /salespeopleLoading \? "正在加载销售员…"[\s\S]*重试加载销售员/,
  "销售员选项加载和失败状态必须明确可见并可重试");
assert.match(priceMigration, /insert into public\.audit_logs\(user_id,action,target_type,target_id,content\)[\s\S]*'PI_LINE_PRICE_CORRECTED'/,
  "每次PI售价或成本更正均需留存操作者和修改前后值");
assert.match(detailView, /价格更正记录[\s\S]*entry\.actor_name[\s\S]*entry\.content\.reason/,
  "PI详情应显示价格更正操作者和原因");
console.log("PI creator-only scope contracts passed.");
