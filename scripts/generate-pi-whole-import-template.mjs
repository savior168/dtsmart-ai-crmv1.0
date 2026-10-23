import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { QUOTE_CURRENCIES } from "../lib/currencies.ts";

const workbook = Workbook.create();
const basic = workbook.worksheets.add("PI基本信息");
const lines = workbook.worksheets.add("PI产品明细");
const example = workbook.worksheets.add("填写示例");
basic.showGridLines = false;
lines.showGridLines = false;
basic.getRange("A1:C1").values = [["PI整单导入模板", "填写蓝色单元格；红色 * 为必填", "导入后先核对并补全，不会自动提交备货单"]];
basic.getRange("A3:C25").values = [
  ["客户名称 *", "", "公司中的具体对接人；需与我的客户资料一致"],
  ["公司名称（选填）", "", "可留空；导入后手动选择客户，不自动创建客户"],
  ["PI订单编号 *", "", "不得与已有 PI 重复"],
  ["客户付款币种 *", "USD", "填写 USD、EUR 等系统支持的币种代码"],
  ["汇率：1外币=多少人民币", "", "可留空，导入核对页使用当前业务汇率；须复核"],
  ["PI有效期", "", "YYYY-MM-DD；留空时由系统默认值预填并复核"],
  ["预计交付日期", "", "YYYY-MM-DD；选填"],
  ["付款渠道", "", "选填；导入核对页需选收款账户"],
  ["收货人（选填）", "", "启用客户收货信息时必填；最长 200 字"],
  ["电话（选填）", "", "启用客户收货信息时必填；最长 100 字，保留国际区号"],
  ["邮箱（选填）", "", "填写时必须是有效邮箱"],
  ["收货地址（选填）", "", "启用客户收货信息时必填；最长 1000 字"],
  ["运费（CNY）", 0, "非负，最多两位小数"],
  ["未付尾款（CNY）", 0, "选填；正数加到 PI 总额"],
  ["折扣（CNY）", 0, "选填；正数从 PI 总额扣减"],
  ["其他费用（CNY）", 0, "选填；正数加到 PI 总额"],
  ["PayPal 手续费率（%）", 0, "仅付款渠道为 PayPal 时适用；如 4.4 表示 4.4%"],
  ["单据价格显示人民币和付款币种", "否", "填写 是 或 否；仅影响预览、打印和导出展示"],
  ["理货要求", "", "选填；无要求时系统按常规理货"],
  ["所属销售员登录邮箱（选填）", "", "填写时须与当前登录账号完全一致；空白时单据归属当前导入者，不可凭模板转给他人"],
  ["收款账户信息（选填）", "", "按系统收款账户详情原文填写；仅在同币种启用账户中唯一精确匹配时自动关联，否则导入后手动选择"],
  ["说明", "", "产品明细填在第二张工作表；每张 PI 1 至 500 行"],
  ["说明", "", "成本及售价用 CNY；外币售价和金额由系统按汇率换算"],
];
basic.getRange("A1:C25").format.font = { name: "Arial", size: 10, color: "#172554" };
basic.getRange("A1:C1").format = { fill: "#DBEAFE", font: { name: "Arial", size: 12, bold: true, color: "#1E40AF" } };
basic.getRange("A3:A23").format.columnWidth = 34;
basic.getRange("B3:B23").format.columnWidth = 30;
basic.getRange("C3:C25").format.columnWidth = 72;
basic.getRange("B3:B23").format.fill = "#EFF6FF";
for (const row of [3, 5, 6]) basic.getRange(`A${row}`).format.font = { name: "Arial", size: 10, bold: true, color: "#B91C1C" };
basic.getRange("B15:B19").setNumberFormat("0.00");
basic.getRange("B6").dataValidation = { rule: { type: "list", values: QUOTE_CURRENCIES.map(([code]) => code) } };
basic.getRange("B20").dataValidation = { rule: { type: "list", values: ["是", "否"] } };
lines.getRange("A1:N1").values = [["产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "产品质量/描述中文（展示给后端）", "成本单价（CNY） *", "销售单价（CNY） *", "数量 *", "销售金额（CNY）", "总利润（CNY）", "利润率", "理货要求", "销售备注"]];
lines.getRange("A1:N1").format = { fill: "#DBEAFE", font: { name: "Arial", size: 10, bold: true, color: "#B91C1C" }, wrapText: true, rowHeight: 40 };
for (const column of ["E", "F", "J", "K", "L", "M", "N"]) lines.getRange(`${column}1`).format.font = { name: "Arial", size: 10, bold: true, color: "#1E40AF" };
lines.getRange("A2:N51").format.font = { name: "Arial", size: 10, color: "#172554" };
lines.getRange("A2:H51").format.fill = "#EFF6FF";
lines.getRange("I2:I51").format.fill = "#EFF6FF";
lines.getRange("A:N").format.columnWidth = 19;
lines.getRange("F:F").format.columnWidth = 34;
lines.getRange("M:N").format.columnWidth = 26;
lines.getRange("G2:K501").setNumberFormat("0.00");
lines.getRange("L2:L501").setNumberFormat("0.00%");
lines.getRange("J2").formulas = [["=IF(OR(H2=\"\",I2=\"\"),\"\",ROUND(H2*I2,2))"]];
lines.getRange("K2").formulas = [["=IF(OR(G2=\"\",H2=\"\",I2=\"\"),\"\",ROUND((H2-G2)*I2,2))"]];
lines.getRange("L2").formulas = [["=IF(OR(J2=\"\",J2=0,K2=\"\"),\"\",K2/J2)"]];
for (const column of ["J", "K", "L"]) lines.getRange(`${column}2:${column}501`).fillDown();
lines.freezePanes.freezeRows(1);
example.getRange("A1:C1").values = [["填写示例（不会导入）", "请在前两张工作表填写", "示例数据仅供参考"]];
example.getRange("A1:C1").format = { fill: "#DBEAFE", font: { name: "Arial", size: 11, bold: true, color: "#1E40AF" } };
example.getRange("A3:B6").values = [["客户名称", "示例客户"], ["所属销售员登录邮箱", "seller@example.com"], ["付款渠道", "T/T Bank Transfer"], ["PI订单编号", "PI-EXAMPLE-001"]];
example.getRange("A30:H30").values = [["手机屏幕", "IPH", "IP17", "OLED", "", "", 80, 120]];
workbook.recalculate();
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save("assets/templates/PI_Whole_Order_Import_Template.xlsx");
