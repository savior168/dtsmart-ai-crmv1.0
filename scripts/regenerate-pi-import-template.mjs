import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { QUOTE_CURRENCIES } from "../lib/currencies.ts";
import { PI_PAYMENT_CHANNELS } from "../lib/pi-payment-channel.ts";

const file = "assets/templates/PI_Import_Template.xlsx";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const source = process.argv.includes("--from-head")
  ? execFileSync("git", ["show", "HEAD:assets/templates/PI_Import_Template.xlsx"], { maxBuffer: 8 * 1024 * 1024 })
  : readFileSync(file);
const workbook = XLSX.CFB.read(source, { type: "buffer" });
const worksheetPart = XLSX.CFB.find(workbook, "/xl/worksheets/sheet1.xml");
if (!worksheetPart?.content) throw new Error("PI导入模板缺少第一张工作表");
let worksheetXml = Buffer.from(worksheetPart.content).toString("utf8");

function ensureRow(rowNumber) {
  const rowStart = worksheetXml.indexOf(`<x:row r="${rowNumber}"`);
  if (rowStart >= 0) return rowStart;
  const row = `<x:row r="${rowNumber}" ht="22" customHeight="1"></x:row>`;
  const rows = [...worksheetXml.matchAll(/<x:row r="(\d+)"/g)];
  const next = rows.find((match) => Number(match[1]) > rowNumber);
  const insertAt = next?.index ?? worksheetXml.indexOf("</x:sheetData>");
  if (insertAt < 0) throw new Error("PI导入模板工作表缺少行结束位置");
  worksheetXml = worksheetXml.slice(0, insertAt) + row + worksheetXml.slice(insertAt);
  return worksheetXml.indexOf(row);
}

function insertCellInRow(rowNumber, cell) {
  const rowStart = ensureRow(rowNumber);
  const rowEnd = worksheetXml.indexOf("</x:row>", rowStart);
  if (rowEnd < 0) throw new Error(`PI导入模板第${rowNumber}行结构异常`);
  worksheetXml = worksheetXml.slice(0, rowEnd) + cell + worksheetXml.slice(rowEnd);
}

function findCell(cellAddress) {
  const marker = `r="${cellAddress}"`;
  const markerIndex = worksheetXml.indexOf(marker);
  if (markerIndex < 0) return null;
  const index = worksheetXml.lastIndexOf("<x:c", markerIndex);
  if (index < 0) return null;
  const openEnd = worksheetXml.indexOf(">", markerIndex);
  if (openEnd < 0) return null;
  const selfClosing = worksheetXml.slice(index, openEnd + 1).endsWith("/>");
  const end = selfClosing ? openEnd + 1 : worksheetXml.indexOf("</x:c>", openEnd) + 6;
  if (end <= 5) return null;
  return { index, text: worksheetXml.slice(index, end) };
}

function replaceCell(address, attributes, body, styleFrom = address) {
  const styleCell = findCell(styleFrom);
  const originalStyle = styleCell?.text.match(/\bs="(\d+)"/)?.[1] || "0";
  const replacement = `<x:c r="${address}" s="${originalStyle}" ${attributes}>${body}</x:c>`;
  const current = findCell(address);
  if (current) {
    worksheetXml = worksheetXml.slice(0, current.index) + replacement + worksheetXml.slice(current.index + current.text.length);
    return;
  }
  const rowNumber = Number(address.match(/\d+$/)?.[0]);
  insertCellInRow(rowNumber, replacement);
}

function moveCell(from, to) {
  const match = findCell(from);
  if (!match) throw new Error(`PI导入模板缺少单元格 ${from}`);
  const cell = match.text.replace(`r="${from}"`, `r="${to}"`);
  worksheetXml = worksheetXml.slice(0, match.index) + worksheetXml.slice(match.index + match.text.length);
  const rowNumber = Number(to.match(/\d+$/)?.[0]);
  insertCellInRow(rowNumber, cell);
}

function removeCell(address) {
  const match = findCell(address);
  if (!match) return;
  worksheetXml = worksheetXml.slice(0, match.index) + worksheetXml.slice(match.index + match.text.length);
}
const requiredLabel = (label) => `<x:is><x:r><x:rPr><x:rFont val="Arial"/><x:b/><x:color rgb="FFC62828"/><x:sz val="10"/></x:rPr><x:t>*</x:t></x:r><x:r><x:rPr><x:rFont val="Arial"/><x:color rgb="FF17243A"/><x:sz val="10"/></x:rPr><x:t xml:space="preserve"> ${label}</x:t></x:r></x:is>`;

// Keep the export-like invoice layout while adding the fields needed to map a full import safely.
replaceCell("G4", 't="inlineStr"', requiredLabel("PI有效期"), "A13");
replaceCell("I2", 't="inlineStr"', requiredLabel("订单编号"), "A13");
replaceCell("J4", 't="inlineStr"', '<x:is><x:t></x:t></x:is>', "J6");
replaceCell("G6", 't="inlineStr"', requiredLabel("客户付款币种"), "A13");
replaceCell("J6", 't="inlineStr"', '<x:is><x:t></x:t></x:is>');
replaceCell("G7", 't="inlineStr"', requiredLabel("汇率（1外币兑人民币）"), "A13");
replaceCell("J7", 't="inlineStr"', '<x:is><x:t></x:t></x:is>', "J6");
replaceCell("G8", 't="inlineStr"', '<x:is><x:t>付款渠道（选填）</x:t></x:is>', "I2");
replaceCell("J8", 't="inlineStr"', '<x:is><x:t></x:t></x:is>', "J6");
replaceCell("G9", 't="inlineStr"', '<x:is><x:t>预计交付日期（选填）</x:t></x:is>', "I2");
replaceCell("J9", 't="inlineStr"', '<x:is><x:t></x:t></x:is>', "J6");
replaceCell("G10", 't="inlineStr"', '<x:is><x:t>所属销售员登录邮箱（选填）</x:t></x:is>', "I2");
replaceCell("J10", 't="inlineStr"', '<x:is><x:t></x:t></x:is>', "J6");
replaceCell("A13", 't="inlineStr"', '<x:is><x:t>Company（选填）:</x:t></x:is>');
replaceCell("A14", 't="inlineStr"', '<x:is><x:t>Tax No.（选填）:</x:t></x:is>');
replaceCell("A15", 't="inlineStr"', `<x:is><x:r><x:rPr><x:rFont val="Arial"/><x:color rgb="FF17243A"/><x:sz val="10"/></x:rPr><x:t>To: </x:t></x:r><x:r><x:rPr><x:rFont val="Arial"/><x:b/><x:color rgb="FFC62828"/><x:sz val="10"/></x:rPr><x:t>*</x:t></x:r></x:is>`, "A13");
replaceCell("D13", 't="inlineStr"', '<x:is><x:t></x:t></x:is>', "J6");
replaceCell("D14", 't="inlineStr"', '<x:is><x:t></x:t></x:is>', "J6");
replaceCell("D15", 't="inlineStr"', '<x:is><x:t></x:t></x:is>', "J6");
replaceCell("D16", 't="inlineStr"', '<x:is><x:t></x:t></x:is>', "J6");
replaceCell("G13", 't="inlineStr"', `<x:is><x:r><x:rPr><x:rFont val="Arial"/><x:color rgb="FF17243A"/><x:sz val="10"/></x:rPr><x:t>Delivery address: </x:t></x:r><x:r><x:rPr><x:rFont val="Arial"/><x:b/><x:color rgb="FFC62828"/><x:sz val="10"/></x:rPr><x:t>*</x:t></x:r></x:is>`, "A13");
replaceCell("G14", 't="inlineStr"', '<x:is><x:t></x:t></x:is>', "J6");
worksheetXml = worksheetXml.replace('<x:mergeCell ref="G13:K16"/>', '<x:mergeCell ref="G13:K13"/><x:mergeCell ref="G14:K16"/>');
worksheetXml = worksheetXml
  .replace('ref="G13:K13"', 'ref="G13:M13"')
  .replace('ref="G14:K16"', 'ref="G14:M16"')
  .replace('<x:col min="10" max="10" width="13" hidden="0" customWidth="1"/>', '<x:col min="10" max="10" width="18" hidden="0" customWidth="1"/>')
  .replace('<x:col min="11" max="11" width="20" hidden="0" customWidth="1"/>', '<x:col min="11" max="11" width="13" hidden="0" customWidth="1"/>')
  .replace('</x:cols>', '<x:col min="12" max="12" width="16" hidden="0" customWidth="1"/><x:col min="13" max="13" width="16" hidden="0" customWidth="1"/></x:cols>');
const currencyList = QUOTE_CURRENCIES.map(([code]) => code).join(",");
const channelList = PI_PAYMENT_CHANNELS.join(",");
const validations = `<x:dataValidations count="8"><x:dataValidation type="list" allowBlank="0" showErrorMessage="1" errorTitle="请选择币种" error="请从下拉列表选择系统支持的付款币种" sqref="J6"><x:formula1>"${currencyList}"</x:formula1></x:dataValidation><x:dataValidation type="decimal" operator="greaterThan" allowBlank="0" showErrorMessage="1" errorTitle="汇率必填" error="请输入大于0的人民币兑外币汇率" sqref="J7"><x:formula1>0</x:formula1></x:dataValidation><x:dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="付款渠道" error="请选择系统支持的付款渠道" sqref="J8"><x:formula1>"${channelList}"</x:formula1></x:dataValidation><x:dataValidation type="date" operator="greaterThan" allowBlank="0" showErrorMessage="1" errorTitle="PI有效期必填" error="请填写有效PI有效期" sqref="J4"><x:formula1>1</x:formula1></x:dataValidation><x:dataValidation type="decimal" operator="greaterThan" allowBlank="1" showErrorMessage="1" errorTitle="人民币单价" error="请输入大于0且最多两位小数的人民币单价" sqref="I19:I68"><x:formula1>0</x:formula1></x:dataValidation><x:dataValidation type="whole" operator="greaterThan" allowBlank="1" showErrorMessage="1" errorTitle="产品数量" error="请输入大于0的整数数量" sqref="K19:K68"><x:formula1>0</x:formula1></x:dataValidation><x:dataValidation type="textLength" operator="greaterThan" allowBlank="0" showErrorMessage="1" errorTitle="收货人必填" error="请填写收货人姓名和电话" sqref="D15"><x:formula1>0</x:formula1></x:dataValidation><x:dataValidation type="textLength" operator="greaterThan" allowBlank="0" showErrorMessage="1" errorTitle="客户地址必填" error="请填写客户收货地址" sqref="G14"><x:formula1>0</x:formula1></x:dataValidation></x:dataValidations>`;
worksheetXml = worksheetXml.replace(/<x:dataValidations[\s\S]*?<\/x:dataValidations>/, "");
worksheetXml = worksheetXml.replace("</x:worksheet>", `${validations}</x:worksheet>`);
// Match the exported PI's dual-currency detail columns (CNY + selected payment currency).
replaceCell("I18", 't="inlineStr"', `<x:is><x:r><x:rPr><x:rFont val="Arial"/><x:b/><x:color rgb="FF17243A"/><x:sz val="10"/></x:rPr><x:t>Unit Price (CNY) </x:t></x:r><x:r><x:rPr><x:rFont val="Arial"/><x:b/><x:color rgb="FFC62828"/><x:sz val="10"/></x:rPr><x:t>*</x:t></x:r></x:is>`, "I18");
replaceCell("J18", 't="str"', '<x:f>IF(J6="","Unit Price (外币)","Unit Price ("&amp;J6&amp;")")</x:f><x:v>Unit Price (外币)</x:v>', "I18");
replaceCell("K18", 't="inlineStr"', `<x:is><x:r><x:rPr><x:rFont val="Arial"/><x:b/><x:color rgb="FF17243A"/><x:sz val="10"/></x:rPr><x:t>Quantity </x:t></x:r><x:r><x:rPr><x:rFont val="Arial"/><x:b/><x:color rgb="FFC62828"/><x:sz val="10"/></x:rPr><x:t>*</x:t></x:r></x:is>`, "J18");
replaceCell("L18", 't="inlineStr"', '<x:is><x:t>Amount (CNY)</x:t></x:is>', "K18");
replaceCell("M18", 't="str"', '<x:f>IF(J6="","Amount (外币)","Amount ("&amp;J6&amp;")")</x:f><x:v>Amount (外币)</x:v>', "K18");
for (let row = 19; row <= 68; row += 1) {
  replaceCell(`J${row}`, 't="n"', `<x:f>IF(OR(I${row}="",$J$7=""),"",ROUND(I${row}/$J$7,2))</x:f><x:v></x:v>`, "I19");
  replaceCell(`K${row}`, 't="n"', '<x:v></x:v>', "J19");
  replaceCell(`L${row}`, 't="n"', `<x:f>IF(OR(I${row}="",K${row}=""),"",ROUND(I${row}*K${row},2))</x:f><x:v></x:v>`, "K19");
  replaceCell(`M${row}`, 't="n"', `<x:f>IF(OR(J${row}="",K${row}=""),"",ROUND(J${row}*K${row},2))</x:f><x:v></x:v>`, "K19");
}
const note = "红色 * 为必填；订单编号需与已有订单保持唯一。产品明细与正式PI列项一致，金额按单价×数量计算；费用可选，按所选币种填写并由汇率换算。导入后仍需核对客户、成本、汇率和收款账户，确认前不会生成备货单。";
replaceCell("A74", 't="inlineStr"', `<x:is><x:t>${note}</x:t></x:is>`);

// Expand the export-style amount summary without changing the product table layout.
moveCell("G71", "G75");
moveCell("K71", "K75");
replaceCell("G71", 't="inlineStr"', '<x:is><x:t>UNPAID BALANCE:</x:t></x:is>', "G70");
replaceCell("K71", 't="n"', '<x:v></x:v>', "K70");
replaceCell("K69", 't="n"', '<x:f>SUM(K19:K68)</x:f><x:v>0</x:v>', "J69");
for (const [row, label] of [[72, "OTHER CHARGES:"], [73, "DISCOUNT:"], [74, "PAYPAL FEE (5%):"]]) {
  replaceCell(`G${row}`, 't="inlineStr"', `<x:is><x:t>${label}</x:t></x:is>`, "G70");
  replaceCell(`K${row}`, 't="n"', '<x:v></x:v>', "K70");
}
replaceCell("G75", 't="inlineStr"', '<x:is><x:t>TOTAL AMOUNT:</x:t></x:is>', "G71");
replaceCell("K75", 't="n"', '<x:v></x:v>', "K71");
replaceCell("L69", 't="n"', '<x:f>SUM(L19:L68)</x:f><x:v>0</x:v>', "K69");
replaceCell("M69", 't="n"', '<x:f>SUM(M19:M68)</x:f><x:v>0</x:v>', "K69");
for (let row = 70; row <= 75; row += 1) {
  replaceCell(`L${row}`, 't="n"', row === 75 ? '<x:f>SUM(L69:L74)</x:f><x:v>0</x:v>' : `<x:f>IF(M${row}="","",ROUND(M${row}*$J$7,2))</x:f><x:v></x:v>`, "K70");
  replaceCell(`M${row}`, 't="n"', row === 74
    ? '<x:f>IF($J$8="PayPal",ROUND((M69+M70+M71+M72+M73)*5%,2),0)</x:f><x:v>0</x:v>'
    : row === 75 ? '<x:f>SUM(M69:M74)</x:f><x:v>0</x:v>' : '<x:v></x:v>', "K70");
}
replaceCell("J69", 't="n"', '<x:v></x:v>', "J70");
moveCell("J17", "K17");
for (const address of ["A72", "A73", "A74"]) removeCell(address);
replaceCell("A76", 't="inlineStr"', '<x:is><x:t>PAYMENT INFORMATION（填写与系统收款账户详情一致的完整信息；无法唯一匹配时导入后手动选择）</x:t></x:is>', "G70");
replaceCell("A77", 't="inlineStr"', '<x:is><x:t></x:t></x:is>', "K70");
replaceCell("A78", 't="inlineStr"', `<x:is><x:t>${note}</x:t></x:is>`);
worksheetXml = worksheetXml
  .replace('ref="A72:K72"', 'ref="A76:K76"')
  .replace('ref="A73:K73"', 'ref="A77:K77"')
  .replace('ref="A74:K74"', 'ref="A78:K78"')
  .replace(/ref="A76:K76"/g, 'ref="A76:M76"')
  .replace(/ref="A77:K77"/g, 'ref="A77:M77"')
  .replace(/ref="A78:K78"/g, 'ref="A78:M78"')
  .replace(/<x:mergeCell ref="A12:K12"\/>/, '<x:mergeCell ref="A12:M12"/>')
  .replace(/<x:dimension ref="[^"]+"\/>/, '<x:dimension ref="A1:M78"/>');
for (let row = 69; row <= 75; row += 1) {
  worksheetXml = worksheetXml.replace(`ref="G${row}:I${row}"`, `ref="G${row}:J${row}"`);
  if (!worksheetXml.includes(`ref="G${row}:J${row}"`)) worksheetXml = worksheetXml.replace("</x:mergeCells>", `<x:mergeCell ref="G${row}:J${row}"/></x:mergeCells>`);
}
worksheetXml = worksheetXml.replace('<x:row r="77" ht="22" customHeight="1">', '<x:row r="77" ht="42" customHeight="1">').replace('<x:row r="78" ht="22" customHeight="1">', '<x:row r="78" ht="42" customHeight="1">');
const mergeBlock = worksheetXml.match(/<x:mergeCells[^>]*>[\s\S]*?<\/x:mergeCells>/)?.[0];
if (mergeBlock) worksheetXml = worksheetXml.replace(mergeBlock, mergeBlock.replace(/count="\d+"/, `count="${(mergeBlock.match(/<x:mergeCell\b/g) || []).length}"`));
worksheetPart.content = Buffer.from(worksheetXml, "utf8");

const workbookPart = XLSX.CFB.find(workbook, "/xl/workbook.xml");
if (!workbookPart?.content) throw new Error("PI导入模板缺少工作簿元数据");
let workbookXml = Buffer.from(workbookPart.content).toString("utf8");
if (!/<x:calcPr\b/.test(workbookXml)) workbookXml = workbookXml.replace("</x:workbook>", '<x:calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></x:workbook>');
workbookPart.content = Buffer.from(workbookXml, "utf8");

writeFileSync(file, XLSX.CFB.write(workbook, { fileType: "zip", type: "buffer" }));
