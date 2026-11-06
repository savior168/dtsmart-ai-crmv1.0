import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261106120000_atomic_batch_supplier_receipts.sql");
const route = read("app/api/stock-orders/[id]/receipts/batch/route.ts");
const view = read("components/stock-order-detail-view.tsx");

assert.match(migration, /group by x\.item_id order by x\.item_id[\s\S]*各来源回货数量合计超过未回货数/,
  "数据库必须锁定产品行并按所有供应来源的回货数量总和校验上限");
assert.match(migration, /jsonb_agg\(jsonb_build_object\([\s\S]*i\.received_quantity \+ grouped\.quantity[\s\S]*group by x\.item_id/,
  "物理回货进度必须按产品汇总后仅提交一条累计值");
assert.match(migration, /grouped\.supplier_count = 1 then supplier\.system_code else null/,
  "多供应商来源不可伪装成单一供应商代码，明细以送货分配台账为准");
assert.doesNotMatch(route, /new Set\(lines\.map\(\(line\) => line\.stock_order_item_id\)\)\.size !== lines\.length/,
  "接口必须允许同一产品在一个批次拆分多条供应商/送货单来源");
assert.match(view, /function addBatchReceiptSource\(itemId: string\)/,
  "批量登记界面必须支持为产品行增加供应商/送货单来源");
assert.match(view, /rowId: crypto\.randomUUID\(\)[\s\S]*setBatchReceiptDraft\(\(current\) => current \? \[\.\.\.current, \{/,
  "重复产品来源必须拥有独立行标识并可分别编辑");
assert.match(view, /const invalidAggregate = batchReceiptDraft\.some\([\s\S]*total > item\.quantity - item\.received_quantity/,
  "前端必须按产品汇总校验多供应来源数量不超过剩余未回数");
assert.match(view, /＋ 添加来源/,
  "仓库员必须能直观添加同一产品的其他供应商或送货单");

console.log("supplier batch split receipt tests passed");
