import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/202609020001_customer_public_pool_workflow.sql");
const poolApi = read("app/api/customers/public-pool/route.ts");
const userApi = read("app/api/admin/users/route.ts");
const orderApi = read("app/api/orders/route.ts");
const sidebar = read("components/app-shell.tsx");

assert.match(migration, /target\.owner_id is not null[\s\S]*已被认领或不属于管理员可分配范围/, "管理员批量分配必须拒绝已有归属客户");
assert.match(migration, /source_user\.status not in \('DISABLED','DEPARTED'\)/, "离职交接仅允许停用或离职账号");
assert.match(migration, /request_owner\.manager_id is distinct from actor\.id/, "主管只能审核直属销售员续期");
assert.match(migration, /next_count<=2 or actor\.role='SUPERVISOR'/, "销售前两次自动续期、主管本人无需审批");
assert.match(migration, /effective_expire-interval '15 days'/, "续期需在到期前15天开放");
assert.match(migration, /effective_expire\+interval '3 days'/, "续期宽限期必须限制为3天");
assert.match(migration, /acquisition_scope='PUBLIC_POOL' then 'AVAILABLE' else 'PENDING_ALLOCATION'/, "释放后公海与私有客户必须分流");
assert.match(migration, /lower\(trim\(coalesce\(name,''\)\)\)='eva'/i, "销售员默认上级应优先 Eva");
assert.match(migration, /CUSTOMER_ACCOUNT_HANDOVER/, "离职交接必须写入审计日志");
assert.match(poolApi, /contact_masked: !full/, "已认领公海客户必须对非归属销售员脱敏");
assert.match(poolApi, /own \|\| elevated/, "仅归属人或高级只读角色可打开完整客户详情");
assert.match(userApi, /historyCount > 0/, "存在业务历史的账号不得物理删除");
assert.match(userApi, /action === "CREATE"/, "系统管理员应能新增用户");
assert.match(userApi, /action === "UPDATE_MANAGER"/, "系统管理员应能修改销售直属上级");
assert.doesNotMatch(orderApi, /stock:stock_orders\(/, "销售订单列表不得使用存在双外键歧义的嵌套关系");
assert.match(orderApi, /\.in\("sales_order_id", orderIds\)/, "备货单应按明确 sales_order_id 查询并合并");
assert.match(sidebar, /dtsmart-sidebar-collapsed/, "侧栏收起状态应跨页面持久化");
assert.match(sidebar, /href: "\/customers\/pool"/, "客户中心必须提供客户公海入口");

console.log("customer public-pool regression tests passed");
