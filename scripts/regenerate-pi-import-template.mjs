import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

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

// Keep the PI export's product labels while making the displayed currency follow J6.
replaceCell("I18", 't="str"', '<x:f>"Unit Price ("&amp;J6&amp;")"</x:f><x:v>Unit Price (USD)</x:v>');
replaceCell("K18", 't="str"', '<x:f>"Amount ("&amp;J6&amp;")"</x:f><x:v>Amount (USD)</x:v>');
const note = "红色 * 为必填；产品明细列名和顺序与正式PI一致。币种请在上方选择，单价及金额填写客户外币；人民币售价、成本、汇率及收款账户由系统核对时补全，未补全不会生成备货单。";
replaceCell("A73", 't="inlineStr"', `<x:is><x:t>${note}</x:t></x:is>`);
worksheetPart.content = Buffer.from(worksheetXml, "utf8");

const workbookPart = XLSX.CFB.find(workbook, "/xl/workbook.xml");
if (!workbookPart?.content) throw new Error("PI导入模板缺少工作簿元数据");
let workbookXml = Buffer.from(workbookPart.content).toString("utf8");
if (!/<x:calcPr\b/.test(workbookXml)) workbookXml = workbookXml.replace("</x:workbook>", '<x:calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></x:workbook>');
workbookPart.content = Buffer.from(workbookXml, "utf8");

writeFileSync(file, XLSX.CFB.write(workbook, { fileType: "zip", type: "buffer" }));
