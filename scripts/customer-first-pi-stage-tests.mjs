import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const migration = await readFile(resolve("supabase/migrations/202610170002_first_pi_full_shipment_promotes_customer.sql"), "utf8");
const shipment = await readFile(resolve("supabase/migrations/20261016080000_stock_line_shipments.sql"), "utf8");
assert.match(shipment, /when total_shipped=total_ordered then 'SHIPPED'/,
  "只有全部产品数量已交货代，整单才进入 SHIPPED");
assert.match(migration, /new\.status = 'SHIPPED' and old\.status is distinct from new\.status/,
  "部分发货或重复保存不得触发成交升级");
assert.match(migration, /confirmed_at is not null[\s\S]*status not in \('DRAFT', 'CANCELLED'\)[\s\S]*order by confirmed_at, created_at, id limit 1/,
  "首单应是最早确认提交且未取消的 PI，不能把草稿或取消单算作首单");
assert.match(migration, /first_stock\.status <> 'SHIPPED'/,
  "后续 PI 发货不能替代首单整单发货");
assert.match(migration, /not exists \(select 1 from public\.stock_order_items[\s\S]*shipped_quantity is distinct from i\.quantity/,
  "状态之外还要校验所有单项数量都已完整发货");
assert.match(migration, /customer_row\.status not in \('CLAIMED', 'FOLLOWING'\)/,
  "只有潜在或意向客户会被系统升级");
assert.match(migration, /old\.phone is distinct from new\.phone or old\.email is distinct from new\.email/,
  "联系方式缺项时，补齐后应自动重试而不阻断发货");
assert.match(migration, /customer_protection set status = 'SUPERSEDED'[\s\S]*'DEAL', now\(\), null, 'ACTIVE'/,
  "客户阶段升级必须同步永久保护期");
assert.match(migration, /insert into public\.customer_status_history[\s\S]*insert into public\.audit_logs/,
  "自动变更必须留下阶段历史与审计记录");
console.log("首张 PI 整单发货升级客户阶段静态回归测试通过。");
