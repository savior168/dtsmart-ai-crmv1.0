import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import { buildQuoteWorkbook, buildStockWorkbook } from "../lib/template-xlsx.ts";
import { buildWorkbookZip, mapExportBatches, streamZipBytes } from "../lib/batch-xlsx-zip.ts";

const items = Array.from({ length: 12 }, (_, index) => ({
  item_name: `Screen ${index + 1}`,
  product_type_snapshot: "屏幕",
  product_specifications_snapshot: { assembly: "单片屏", panel_subtype: "软 OLED" },
  product_color_snapshot: "深蓝色",
  brand: "Brand",
  model: `M${index + 1}`,
  quality: "Original",
  description: "OLED display",
  description_zh: "屏幕",
  quantity: index + 1,
  unit_price: 10.5,
  procurement_cost: 6.25,
  procurement_cost_confirmed: index !== 0,
  estimated_unit_cost_cny: 8.5,
  received_quantity: 3,
  warehouse_supplier_code: "SUPPLIER-PRIVATE",
  preparation_requirement: "Label",
  internal_note: "Keep dry",
}));

const quoteBuffer = await buildQuoteWorkbook({
  quote_number: "PI-TEST-001",
  currency: "USD",
  valid_until: "2026-09-30",
  payment_method: "T/T",
  delivery_date: "2026-10-05",
  customer_short_name: "Demo",
  destination_country: "DE",
  stocking_requirements: "Pack",
  shipping_cost: 25,
  subtotal: 819,
  total_amount: 844,
  created_at: new Date().toISOString(),
  owner: { name: "Eva", email: "eva@example.com", phone: "8613800000000" },
  customer: { company_name: "Demo GmbH", contact_name: "Tom", phone: "491234567" },
}, items);

const stockBuffer = await buildStockWorkbook({
  stock_number: "BH-TEST-001",
  order_number: "ORDER-TEST-001",
  quote_number: "PI-TEST-001",
  customer_short_name: "Demo",
  destination_country: "DE",
  stocking_requirements: "Pack",
  order_change_note: "1. Add 2 items\n2. Update delivery date\n3. New label",
  status_note: "",
  status_label: "部分已交货代",
  shipped_at: "2026-10-13T09:00:00Z",
  delivery_recipient: "Tom",
  delivery_phone: "+49 123",
  delivery_email: "tom@example.com",
  delivery_address: "Berlin",
  created_at: new Date().toISOString(),
  salesperson: { name: "Eva", email: "eva@example.com" },
}, items);

function firstSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellStyles: true });
  return workbook.Sheets[workbook.SheetNames[0]];
}

function containsMedia(buffer) {
  const archive = XLSX.CFB.read(buffer, { type: "buffer" });
  return archive.FullPaths.some((entry) => entry.includes("/xl/media/"));
}

const manyFiles = Array.from({ length: 60 }, (_, index) => ({ name: `D${index + 1}-备货单.xlsx`, data: stockBuffer }));
const archiveBytes = buildWorkbookZip(manyFiles);
const streamedChunks = [];
for await (const chunk of streamZipBytes(archiveBytes)) streamedChunks.push(chunk);
const streamedArchive = Buffer.concat(streamedChunks.map((chunk) => Buffer.from(chunk)));
assert.deepEqual(streamedArchive, archiveBytes, "分块响应不得截断ZIP内容");
const archivedNames = [];
for (let offset = 0; offset < streamedArchive.length && streamedArchive.readUInt32LE(offset) === 0x04034b50;) {
  assert.equal(streamedArchive.readUInt16LE(offset + 6) & 0x0800, 0x0800, "ZIP文件名必须标记UTF-8编码");
  const nameLength = streamedArchive.readUInt16LE(offset + 26);
  const extraLength = streamedArchive.readUInt16LE(offset + 28);
  archivedNames.push(streamedArchive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
  offset += 30 + nameLength + extraLength + streamedArchive.readUInt32LE(offset + 18);
}
assert.deepEqual(archivedNames, manyFiles.map((file) => file.name), "批量导出必须完整包含超过一页的筛选结果且中文文件名正确");
const bounded = await mapExportBatches(Array.from({ length: 12 }, (_, index) => index), 4, async (index) => index * 2);
assert.deepEqual(bounded, Array.from({ length: 12 }, (_, index) => index * 2));
for (const routePath of ["app/api/orders/route.ts", "app/api/stock-orders/route.ts"]) {
  const route = readFileSync(routePath, "utf8");
  assert.match(route, /for \(let offset = rows\.length; offset < count; offset \+= 500\)/, "筛选导出必须读取全部分页结果");
  assert.match(route, /streamZipBytes\(zip\)/, "批量ZIP响应必须分块传输");
  assert.match(route, /\[10, 20, 50, 100, 300, 500\]\.includes\(requestedPageSize\)/, "PI与备货列表必须统一每页选项");
  assert.doesNotMatch(route, /count > 50\)|exporting \? 49\b/, "不得把批量导出固定限制为50张");
}

const quote = firstSheet(quoteBuffer);
assert.equal(quote.J2.v, "PI-TEST-001");
assert.equal(quote.B19.v, "Screen 1");
assert.match(quote.G19.v, /Color: 深蓝色/, "PI 应显示报价保存时的颜色快照");
assert.equal(quote.B30.v, "Screen 12");
assert.equal(quote.K19.f, 'IF(OR(I19="",J19=""),"",ROUND(I19*J19,2))');
assert.equal(quote.K30.f, 'IF(OR(I30="",J30=""),"",ROUND(I30*J30,2))');
assert.equal(quote.J31.f, "SUM(J19:J30)");
assert.equal(quote.K31.f, "SUM(K19:K30)");
assert.equal(quote.K33.f, "K31+K32");
assert.ok(quote.B19.s, "报价产品行样式必须保留");
assert.ok(containsMedia(quoteBuffer), "报价单必须保留企业 Logo");

const stock = firstSheet(stockBuffer);
assert.equal(stock.G3.v, "ORDER-TEST-001");
assert.equal(stock.K3.v, "德国", "目的国家须显示中文名称而非代码");
assert.equal(stock.N3.v, "2026-10-13", "实际发货日须来自已发货事件");
assert.equal(stock.B10.v, "备货状态：部分已交货代", "备货 Excel 状态须与详情和预览共用同一口径");
assert.match(stock.D9.v, /姓名：Tom.*电话：\+49 123\n邮箱：tom@example.com\n地址：Berlin/, "收货信息须按姓名、电话、邮箱和地址分项显示");
assert.match(stock.B9.v, /收件人.*详细收件地址/s, "不得覆盖下单表模板的固定标签");
assert.match(stock.B4.v, /订单变更说明/, "不得用仓库状态备注覆盖订单变更说明栏");
assert.equal(stock.C5.v, "Add 2 items");
assert.equal(stock.C6.v, "Update delivery date");
assert.equal(stock.C7.v, "New label");
assert.match(stock.H4.v, /【理货要求】/, "理货要求须保留模板固定说明");
assert.equal(stock.K4.v, "Pack", "实际理货要求须写入模板右侧内容区");
assert.equal(stock.N13.v, "理货要求：Label\n仓库备注：Keep dry", "逐项理货要求和仓库备注须在同一单元格分行显示");
assert.doesNotMatch(stock.N13.v, /已回货|供应商编码|SUPPLIER-PRIVATE/, "标准备货单不应混入动态回货进度或供应商编码");
assert.equal(stock.B8.v, "外箱唛头：", "不得清空模板固定标签");
assert.equal(stock.C13.v, "屏幕");
assert.equal(stock.L13.v, "屏幕", "备货模板的后端中文描述只能使用 PI 独立输入值，不得拼接颜色或规格");
assert.equal(stock.C24.v, "屏幕");
assert.equal(stock.B11.f, "SUM(K13:K999)");
assert.equal(stock.J11.f, 'IF(COUNT(J13:J999)<COUNT(K13:K999),"",SUMPRODUCT(J13:J999,K13:K999))');
assert.equal(stock.J11.v, 663, "总成本应展示PI预估成本单价乘以订购数量的合计");
assert.equal(stock.J13.v, 8.5, "成本单价必须来自PI预估成本，与采购确认价无关");
assert.equal(stock.J14.v, 8.5, "每行预估成本均须带入备货单");
for (const [cell, label] of Object.entries({ C12: "产品类型", E12: "产品品牌", F12: "产品型号", G12: "产品质量（展示给客户）", H12: "产品描述（展示给客户）", J12: "成本单价", K12: "订单数量", L12: "产品质量/描述中文（展示给后端）", N12: "注意事项及理货要求（展示给后端）" })) {
  assert.equal(stock[cell].v, label, `备货 Excel 的 ${cell} 列名称须与指定模板一致`);
}
const stockPreviewSource = readFileSync("components/order-print-preview.tsx", "utf8").split("{stock?<>")[1]?.split("</>:null}")[0] || "";
for (const label of ["产品质量", "产品描述", "成本单价", "订单数量", "产品质量/描述中文", "注意事项及理货要求"]) assert.ok(stockPreviewSource.includes(label), `备货预览须显示模板列头 ${label}`);
assert.match(stockPreviewSource, /\[4,5,8,9\]\.includes\(index\)/, "备货预览的产品质量和产品描述都须标明展示给客户");
assert.doesNotMatch(stockPreviewSource, /成本单价（人民币）|"理货要求","仓库备注"/, "备货预览列头不得与模板不一致");
assert.match(stockPreviewSource, /采购成本/, "备货预览须显示采购成本汇总");
assert.match(stockPreviewSource, /text-\[\#986C47\]/, "整单和单项理货提醒须使用一致的柔和字体颜色");
assert.ok(stock.C13.s, "备货产品行样式必须保留");
const stockTemplate = XLSX.readFile("assets/templates/Warehouse_Stock_Template.xlsx", { cellStyles: true }).Sheets["工作表1"];
assert.deepEqual(stock["!merges"], stockTemplate["!merges"], "备货单须保留模板合并单元格");
assert.deepEqual(stock["!cols"], stockTemplate["!cols"], "备货单须保留模板列宽");
assert.ok(stock["!rows"][8].hpt > stockTemplate["!rows"][8].hpt, "收件资料分项显示时须加高行距");
assert.ok(stock["!rows"][12].hpt > stockTemplate["!rows"][12].hpt, "有逐项理货要求时须加高行距避免截断");
assert.ok(stock["!rows"][12].hpt <= 45, "短理货备注与相邻描述应保持适中的行高");
const stockPackage = XLSX.CFB.read(stockBuffer, { type: "buffer" });
const stockStylesXml = Buffer.from(XLSX.CFB.find(stockPackage, "/xl/styles.xml").content).toString("utf8");
assert.doesNotMatch(stockStylesXml, /<fill\s*\/>/, "备货 Excel 不得包含其他 OOXML 阅读器无法解析的空填充样式");
assert.match(stock.J11.z, /^"采购成本 ∑= "/, "采购成本汇总标签须保持模板原文且不重复标注人民币");
const stockSheetXml = Buffer.from(XLSX.CFB.find(stockPackage, "/xl/worksheets/sheet1.xml").content).toString("utf8");
const noteFontId = Number(stockStylesXml.match(/<fonts count="(\d+)"/)[1]) - 1;
assert.match(stockStylesXml, /<font><sz val="9"\/><color rgb="FF986C47"\/><name val="微软雅黑"\/><\/font>/, "逐项备注应使用较小的柔和色字体而非深色粗体");
const noteStyleId = Number(stockSheetXml.match(/<(?:x:)?c r="N13" s="(\d+)"/)[1]);
const xfs = [...stockStylesXml.match(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map((match) => match[0]);
assert.match(xfs[noteStyleId], new RegExp(`fontId="${noteFontId}"`), "含内容的逐项备注应实际应用柔和字体样式");
const totalRequirementStyleId = Number(stockSheetXml.match(/<(?:x:)?c r="K4" s="(\d+)"/)[1]);
assert.equal(totalRequirementStyleId, noteStyleId, "整单理货要求须与单项注意事项使用完全一致的柔和字体样式");

await mkdir(".tmp", { recursive: true });
await writeFile(".tmp/quote-template-regression.xlsx", quoteBuffer);
await writeFile(".tmp/stock-template-regression.xlsx", stockBuffer);
console.log("报价单与备货单模板导出回归测试通过。");

