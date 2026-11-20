import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261106083932_atomic_batch_supplier_receipts_20261106.sql");
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
assert.match(view, /本批统一来源（同一供应商\/送货单时填写一次）/,
  "同一批次来源应有独立的一次性输入区，避免在每个产品行重复录入");
assert.match(view, /function applyBatchSourceToAll\(\)[\s\S]*batchReceiptSourceDraft\.supplierId[\s\S]*batchReceiptSourceDraft\.noteNumber[\s\S]*documentDate: batchReceiptSourceDraft\.documentDate/,
  "统一来源应用必须把供应商、送货单号和日期复制到所有产品行");
assert.match(view, /来源不同的产品可在下方逐项修改/,
  "特殊来源仍必须允许产品行单独修改");
assert.match(view, /supplierCode: "",\s*supplierId: "",\s*noteNumber: "",\s*documentDate: today/,
  "新的回货分配不得继承可能过期的默认供应商代码或旧送货单号");
assert.doesNotMatch(view, /prior\?\.supplier_code \|\| item\.warehouse_supplier_code/,
  "不得把产品档案上的历史供应商代码误当成本次实际采购来源");
assert.match(view, /产品第 \{item\.line_number\} 项 · 来源 \{sourceIndex\}\/\{itemSourceRows\.length\}/,
  "同一 PI 产品拆分多条来源时必须标明这是来源分配而非新增订单产品");
assert.match(view, /title="为同一 PI 产品增加一条供应商\/送货单分配，不会增加订单产品数量"/,
  "添加来源操作必须明确说明仅增加来源分配，不增加订单产品数量");
assert.match(view, /function addBatchReceiptSource\(itemId: string\)[\s\S]*setBatchReceiptDraft\(\(current\) => \{[\s\S]*rowId: crypto\.randomUUID\(\), itemId/,
  "重复产品来源必须拥有独立行标识并可分别编辑");
assert.match(view, /const prior = \[\.\.\.current\]\.reverse\(\)\.find\(\(line\) => line\.itemId === itemId\)[\s\S]*supplierId: prior\?\.supplierId[\s\S]*supplierCode: prior\?\.supplierCode[\s\S]*noteNumber: ""/,
  "新增同一产品送货单时沿用上一行供应商，但必须重新填写单号和单价");
assert.match(view, /const invalidAggregate = batchReceiptDraft\.some\([\s\S]*total > item\.quantity - item\.received_quantity/,
  "前端必须按产品汇总校验多供应来源数量不超过剩余未回数");
assert.match(view, /＋ 拆分来源/,
  "仓库员必须能直观添加同一产品的其他供应商或送货单");
assert.match(view, /async function openReceipt\(item: Item\)[\s\S]*setBatchReceiptDraft\(\[\{ rowId: crypto\.randomUUID\(\), itemId: item\.id/,
  "单项入口须直接打开可拆分来源的统一登记表单");
assert.doesNotMatch(view, /splitSingleReceipt|receiptDraft/,
  "单项登记不得保留需要二次跳转的旧弹框");
assert.match(view, /singleReceiptItem \? "单项产品分来源登记回货"[\s\S]*!singleReceiptItem \? <div/,
  "单项拆分应复用原子批量提交表单，但不显示多产品统一来源区");
assert.match(view, /本次已分配 \{singleReceiptQuantity\} \/ 剩余可回 \{singleReceiptItem\.quantity - singleReceiptItem\.received_quantity\}/,
  "单项拆分须实时显示各来源数量合计和剩余可回数量");
assert.match(view, /supplierCodeSearchOptions[\s\S]*搜索或输入供应商代码/,
  "供应商代码搜索候选必须只展示代码并提供空值占位");
assert.equal((view.match(/<AppSelect aria-label=.*供应商代码[^>]*allowCustomValue/g) || []).length, 2,
  "本批统一来源及产品来源行必须复用系统 AppSelect 搜索匹配控件并允许手工输入");
assert.match(view, /findLastIndex\(\(line\) => line\.itemId === itemId\) \+ 1[\s\S]*next\.splice\(insertAt, 0/,
  "拆分来源须插在同一产品最后一条来源之后，不得甩到整批末尾");
assert.doesNotMatch(view, /现场现金金额|cashPaidReported/,
  "回货登记表单暂不展示现场现金金额");
assert.doesNotMatch(view, /<datalist|list="(?:receipt|batch-receipt)-supplier-codes"/,
  "供应商代码选择不得退回浏览器原生 datalist 控件");
const appSelect = readFileSync("components/ui/app-select.tsx", "utf8");
assert.match(appSelect, /allowCustomValue = false[\s\S]*chooseCustomValue[\s\S]*使用输入代码/,
  "系统统一下拉必须支持确认使用手动输入代码");
assert.match(appSelect, /onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}[\s\S]*使用输入代码/,
  "键盘确认手动输入代码时不得误选候选项");

console.log("supplier batch split receipt tests passed");
