import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261120030244_stock_purchase_price_correction_by_receipt.sql");
const detail = read("app/api/stock-orders/[id]/route.ts");
const endpoint = read("app/api/stock-orders/[id]/receipt-price/route.ts");
const view = read("components/stock-order-detail-view.tsx");

assert.match(migration, /target\.status in \('DRAFT', 'CANCELLED'\)/, "有效备货阶段不得被采购价编辑限制");
assert.match(detail, /can_edit_procurement: canViewProcurement && !order\.archived_at && !\["DRAFT", "CANCELLED"\]\.includes\(order\.status\)/);
assert.match(migration, /stock\.archived_at is not null/, "已归档备货单不能更正回货采购价");
assert.match(migration, /app\.stock_procurement_price_apply/, "已交货代的价格元数据更正不得修改实物进度");
assert.match(migration, /supplier_receipt_allocations[\s\S]*having sum\(a\.quantity\) > 0/, "已回货产品不能只改备货行默认价");
assert.match(migration, /create function public\.correct_supplier_receipt_purchase_price[\s\S]*supplier_delivery_notes where id = allocation\.delivery_note_id for update/, "同一送货单的改价与付款须串行化");
assert.match(migration, /exists \(select 1 from public\.supplier_payments where delivery_note_id = note\.id\)[\s\S]*已有付款/, "已付款送货单不得由仓库直接改价");
assert.match(migration, /p_expected_price_cny[\s\S]*送货单采购价已变化/, "并发改价须使用原价校验");
assert.match(migration, /SUPPLIER_RECEIPT_PRICE_CORRECTED[\s\S]*before_cny[\s\S]*after_cny[\s\S]*amount_delta_cny/, "原价、新价、差额及原因须留痕");
assert.match(endpoint, /requirePermission\("stock\.procurement\.edit"\)[\s\S]*correct_supplier_receipt_purchase_price/, "更正接口须重复核权");
assert.match(view, /receiptBackedItemIds[\s\S]*已回货 · 在下方送货单更正/, "已回货产品应引导到真实账款来源更正");
assert.match(view, /更正送货单采购价[\s\S]*已登记付款的送货单不能由仓库直接改价/, "已付款限制应在提交前说明");

console.log("Stock purchase price correction contracts passed.");
