import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const customer = await SpreadsheetFile.importXlsx(await FileBlob.load("assets/templates/Customer_Import_Template.xlsx"));
const customerData = customer.worksheets.getItem("客户导入模板");
const customerHelp = customer.worksheets.add("填写说明");
customerHelp.showGridLines = false;
customerHelp.getRange("A1:B1").values = [["客户批量导入填写说明", "客户公海与我的客户共用此模板"]];
customerHelp.getRange("A3:B11").values = [
  ["数据页", "只在“客户导入模板”页填写客户；本说明页不会作为客户记录导入。每行一个客户，勿改动首行列名。"],
  ["必填项", "客户名称、公司名称、国家/地区为每行必填。还须在电话号码、邮箱、客户官网、谷歌商家链接四项中至少填写一项可核实联系方式。"],
  ["我的客户", "导入后归属当前账号；意向客户和已成交客户必须同时填写电话和邮箱。客户阶段可填潜在客户、意向客户、已成交客户。"],
  ["客户公海", "仅系统管理员可导入；不能预设客户阶段或客户等级。导入后进入 AI 分析/评分流程，未达到 60 分不进入待认领。"],
  ["客户等级", "我的客户可填 S、A、B、C、D；留空表示未标记。客户公海须留空。"],
  ["地址", "客户收货地址和货代地址可分别填写；后续在客户编辑页可按需维护多条地址。"],
  ["重复和归属", "系统会核对全库同一客户；重复、已有他人归属或公海客户不会被静默复制或覆盖，须按页面提示处理。"],
  ["AI 数据", "不要在表内手填 AI 分数、等级或分析结论；系统按实际分析流程生成，导入不会绕过审核。"],
  ["提交前", "先使用预览检查字段映射、错误行和重复行，再确认导入目标；请不要导入真实敏感资料作测试。"],
];
customerHelp.getRange("A1:B1").format = { fill: "#DBEAFE", font: { name: "Arial", size: 12, bold: true, color: "#1E40AF" } };
customerHelp.getRange("A3:A11").format = { font: { name: "Arial", size: 10, bold: true, color: "#1E40AF" } };
customerHelp.getRange("B3:B11").format = { font: { name: "Arial", size: 10, color: "#334155" }, wrapText: true };
customerHelp.getRange("A:A").format.columnWidth = 20;
customerHelp.getRange("B:B").format.columnWidth = 110;
customerHelp.getRange("A3:B11").format.rowHeight = 35;
customerData.getRange("A1:C1").format.font = { name: "Arial", size: 10, bold: true, color: "#B91C1C" };
customer.recalculate();
await (await SpreadsheetFile.exportXlsx(customer)).save("assets/templates/Customer_Import_Template.xlsx");

const line = await SpreadsheetFile.importXlsx(await FileBlob.load("public/templates/pi-line-import-template.xlsx"));
const lineHelp = line.worksheets.add("填写说明");
lineHelp.showGridLines = false;
lineHelp.getRange("A1:B1").values = [["PI产品明细导入说明", "只填写第一张“产品明细”表；本页不导入"]];
lineHelp.getRange("A3:B8").values = [
  ["必填", "产品类型、品牌、型号、质量、成本单价（CNY）、销售单价（CNY）及正整数数量。红色 * 已在数据页标记。"],
  ["选填", "产品描述、产品质量/描述中文、理货要求和销售备注；留空不自动拼接其他字段。"],
  ["自动计算", "销售金额＝人民币销售单价×数量；总利润＝（人民币销售单价－成本单价）×数量；利润率＝总利润÷销售金额。无需手填公式列。"],
  ["币种", "导入及粘贴只需录入 CNY 成本与售价；先在 PI 页面设置付款币种及汇率，系统自动换算另一币种。"],
  ["校验", "销售单价必须高于成本；金额最多两位小数；每张 PI 最多 500 条明细。"],
  ["导入方式", "下载模板、填写后在 PI 创建页点“导入Excel”；粘贴表格须与模板列顺序一致。导入后仍需核对再保存。"],
];
lineHelp.getRange("A1:B1").format = { fill: "#DBEAFE", font: { name: "Arial", size: 12, bold: true, color: "#1E40AF" } };
lineHelp.getRange("A3:A8").format.font = { name: "Arial", size: 10, bold: true, color: "#1E40AF" };
lineHelp.getRange("B3:B8").format = { font: { name: "Arial", size: 10, color: "#334155" }, wrapText: true };
lineHelp.getRange("A:A").format.columnWidth = 20;
lineHelp.getRange("B:B").format.columnWidth = 110;
lineHelp.getRange("A3:B8").format.rowHeight = 35;
line.recalculate();
await (await SpreadsheetFile.exportXlsx(line)).save("public/templates/pi-line-import-template.xlsx");
