import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { QUOTE_CURRENCIES } from "../lib/currencies.ts";

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

function replaceCell(address, attributes, body) {
  const marker = `r="${address}"`;
  const markerIndex = worksheetXml.indexOf(marker);
  if (markerIndex < 0) throw new Error(`PI导入模板缺少单元格 ${address}`);
  const start = worksheetXml.lastIndexOf("<x:c", markerIndex);
  const openEnd = worksheetXml.indexOf(">", markerIndex);
  const closeEnd = worksheetXml.indexOf("</x:c>", openEnd);
  if (start < 0 || openEnd < 0 || closeEnd < 0) throw new Error(`PI导入模板单元格 ${address} 格式异常`);
  const originalOpen = worksheetXml.slice(start, openEnd + 1);
  const originalStyle = originalOpen.match(/\bs="(\d+)"/)?.[1] || "0";
  const replacement = `<x:c r="${address}" s="${originalStyle}" ${attributes}>${body}</x:c>`;
  worksheetXml = worksheetXml.slice(0, start) + replacement + worksheetXml.slice(closeEnd + 6);
}

// The selected payment currency is required; never ship a preselected USD value.
replaceCell("J6", 't="inlineStr"', '<x:is><x:t></x:t></x:is>');
const currencyList = QUOTE_CURRENCIES.map(([code]) => code).join(",");
const validation = `<x:dataValidations count="1"><x:dataValidation type="list" allowBlank="0" showErrorMessage="1" errorTitle="请选择币种" error="请从下拉列表选择系统支持的付款币种" sqref="J6"><x:formula1>"${currencyList}"</x:formula1></x:dataValidation></x:dataValidations>`;
if (!worksheetXml.includes('<x:dataValidations')) worksheetXml = worksheetXml.replace('</x:worksheet>', `${validation}</x:worksheet>`);
// Keep the PI export's product labels while making the displayed currency follow J6.
replaceCell("I18", 't="str"', '<x:f>"Unit Price ("&amp;J6&amp;")"</x:f><x:v>Unit Price (USD)</x:v>');
replaceCell("K18", 't="str"', '<x:f>"Amount ("&amp;J6&amp;")"</x:f><x:v>Amount (USD)</x:v>');
const note = "红色 * 为必填；产品明细列名和顺序与正式PI一致。币种请在上方选择，单价及金额填写客户外币；人民币售价、成本、汇率及收款账户由系统核对时补全，未补全不会生成备货单。";
replaceCell("A73", 't="inlineStr"', `<x:is><x:t>${note}</x:t></x:is>`);
// Keep the customer-facing layout round-trippable: imported payment instructions
// may be matched only to a unique active account of the selected currency/channel.
if (!worksheetXml.includes("PAYMENT INFORMATION")) {
  const originalNoteRow = worksheetXml.match(/<x:row r="73"[^>]*>[\s\S]*?<\/x:row>/)?.[0];
  if (!originalNoteRow || !worksheetXml.includes('<x:c r="A72" s="1" />')) throw new Error("PI客户版式模板付款信息行结构异常");
  worksheetXml = worksheetXml.replace('<x:c r="A72" s="1" />', '<x:c r="A72" s="1" t="inlineStr"><x:is><x:t>PAYMENT INFORMATION（填写与系统收款账户详情一致的完整信息；无法唯一匹配时导入后手动选择）</x:t></x:is></x:c>');
  worksheetXml = worksheetXml.replace(originalNoteRow, '<x:row r="73" ht="65" customHeight="1"><x:c r="A73" s="1" t="inlineStr"><x:is><x:t></x:t></x:is></x:c></x:row>' + originalNoteRow.replace(/73/g, "74"));
  worksheetXml = worksheetXml.replace('ref="A1:K73"', 'ref="A1:K74"');
  worksheetXml = worksheetXml.replace('</x:mergeCells>', '<x:mergeCell ref="A72:K72"/><x:mergeCell ref="A74:K74"/></x:mergeCells>');
}
worksheetPart.content = Buffer.from(worksheetXml, "utf8");

const workbookPart = XLSX.CFB.find(workbook, "/xl/workbook.xml");
if (!workbookPart?.content) throw new Error("PI导入模板缺少工作簿元数据");
let workbookXml = Buffer.from(workbookPart.content).toString("utf8");
if (!/<x:calcPr\b/.test(workbookXml)) workbookXml = workbookXml.replace("</x:workbook>", '<x:calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></x:workbook>');
workbookPart.content = Buffer.from(workbookXml, "utf8");

writeFileSync(file, XLSX.CFB.write(workbook, { fileType: "zip", type: "buffer" }));
