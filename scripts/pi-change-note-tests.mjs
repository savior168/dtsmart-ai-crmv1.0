import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { numberedPiChangeNote } from "../lib/pi-change-note.ts";

assert.equal(numberedPiChangeNote("标签改蓝色\n\n2、保护膜保留\n3. 印章位置调整"),
  "1. 标签改蓝色\n2. 保护膜保留\n3. 印章位置调整");
assert.equal(numberedPiChangeNote("  \n"), "");
const form = readFileSync(new URL("../components/pi-order-form.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261014072155_pi_order_change_note.sql", import.meta.url), "utf8");
const stockDetailApi = readFileSync(new URL("../app/api/stock-orders/[id]/route.ts", import.meta.url), "utf8");
const stockDetailView = readFileSync(new URL("../components/stock-order-detail-view.tsx", import.meta.url), "utf8");
assert.match(stockDetailApi, /prepared_by,confirmation_note,created_at/,
  "备货详情应读取当前PI变更说明，而非只在列表和导出中展示");
assert.match(stockDetailApi, /order_change_note: piDelivery\.data\?\.confirmation_note \|\| null/);
assert.match(readFileSync(new URL("../components/stock-order-detail-view.tsx", import.meta.url), "utf8"), /PI订单变更说明 · 仓库请核对[\s\S]*border-l-2 border-amber-500[\s\S]*text-amber-950/,
  "仓库详情须将撤回重提后的PI变更说明醒目标记");
assert.match(stockDetailView, /PI订单变更说明 · 仓库请核对/);
assert.match(stockDetailView, /产品项与数量以本页正式备货明细为准/,
  "变更说明不得替代已生效的产品和数量");
assert.match(form, /确认并生成备货单/);
assert.match(form, /\/api\/orders\/\$\{orderId\}\/submit/);
assert.match(form, /PI 草稿已保存，请重试上传\/提交或进入详情核对/);
assert.match(form, /本栏位详细说明标签\/印章\/保护膜等作业的要求，无要求则备注常规理货/);
assert.match(migration, /target\.status<>'DRAFT'/);
assert.match(migration, /target\.pi_revision is distinct from p_expected_revision/);
assert.match(migration, /current_user_has_business_permission\('orders\.edit'\)/);
assert.match(migration, /revoke execute on function public\.set_direct_pi_change_note.*public,anon/);
console.log("PI变更说明编号、草稿提交入口与数据库权限约束静态回归通过。");
