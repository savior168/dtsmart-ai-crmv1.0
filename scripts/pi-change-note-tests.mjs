import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { numberedPiChangeNote } from "../lib/pi-change-note.ts";

assert.equal(numberedPiChangeNote("标签改蓝色\n\n2、保护膜保留\n3. 印章位置调整"),
  "1. 标签改蓝色\n2. 保护膜保留\n3. 印章位置调整");
assert.equal(numberedPiChangeNote("  \n"), "");
const form = readFileSync(new URL("../components/pi-order-form.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261014190000_pi_order_change_note.sql", import.meta.url), "utf8");
assert.match(form, /确认并生成备货单/);
assert.match(form, /\/api\/orders\/\$\{saved\.id\}\/submit/);
assert.match(form, /PI草稿已保存，请进入详情核对后重试/);
assert.match(form, /本栏位详细说明标签\/印章\/保护膜等作业的要求，无要求则备注常规理货/);
assert.match(migration, /target\.status<>'DRAFT'/);
assert.match(migration, /target\.pi_revision is distinct from p_expected_revision/);
assert.match(migration, /current_user_has_business_permission\('orders\.edit'\)/);
assert.match(migration, /revoke execute on function public\.set_direct_pi_change_note.*public,anon/);
console.log("PI变更说明编号、草稿提交入口与数据库权限约束静态回归通过。");
