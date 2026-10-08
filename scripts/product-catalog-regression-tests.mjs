import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseProductWorkbook, validateNormalizedProduct } from "../lib/product-import.ts";
import { activeTier, completeCostCny, initialQuoteUnitPrice, suggestedUsdPrice } from "../lib/product-pricing.ts";
import { isProductFieldApplicable, normalizeProductSpecifications, validateProductFamilyFields } from "../lib/product-specifications.ts";
import { parseProductPriceImport, PRICE_IMPORT_HEADERS } from "../lib/product-price-import.ts";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ["供应商单品货号", "商品名称", "品牌", "型号", "品质", "成本单价", "美元售价"],
  ["LCD-IP15-OLED", "iPhone 15 OLED屏幕", "Apple", "iPhone 15", "OLED", 320, 58.5],
]), "标准明细");
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ["商品名称", "采购价", "起订量", "包装费"],
  ["错误起订量商品", 100, 0, 2],
  ["错误价格商品", 100, 1, -3],
]), "错误数据");
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ["官方屏幕价格"],
  ["型号", "原装", "拆机"],
  ["iPhone 14", 420, 380],
]), "通用屏幕矩阵");
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ["更新时间", "9月21日", "RJ 价格"],
  ["代码", 1191, "供应商报价"],
  ["iPhone 15", 320, 340],
]), "供应商矩阵");
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ["注意核对颜色与装配范围"],
]), "注意事项");
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ["填写说明"], ["1", "系统SKU由数据库自动生成，无需填写"],
]), "填写说明");
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ["商品名称", "采购价", "品牌"],
  ["后盖样品", 100, "Apple"],
]), "说明");
const officialSheet = XLSX.utils.aoa_to_sheet([
  ["更新时间", 46253],
  ["代码", 1006, "", "", "官方屏幕单价", "官方电池单价"],
  ["", "", "", "", "17pm 官方屏    1980元", "17pm电池       575元"],
]);
XLSX.utils.sheet_add_aoa(officialSheet, [["产品价格含包装，官方原白盒包装"]], { origin: "E1" });
XLSX.utils.sheet_add_aoa(officialSheet, [["17pm 官方屏    1980元", "17pm电池       575元"]], { origin: "F3" });
XLSX.utils.book_append_sheet(workbook, officialSheet, "官方屏幕-电池");
const samsungSheet = XLSX.utils.aoa_to_sheet([
  ["", "", "", "三星拆机屏幕 包装+1.5"],
  ["", "", "", "价格(含打磨费）", "型号"],
  ["", "", "", 330, "S8", "", "代码", 4908],
]);
XLSX.utils.sheet_add_aoa(samsungSheet, [[330, "S8"]], { origin: "G5" });
XLSX.utils.sheet_add_aoa(samsungSheet, [["三星拆机屏幕 包装+1.5"]], { origin: "G3" });
XLSX.utils.sheet_add_aoa(samsungSheet, [["代码", 4908]], { origin: "B2" });
XLSX.utils.book_append_sheet(workbook, samsungSheet, "LCD-SM S系列拆机");
const offsetSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(offsetSheet, [["商品名称", "采购价", "品牌"], ["移位商品", 99, "Apple"]], { origin: "D3" });
XLSX.utils.book_append_sheet(workbook, offsetSheet, "非A1起始明细");
const batterySheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(batterySheet, [["更新日期", "工厂电池不能散拿货，每个型号50个起订"]], { origin: "A1" });
XLSX.utils.sheet_add_aoa(batterySheet, [["普通电池包装盒+1.5"]], { origin: "R1" });
XLSX.utils.sheet_add_aoa(batterySheet, [["诊断电池包装盒+2.5"]], { origin: "W1" });
XLSX.utils.sheet_add_aoa(batterySheet, [["纯钴标容电池", "", "纯钴标容电芯"]], { origin: "A4" });
XLSX.utils.sheet_add_aoa(batterySheet, [["型号", "单价", "型号", "单价"], ["6G", 13, "X", 16]], { origin: "A5" });
XLSX.utils.sheet_add_aoa(batterySheet, [["工厂单价，每个型号50个起订"]], { origin: "P46" });
XLSX.utils.sheet_add_aoa(batterySheet, [["Model", "Warranty", "ORIGINAL Capacity", "DEFECTIVE RATE", "RMB PRICE", "HIGHER CAPACITY", "DEFECTIVE RATE", "RMB PRICE", null, "Model", "Warranty", "ORIGINAL Capacity", "DEFECTIVE RATE", "RMB PRICE"], ["12/12 Pro", "12 Months", "2815mAh", "<1%", 47, "3350mAh", "<1%", 49.3, null, "12/12 Pro", "12 Months", "2815mAh", "<1%", null]], { origin: "A47" });
XLSX.utils.sheet_add_aoa(batterySheet, [["市场单价，每个型号10个起订"]], { origin: "P75" });
XLSX.utils.sheet_add_aoa(batterySheet, [["型号 model", "成品容量 Battery capacity", "价格 price", "型号 model", "成品容量 Battery capacity", "价格 price"], ["12/12PRO", "2815MAH", 24.5, "12/12PRO", "3300MAH", 27]], { origin: "E76" });
XLSX.utils.book_append_sheet(workbook, batterySheet, "iPhone电池单价");
const macbookBatterySheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(macbookBatterySheet, [["代码", "1012"]], { origin: "E2" });
XLSX.utils.sheet_add_aoa(macbookBatterySheet, [["产品带包装"]], { origin: "G1" });
XLSX.utils.sheet_add_aoa(macbookBatterySheet, [["电池型号", "全新批发价【国产三元材质】", "适用电脑型号", "原装拆机 90%以上容量", "原装拆机 95%以上容量"], ["A1321", 107, "A1286", 82, 92], ["A1437", "原装162", "A1425", 162, 172]], { origin: "G3" });
XLSX.utils.book_append_sheet(workbook, macbookBatterySheet, "Battery-Macbook");
const macbookScreenSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(macbookScreenSheet, [["Macbook LCD 带单个包装，或者飞机盒包装（包装免费）"]], { origin: "F1" });
XLSX.utils.sheet_add_aoa(macbookScreenSheet, [["代码", 1011, null, "产品型号", "产品质量", "产品描述", "颜色", "最新单价", "京东方液晶（发货快）"], [null, null, "Mac Pro", "A1706/A1708", "OEM", '13"', "银色、深空灰", 760, 810], [null, null, "Mac Air", "A3240", "FOG", '13"', "银色、天蓝色", 1320, "原液晶全新组 1410"]], { origin: "C2" });
XLSX.utils.sheet_add_aoa(macbookScreenSheet, [["液晶", "原装", "压排"], ["1706/1708", null, 490]], { origin: "F34" });
XLSX.utils.book_append_sheet(workbook, macbookScreenSheet, "LCD-Macbook");
const backlitSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(backlitSheet, [["包装费：统一蓝色彩盒包装+1 | 客户提供盒子+0.1rmb耗材费"]], { origin: "F1" });
XLSX.utils.sheet_add_aoa(backlitSheet, [["代码", 1071]], { origin: "M1" });
XLSX.utils.sheet_add_aoa(backlitSheet, [["产品类型", "产品品牌", "产品系列", "型号", "产品质量", "产品描述（通用型号）", "成本单价"], ["LCD", "For SM", "For A Series", "A12", "ORG", "A12/A125", 29.5]], { origin: "F3" });
XLSX.utils.book_append_sheet(workbook, backlitSheet, "LCD-SM A系列背光屏");
const smallPartsSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(smallPartsSheet, [["型号", "尾插", "小像头 （原）", "听筒排线（原）", "开机排（原）", "音量排（原）", "无线充（原）", "闪光灯（原）", "马达（原）", "Wi-Fi线（原）", "蓝牙（原）", "喇叭（原）", "单听筒（原）", "雷达（原）", "感应排", "大像头"], ["6G", "原6.5仿5", 5]], { origin: "A3" });
XLSX.utils.book_append_sheet(workbook, smallPartsSheet, "Spare parts-iphone ");
const oledSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(oledSheet, [["产品报价不含包装费，统一service pack包装+1rmb"]], { origin: "E1" });
XLSX.utils.sheet_add_aoa(oledSheet, [["代码", 1378]], { origin: "C2" });
XLSX.utils.sheet_add_aoa(oledSheet, [["尺寸", "型号/MOLED", "品质", "报价", "备注", null, "尺寸", "柔性MOLED/型号", "品质", "报价", "备注"], [6.35, "A30/A50", "原尺寸", "单片106", "带框110", null, 6.6, "A36/A366", "全新", "单片152", "换面122"]], { origin: "E4" });
XLSX.utils.book_append_sheet(workbook, oledSheet, "LCD-SM A系列OLED");
const refurbishedSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(refurbishedSheet, [["三星A系列换面屏幕 包装+1.5"]], { origin: "E3" });
XLSX.utils.sheet_add_aoa(refurbishedSheet, [["型号", "单片单价", "中框单价", "备注", "更新时间", 46225], ["A15", 172, 15, null, "代码", 1049]], { origin: "E4" });
XLSX.utils.sheet_add_aoa(refurbishedSheet, [["三星A系列换面屏幕 包装+1.5（背光屏）"], ["型号", "单价", null, "备注", "更新时间", 46225], ["A10", 51, null, null, "代码", 4338]], { origin: "E56" });
XLSX.utils.book_append_sheet(workbook, refurbishedSheet, "LCD-SM A系列换面");
const ipadSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(ipadSheet, [["产品价格不含包装，统一白盒包装+5rmb (泡棉包装)"]], { origin: "B2" });
XLSX.utils.sheet_add_aoa(ipadSheet, [["全新", "拆机", "换盖板", "换背光", "原FOG", "OLED", "仿", "后压"]], { origin: "D3" });
XLSX.utils.sheet_add_aoa(ipadSheet, [["ipad 2", "LCD", null, 91]], { origin: "B4" });
XLSX.utils.sheet_add_aoa(ipadSheet, [["10.5", "LCD", null, "黑：665"]], { origin: "B18" });
XLSX.utils.sheet_add_aoa(ipadSheet, [["产品价格不含包装，统一黄色气泡袋+1rmb"]], { origin: "B29" });
XLSX.utils.sheet_add_aoa(ipadSheet, [["压金边", null, null, "铜膜", "+按键", "+OCA"], [16, null, null, 34, 3]], { origin: "D30" });
XLSX.utils.sheet_add_aoa(ipadSheet, [["ipad 5", "触摸"]], { origin: "B31" });
XLSX.utils.book_append_sheet(workbook, ipadSheet, "iPad触摸总成+液晶总成");
const jcSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(jcSheet, [["JCID 跑诊断高容量电池 带JC盒子", null, null, null, "JCID 跑诊断屏幕 带JC盒子（OLED）"]], { origin: "F4" });
XLSX.utils.sheet_add_aoa(jcSheet, [["JCID 跑诊断屏幕 带JC盒子（OLED）"]], { origin: "J25" });
XLSX.utils.sheet_add_aoa(jcSheet, [["JCID 跑诊断屏幕 带JC盒子（INCELL）"]], { origin: "J49" });
XLSX.utils.sheet_add_aoa(jcSheet, [["型号", "高容量 价格", "标容量 价格", null, "型号", "价格(硬）"], ["12mini", 67, 65, null, "12MINI", 333]], { origin: "F7" });
XLSX.utils.sheet_add_aoa(jcSheet, [["型号", "价格(柔）"], ["12pm", 300]], { origin: "J28" });
XLSX.utils.sheet_add_aoa(jcSheet, [["型号", "价格"], ["13pro", 182]], { origin: "J52" });
XLSX.utils.book_append_sheet(workbook, jcSheet, "JC跑诊断产品");
const iphoneRearCoverSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(iphoneRearCoverSheet, [["后盖玻璃带NFC", null, "后盖壳/中框", null, null, "后盖单壳/中框不带配件", null, "统一静电袋+白盒单个包装，包装+1rmb"]], { origin: "I1" });
XLSX.utils.sheet_add_aoa(iphoneRearCoverSheet, [["欧版", "美版", null, "欧版/国行", "美版"]], { origin: "K2" });
XLSX.utils.sheet_add_aoa(iphoneRearCoverSheet, [["14 92", null, "11 182", "11p 252", null, "11 55", "11 55"], ["15 172，粉色122", null, "12 黑蓝303，彩色262", "12 162", null, "14 100+40", "14 70+40"]], { origin: "I3" });
XLSX.utils.book_append_sheet(workbook, iphoneRearCoverSheet, "iPhone拆机后盖");
const samsungRearCoverSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(samsungRearCoverSheet, [["三星后盖玻璃 -S系列", null, "三星后盖玻璃 -折叠系列"]], { origin: "J1" });
XLSX.utils.sheet_add_aoa(samsungRearCoverSheet, [["代码", "C678A"]], { origin: "H2" });
XLSX.utils.sheet_add_aoa(samsungRearCoverSheet, [["s8/s8+ 2", null, "fold2 金25 黑15"], ["s24FE 15", null, "f6 20"]], { origin: "J3" });
XLSX.utils.book_append_sheet(workbook, samsungRearCoverSheet, "三星拆机后盖");
const originalIPhoneSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(originalIPhoneSheet, [["产品价格不含包装，统一白盒包装+2rmb (泡棉包装)"]], { origin: "D1" });
XLSX.utils.sheet_add_aoa(originalIPhoneSheet, [["备注", "原FOG跑诊断价格", "1096"], ["12PM", 408], ["13MINI", 655, "缺货"]], { origin: "N2" });
XLSX.utils.sheet_add_aoa(originalIPhoneSheet, [["5S/5C/5SE 50"]], { origin: "E3" });
XLSX.utils.sheet_add_aoa(originalIPhoneSheet, [["Xr雾面 64 清面：84"]], { origin: "L6" });
XLSX.utils.book_append_sheet(workbook, originalIPhoneSheet, "LCD-原装iPhone");
const parsed = parseProductWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
const tabularWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(tabularWorkbook, XLSX.utils.aoa_to_sheet([
  ["商品名称", "型号", "人民币采购价"],
  ["测试屏幕单片", "TEST-1", 82],
]), "标准明细表");
const tabularParsed = parseProductWorkbook(XLSX.write(tabularWorkbook, { type: "buffer", bookType: "xlsx" }));
const masterWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(masterWorkbook, XLSX.utils.aoa_to_sheet([
  ["商品分类编码", "供应商编号", "供应商商品货号", "商品名称", "品牌", "型号", "最小起订量"],
  ["SCR", "1191", "RJ-15-01", "iPhone 15 OLED 屏幕", "RJ", "iPhone 15", 1],
]), "商品资料导入");
XLSX.utils.book_append_sheet(masterWorkbook, XLSX.utils.aoa_to_sheet([
  ["商品分类编码", "商品分类名称"], ["SCR", "屏幕"],
]), "分类编码参考");
const masterParsed = parseProductWorkbook(XLSX.write(masterWorkbook, { type: "buffer", bookType: "xlsx" }));
assert.equal(masterParsed.candidates.length, 1, "分类参考页不应变成待导入商品");
assert.equal(masterParsed.sheets[0].mode, "TABULAR", "商品资料模板应按结构化明细处理");
assert.equal(masterParsed.sheets[1].mode, "REFERENCE", "分类编码参考页不得阻挡发布");
assert.equal(masterParsed.candidates[0].normalized_data.import_mode, "PRODUCT_ONLY");
assert.equal(masterParsed.candidates[0].normalized_data.category_code, "SCR");
assert.equal(masterParsed.candidates[0].normalized_data.sku, "RJ-15-01", "供应商单品货号不得成为系统 SKU");
assert.ok(!masterParsed.candidates[0].issues.some((issue) => issue.includes("缺少可识别")), "仅商品资料导入无需填价格");
assert.equal(validateNormalizedProduct({ ...masterParsed.candidates[0].normalized_data, category_id: "00000000-0000-4000-8000-000000000001" }).issues.length, 0, "核准商品资料不需要价格");
assert.equal(tabularParsed.sheets[0].mode, "TABULAR", "标准明细表应识别为结构化来源");
assert.equal(tabularParsed.candidates[0].status, "REVIEW", "结构化来源也不能绕过人工核对直接发布");
assert.ok(tabularParsed.candidates[0].issues.some((issue) => issue.includes("逐行确认")), "须向采购说明核对责任");
const brandedWorkbook = XLSX.utils.book_new();
const brandedSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(brandedSheet, [["RJ 价格 (INCELL25/oled19) 价格不带RJ盒子，要盒子+1"]], { origin: "C1" });
XLSX.utils.sheet_add_aoa(brandedSheet, [["RJ (瑞桔)🍊14s搬ic 82"]], { origin: "C14" });
XLSX.utils.sheet_add_aoa(brandedSheet, [["16柔搬ic：220", null, "15 柔 搬：287（高刷）（1191）"]], { origin: "E14" });
XLSX.utils.book_append_sheet(brandedWorkbook, brandedSheet, "iPhone品牌屏幕");
const mixedSamsungSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(mixedSamsungSheet, [["WF 277", null, null, null, null, null, null, "423黑金紫"]], { origin: "H8" });
XLSX.utils.book_append_sheet(brandedWorkbook, mixedSamsungSheet, "LCD-SM  S系列+折叠系列");
const domesticCoverSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(domesticCoverSheet, [["14/14plus 11.5"]], { origin: "F4" });
XLSX.utils.book_append_sheet(brandedWorkbook, domesticCoverSheet, "国产后盖");
const branded = parseProductWorkbook(XLSX.write(brandedWorkbook, { type: "buffer", bookType: "xlsx" }));
const rj14s = branded.candidates.find((row) => row.source_sheet === "iPhone品牌屏幕" && row.source_cell === "C14");
assert.equal(rj14s?.status, "REVIEW", "瑞桔屏幕必须保留原文并待采购核对");
assert.equal(rj14s?.normalized_data.procurement_cny, 82, "单一明确采购价应保留为82元而非美元售价");
assert.equal(rj14s?.normalized_data.specifications.ic_transfer_support, "支持", "搬IC仅表示屏幕支持该操作");
assert.equal(rj14s?.normalized_data.model, "", "14s歧义不能擅自改成iPhone 14型号");
assert.equal(rj14s?.normalized_data.packaging_cny, null, "RJ盒子加价是可选项，不得自动加进采购成本");
assert.equal(normalizeProductSpecifications(rj14s.normalized_data.specifications, "SCREEN").error, "", "搬IC能力必须能在商品规格中保存");
for (const [sheet, address] of [["iPhone品牌屏幕", "E14"], ["iPhone品牌屏幕", "G14"], ["LCD-SM  S系列+折叠系列", "H8"], ["LCD-SM  S系列+折叠系列", "O8"], ["国产后盖", "F4"]]) {
  const clue = branded.candidates.find((row) => row.source_sheet === sheet && row.source_cell === address);
  assert.equal(clue?.status, "REVIEW", `${sheet}!${address} 混排报价须保留单元格原文供核对`);
  assert.equal(clue?.normalized_data.procurement_cny, null, `${sheet}!${address} 混排文本不能擅取首个数字定价`);
}
assert.equal(parsed.sheet_count, 22, "必须逐个工作表解析并对账");
assert.ok(parsed.source_row_count >= 5, "必须记录原始非空行数");
assert.equal(parsed.sheets.find((sheet) => sheet.name === "注意事项")?.mode, "REFERENCE", "源工作簿中的注意事项不能伪装成商品");
assert.equal(parsed.sheets.find((sheet) => sheet.name === "填写说明")?.mode, "REFERENCE", "系统下载模板中的填写说明页不能阻断价格导入");
assert.equal(parsed.sheets.find((sheet) => sheet.name === "说明")?.mode, "TABULAR", "不能仅凭通用工作表名跳过实际商品数据");
assert.equal(parsed.sheets.find((sheet) => sheet.name === "官方屏幕-电池")?.mode, "SOURCE_REVIEW", "官方屏幕与电池混排需要分别保留待核对候选");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPhone拆机后盖" && row.source_cell === "I3")?.normalized_data.procurement_cny, 92, "iPhone后盖仅提取整格单型号单价");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPhone拆机后盖" && row.source_cell === "I3")?.normalized_data.packaging_cny, 1, "iPhone后盖统一包装费应与采购价分列");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPhone拆机后盖" && row.source_cell === "K3")?.normalized_data.specifications.market_version, "欧版", "欧版报价不得与美版混同");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "iPhone拆机后盖")?.unparsed_addresses?.includes("I4"), "同格多颜色报价不能抽取第一个数字后丢掉其余价格");
for (const sheet of parsed.sheets) for (const address of sheet.unparsed_addresses || []) {
  const review = parsed.candidates.find((row) => row.source_sheet === sheet.name && row.source_cell === address);
  assert.equal(review?.status, "REVIEW", `${sheet.name}!${address} 未解析原文必须进入可逐条查看的核对列表`);
  assert.equal(review?.normalized_data.procurement_cny, null, `${sheet.name}!${address} 未解析原文不得自动变为采购价`);
}
assert.ok(parsed.sheets.find((sheet) => sheet.name === "iPhone拆机后盖")?.unparsed_addresses?.includes("N4"), "加法价不能被截成单一采购价");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "三星拆机后盖" && row.source_cell === "J4")?.normalized_data.procurement_cny, 15, "三星后盖单型号单价须保留来源价格");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "三星拆机后盖" && row.source_cell === "J4")?.normalized_data.packaging_cny, null, "三星后盖未标包装费不得猜为零");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "三星拆机后盖" && row.source_cell === "J4")?.normalized_data.supplier_identifier, "C678A", "后盖供应商编号不能当成单品SKU");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "三星拆机后盖")?.unparsed_addresses?.includes("J3"), "同格多个三星型号不能伪装成一个商品");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-原装iPhone" && row.source_cell === "O3")?.normalized_data.procurement_cny, 408, "型号价格分列的原FOG屏须绑定同一行");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-原装iPhone" && row.source_cell === "O3")?.normalized_data.packaging_cny, 2, "原FOG屏统一白盒包装费须另列");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-原装iPhone" && row.source_cell === "O4")?.status, "REVIEW", "明确缺货的原FOG屏只能作为未解析原文进入核对，不得直接可售");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-原装iPhone" && row.source_cell === "O4")?.normalized_data.procurement_cny, null, "缺货历史价不能直接成为可发布采购价");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "LCD-原装iPhone")?.unparsed_addresses?.includes("O4"), "缺货历史报价必须保留待处理地址");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "LCD-原装iPhone")?.unparsed_addresses?.includes("L6"), "单格不同表面品质报价不得截取其中一个单价");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "官方屏幕-电池" && row.source_cell === "F3")?.normalized_data.procurement_cny, 1980, "官方屏幕报价不得与同行电池价格混淆");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "官方屏幕-电池" && row.source_cell === "F3")?.normalized_data.packaging_cny, 0, "官方屏幕来源价已含包装，不能重复加费");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "官方屏幕-电池" && row.source_cell === "G3")?.normalized_data.procurement_cny, 575, "官方电池报价应单独保留");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-SM S系列拆机" && row.source_cell === "G5")?.normalized_data.procurement_cny, 330, "三星拆机屏幕的价格与型号分列时必须正确配对");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-SM S系列拆机" && row.source_cell === "G5")?.normalized_data.packaging_cny, 1.5, "三星拆机屏幕需按明确包装加价单列");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "非A1起始明细" && row.source_cell === "E4")?.normalized_data.procurement_cny, 99, "非A1起始的工作表必须保留真实单元格坐标");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPhone电池单价" && row.source_cell === "B6")?.normalized_data.minimum_order_quantity, 50, "工厂电池每型号50件起订必须保留");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPhone电池单价" && row.source_cell === "D6")?.normalized_data.part_type, "电芯", "电芯列不得被伪装成完整电池");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPhone电池单价" && row.source_cell === "B6")?.normalized_data.packaging_cny, null, "可选电池盒不得自动并入每笔电池采购成本");
assert.match(parsed.candidates.find((row) => row.source_sheet === "iPhone电池单价" && row.source_cell === "B6")?.normalized_data.packaging || "", /可选普通电池盒/, "普通电池可选盒价须提示核对");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPhone电池单价" && row.source_cell === "E48")?.normalized_data.procurement_cny, 47, "跑诊断标准容量报价必须按对应列取值");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPhone电池单价" && row.source_cell === "H48")?.normalized_data.specifications.capacity_mah, "3350", "跑诊断高容电池必须保留容量证据");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "iPhone电池单价")?.unparsed_addresses?.includes("J48"), "无价格的正品诊断电池应指向有值的型号来源格，不得造价或指向不存在的价格格");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPhone电池单价" && row.source_cell === "G77")?.normalized_data.minimum_order_quantity, 10, "市场标准容量报价必须保留对应起订量");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPhone电池单价" && row.source_cell === "J77")?.normalized_data.procurement_cny, 27, "市场高容价不得错用标准容量价");
assert.ok(!parsed.sheets.find((sheet) => sheet.name === "iPhone电池单价")?.unparsed_addresses?.includes("C77"), "分区表头不是缺失价格，不得误报异常");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "Battery-Macbook" && row.source_cell === "H4")?.normalized_data.supplier_identifier, "1012", "MacBook电池应保留来源供应商身份");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "Battery-Macbook" && row.source_cell === "H4")?.normalized_data.packaging_cny, 0, "MacBook电池来源注明带包装，不应再加一笔包装费");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "Battery-Macbook" && row.source_cell === "J4")?.normalized_data.specifications.health_grade, "90%以上", "拆机电池容量品质不得与全新品质混淆");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "Battery-Macbook" && row.source_cell === "H4")?.normalized_data.minimum_order_quantity, 0, "源表未给起订量时必须等待确认，不能猜为1件");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "Battery-Macbook")?.unparsed_addresses?.includes("H5"), "同列文字报价须标记待核对，不能误认成第三方全新价格");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-Macbook" && row.source_cell === "J3")?.normalized_data.procurement_cny, 760, "MacBook屏幕J列主报价须保留精确来源");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-Macbook" && row.source_cell === "J3")?.normalized_data.packaging_cny, 0, "MacBook屏幕来源标注免费包装，应记零额外包装费");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-Macbook" && row.source_cell === "J3")?.normalized_data.supplier_identifier, "1011", "MacBook屏幕应保留供应商身份");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-Macbook" && row.source_cell === "K3")?.status, "REVIEW", "京东方替代报价只能作为待核对原文，不得误作同商品另一价格");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-Macbook" && row.source_cell === "K3")?.normalized_data.procurement_cny, null, "京东方替代报价不能自动定价");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "LCD-Macbook")?.unparsed_addresses?.includes("K3"), "京东方替代报价须单独待核对");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "LCD-Macbook")?.unparsed_addresses?.includes("F34"), "后续不同布局的液晶单价不能被静默跳过");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-SM A系列背光屏" && row.source_cell === "L4")?.normalized_data.supplier_identifier, "1071", "背光屏应保留来源供应商身份");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-SM A系列背光屏" && row.source_cell === "L4")?.normalized_data.packaging_cny, 1, "默认蓝色彩盒成本须与屏幕单价分列");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-SM A系列背光屏" && row.source_cell === "L4")?.normalized_data.quality, "ORG", "ORG 仅保留原品质标签，不得冒称已证实原厂正品");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "Spare parts-iphone " && row.source_cell === "C4")?.normalized_data.procurement_cny, null, "未注明货币单位的小配件数字不得直接定价");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "Spare parts-iphone ")?.unparsed_addresses?.includes("B4"), "原仿双价必须保留为未解析，不得随意取其中一价");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-SM A系列OLED" && row.source_cell === "H5")?.normalized_data.specifications.assembly, "单片", "MOLED单片屏和带框屏必须是不同报价规格");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-SM A系列OLED" && row.source_cell === "I5")?.normalized_data.procurement_cny, 110, "MOLED带框屏应读取带框报价");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-SM A系列OLED" && row.source_cell === "H5")?.normalized_data.packaging_cny, 1, "明确的统一包装费必须与采购价分列");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "LCD-SM A系列OLED")?.unparsed_addresses?.includes("O5"), "换面报价不能冒充带框MOLED屏价格");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-SM A系列换面" && row.source_cell === "F5")?.normalized_data.supplier_identifier, "1049", "换面屏主报价区必须保留独立供应商编号");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "LCD-SM A系列换面" && row.source_cell === "F58")?.normalized_data.supplier_identifier, "4338", "背光屏子报价区不能继承主区供应商编号");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "LCD-SM A系列换面")?.unparsed_addresses?.includes("G5"), "中框加价不能被自动合并为带框成品价");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPad触摸总成+液晶总成" && row.source_cell === "E4")?.normalized_data.packaging_cny, 5, "iPad液晶总成包装费必须与采购价分列");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPad触摸总成+液晶总成" && row.source_cell === "E18")?.normalized_data.color, "黑", "来源明确的单色价格可保留颜色，不得丢成通用价");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "iPad触摸总成+液晶总成" && row.source_cell === "D31")?.normalized_data.part_type, "触摸总成", "iPad触摸总成与液晶总成不得混为一种商品");
assert.ok(parsed.sheets.find((sheet) => sheet.name === "iPad触摸总成+液晶总成")?.unparsed_addresses?.includes("G31"), "铜膜附加费不能擅自并入触摸总成采购价");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "JC跑诊断产品" && row.source_cell === "G8")?.normalized_data.quality, "JCID跑诊断·高容量", "JC高容量与标容量电池必须分开报价");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "JC跑诊断产品" && row.source_cell === "G8")?.normalized_data.packaging_cny, 0, "JC原价带盒，不得重复加包装费");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "JC跑诊断产品" && row.source_cell === "K29")?.normalized_data.specifications.panel_subtype, "柔OLED", "JC硬OLED和柔OLED不能混价");
assert.equal(parsed.candidates.find((row) => row.source_sheet === "JC跑诊断产品" && row.source_cell === "K53")?.normalized_data.specifications.panel_subtype, "INCELL", "JC INCELL不能冒充OLED");
for (const candidate of parsed.candidates.filter((row) => Object.keys(row.normalized_data.specifications).length)) {
  const family = candidate.normalized_data.part_type === "电池" || candidate.normalized_data.part_type === "电芯" ? "BATTERY" : candidate.normalized_data.part_type === "后盖" ? "COVER" : "SCREEN";
  assert.equal(normalizeProductSpecifications(candidate.normalized_data.specifications, family).error, "", `${candidate.source_sheet} ${candidate.source_cell} 的自动规格必须能通过现有商品分类校验`);
}
const oversizedWorkbook = XLSX.utils.book_new();
const oversizedSheet = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(oversizedSheet, [["异常格式"]], { origin: "A10001" });
XLSX.utils.book_append_sheet(oversizedWorkbook, oversizedSheet, "异常范围");
assert.throws(() => parseProductWorkbook(XLSX.write(oversizedWorkbook, { type: "buffer", bookType: "xlsx" })), /超过 10000 行/, "异常表范围应拒绝，避免展开整表导致服务卡死");
const standard = parsed.candidates.find((row) => row.normalized_data.sku === "LCD-IP15-OLED");
assert.ok(standard, "标准明细必须识别SKU候选");
const ambiguousSkuWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(ambiguousSkuWorkbook, XLSX.utils.aoa_to_sheet([
  ["系统SKU", "商品名称", "型号", "人民币采购价"],
  ["ZK-2609-000001", "已有商品", "iPhone 15", 320],
]), "误传的调价表");
const ambiguousSku = parseProductWorkbook(XLSX.write(ambiguousSkuWorkbook, { type: "buffer", bookType: "xlsx" }));
assert.ok(ambiguousSku.candidates.every((row) => row.normalized_data.sku !== "ZK-2609-000001"), "系统 SKU 不得被解析为供应商货号");
assert.ok(validateNormalizedProduct({ sku: "ZK-2609-000001", name_zh: "已有商品", category_id: "12345678-1234-1234-1234-123456789abc", procurement_cny: 320 }).issues.some((issue) => issue.includes("系统 SKU")), "人工核准时也必须拦截误填的系统 SKU");
const priceWorkbook = (entries) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([PRICE_IMPORT_HEADERS, ...entries]), "价格更新");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
};
const priceRows = parseProductPriceImport(priceWorkbook([["ZK-2609-000001", "采购价", 82, 1, "2026-09-28", "供应商报价 / A12"], ["ZK-2609-000001", "包装费", 0, 1, "2026-09-28", "采购确认无包装费"]]), "2026-09-28");
assert.equal(priceRows.length, 2, "不同价格项目可以同批更新");
assert.equal(priceRows[1].amount, 0, "明确填写的 0 价格应保留");
assert.throws(() => parseProductPriceImport(priceWorkbook([["1191", "采购价", 82, 1, "2026-09-28", "来源"]]), "2026-09-28"), /系统 SKU/, "供应商身份编号不能用于商品调价");
assert.throws(() => parseProductPriceImport(priceWorkbook([["ZK-2609-000001", "采购价", "", 1, "2026-09-28", "来源"]]), "2026-09-28"), /空白与 0/, "空白金额不能被当成零");
assert.throws(() => parseProductPriceImport(priceWorkbook([["ZK-2609-000001", "采购价", 82, 1, "2026-09-28", "来源"], ["ZK-2609-000001", "采购价", 85, 1, "2026-09-28", "来源"]]), "2026-09-28"), /重复/, "同一价格阶梯不能在文件内重复");
assert.throws(() => parseProductPriceImport(priceWorkbook([["ZK-2609-000001", "采购价", 82, 1, "2026-09-29", "来源"]]), "2026-09-28"), /晚于今天/, "未来价格不得误作今日生效");
const formulaWorkbook = XLSX.utils.book_new();
const formulaSheet = XLSX.utils.aoa_to_sheet([PRICE_IMPORT_HEADERS, ["ZK-2609-000001", "采购价", 82, 1, "2026-09-28", "来源"]]);
formulaSheet.C2 = { t: "n", f: "80+2", v: 82 };
XLSX.utils.book_append_sheet(formulaWorkbook, formulaSheet, "价格更新");
assert.throws(() => parseProductPriceImport(XLSX.write(formulaWorkbook, { type: "buffer", bookType: "xlsx" }), "2026-09-28"), /公式/, "公式缓存值不得冒充已确认采购价");
const priceImportMigration = read("supabase/migrations/202609280005_product_price_batch_import.sql");
assert.match(priceImportMigration, /for update[\s\S]*?expected_price_id[\s\S]*?原价格已变化/, "发布时必须重新锁定并核对预览的旧价格版本");
assert.match(priceImportMigration, /pricebooks\.import[\s\S]*?pricebooks\.publish[\s\S]*?pricebooks\.manage/, "调价发布必须同时验证导入、发布和价格维护权限");
assert.equal(standard.status, "REVIEW", "来源表未明确映射系统分类时必须核对，不能直接发布");
assert.equal(standard.normalized_data.procurement_cny, 320, "人民币采购价必须保持数值精度");
assert.equal(standard.normalized_data.sale_usd, 58.5, "美元销售参考价必须保持数值精度");
const matrix = parsed.candidates.find((row) => row.source_sheet === "通用屏幕矩阵");
assert.ok(matrix, "矩阵价格表必须保留候选而非静默丢弃");
assert.equal(matrix.status, "REVIEW", "矩阵候选在型号或品质语义不明确时必须进入核对区，禁止猜测发布");
assert.equal(matrix.normalized_data.name_zh, "", "矩阵邻近数字不得被拼接成已确认商品名称");
assert.equal(matrix.normalized_data.model, "", "矩阵邻近数字不得伪装成产品型号");
assert.equal(matrix.normalized_data.procurement_cny, null, "矩阵数字尚未确认是采购价时不得预填金额");
assert.ok(matrix.source_cell, "每个候选必须保留原单元格定位");
const supplierMatrix = parsed.candidates.filter((row) => row.source_sheet === "供应商矩阵");
assert.ok(supplierMatrix.length > 0, "带供应商编号的矩阵仍须识别真实价格候选");
assert.ok(supplierMatrix.every((row) => row.source_row !== 2), "工作表顶部的供应商代码不能被当成商品价格");
assert.ok(supplierMatrix.every((row) => row.normalized_data.supplier_identifier === "" && row.normalized_data.sku === ""), "矩阵可有多供应商报价区，不能把顶部代码默认赋给所有线索或当单品SKU");
const invalidMoq = parsed.candidates.find((row) => row.normalized_data.name_zh === "错误起订量商品");
assert.equal(invalidMoq?.status, "REVIEW", "零起订量不得静默替换为1后直接发布");
const invalidPrice = parsed.candidates.find((row) => row.normalized_data.name_zh === "错误价格商品");
assert.equal(invalidPrice?.status, "REVIEW", "无效的包装费不得静默忽略后直接发布");

const invalid = validateNormalizedProduct({ name_zh: "测试商品", procurement_cny: 10 });
assert.ok(!invalid.issues.some((issue) => issue.includes("SKU")), "SKU必须由系统生成，不能要求用户填写");
assert.deepEqual(invalid.issues, ["请先选择商品分类并核对专有规格"], "缺少分类的商品不能绕过规格核对；SKU仍由系统生成");
const valid = validateNormalizedProduct({ sku: "TEST-001", category_id: "12345678-1234-1234-1234-123456789abc", name_zh: "测试商品", procurement_cny: 10, minimum_order_quantity: 1 });
const malformedPrice = validateNormalizedProduct({ category_id: "12345678-1234-1234-1234-123456789abc", name_zh: "测试商品", procurement_cny: "1,23", minimum_order_quantity: 1 });
assert.equal(malformedPrice.normalized.procurement_cny, null, "不规范千分位不得被错读成另一个金额");
assert.match(malformedPrice.issues.join(" "), /人民币采购价格式无效/, "复核输入的无效金额必须显示错误，不能静默清空");
assert.equal(validateNormalizedProduct({ category_id: "12345678-1234-1234-1234-123456789abc", name_zh: "测试商品", procurement_cny: "¥1,234.50", minimum_order_quantity: 1 }).normalized.procurement_cny, 1234.5);
const priceApi = read("app/api/product-prices/route.ts");
assert.match(priceApi, /if \(!supportedKinds\.has\(priceKind\)\)/, "无效价格类型不得静默改为采购价");
assert.match(priceApi, /priceKind === "SALE_REFERENCE" \? "pricebooks\.sales\.view" : "pricebooks\.cost\.view"/, "手工改价必须按价格类型核对销售或采购查看权限");
assert.match(priceApi, /amountText = String\(body\.amount \?\? ""\)[\s\S]*if \(!\/\^\\d\+/, "未填价格不得通过 Number 空值变成已确认零元");
assert.match(read("supabase/migrations/202609230006_product_price_validation.sql"), /p_currency is distinct from[\s\S]*p_amount is null[\s\S]*p_amount<>round\(p_amount,4\)/, "数据库须拒绝币种错配、空价格和隐式精度截断");
assert.match(read("supabase/migrations/202609230006_product_price_validation.sql"), /pg_advisory_xact_lock\(hashtext\(p_product_id::text\)\)/, "手工改价须与导入发布使用同一商品锁");
assert.match(read("supabase/migrations/202609230006_product_price_validation.sql"), /p_effective_from>current_date/, "未实现预约调价前不得停用现价并写入未来价格");
assert.match(read("components/product-pricebook-view.tsx"), /loadVersion\.current[\s\S]*finally\{if\(version===loadVersion\.current\)setLoading\(false\)[\s\S]*重新加载/, "价格表加载失败不得永久转圈，且必须可重试");
assert.match(read("components/product-pricebook-view.tsx"), /searchProducts\(\)[\s\S]*q:productQuery\.trim\(\)[\s\S]*aria-label="搜索商品"/, "手工维护价格时须能搜索超过首页100条的商品");
assert.match(read("components/product-pricebook-view.tsx"), /key==="SALE_REFERENCE"\?Boolean\(data\?\.can_view_sales\):Boolean\(data\?\.can_view_cost\)/, "采购员的维护下拉框不得显示美元销售参考价");
assert.match(read("supabase/migrations/202609280007_product_price_kind_write_guard.sql"), /before insert or update on public\.product_prices[\s\S]*guard_product_price_kind_write/, "价格表写入必须在数据库边界按价格类型拦截越权操作");
for (const path of ["app/api/products/route.ts", "app/api/products/[id]/route.ts"]) {
  assert.doesNotMatch(read(path), /supplier_code:\s*String\(body\.supplier_code\s*\|\|\s*normalized\.sku/, "系统 SKU 绝不能自动伪装成供应商商品货号");
}
assert.deepEqual(valid.issues, [], "完整商品候选应通过校验");
assert.deepEqual(normalizeProductSpecifications({ assembly_scope: "中框+后盖", color_source: "供应商报价单" }, "COVER").specifications, { assembly_scope: "中框+后盖", color_source: "供应商报价单" }, "后盖装配范围和颜色来源要分别保存");
assert.match(normalizeProductSpecifications({ capacity_mah: "3000" }, "COVER").error, /不支持/, "电池专用规格不能混入后盖商品");
assert.match(normalizeProductSpecifications({ assembly_scope: 123 }, "COVER").error, /必须为文字/, "规格类型错误不得直接保存");
assert.equal(isProductFieldApplicable("display_technology", "COVER"), false, "后盖不能展示屏幕显示技术");
assert.equal(isProductFieldApplicable("manufacturer_brand", "SMALL_PART"), false, "维修小配件不能展示屏幕厂牌");
assert.equal(isProductFieldApplicable("manufacturer_brand", "BATTERY"), true, "品牌电池可依据来源记录实际生产厂牌");
assert.equal(isProductFieldApplicable("color", "SMALL_PART"), false, "维修小配件默认不展示颜色字段");
assert.equal(isProductFieldApplicable("color", "COVER"), true, "后盖可根据供应商证据记录颜色");
assert.match(validateProductFamilyFields({ display_technology: "OLED" }, "COVER"), /不适用/, "新增后盖不得存入屏幕技术");
assert.match(validateProductFamilyFields({ color: "黑色" }, "SMALL_PART"), /不适用/, "新增小配件不得存入无依据的颜色");
assert.equal(validateProductFamilyFields({ display_technology: "OLED" }, "COVER", { display_technology: "OLED" }), "", "修订历史商品不能静默丢弃旧字段");
assert.equal(validateProductFamilyFields({ display_technology: "OLED" }, "SCREEN"), "", "屏幕品类可保存显示技术");
const catalogForm = read("components/product-catalog-view.tsx");
assert.match(catalogForm, /isProductFieldApplicable\(key as FamilyLimitedField,family\)/, "商品表单必须按品类显示通用字段");
assert.match(catalogForm, /manufacturer_brand:isProductFieldApplicable[\s\S]*display_technology:isProductFieldApplicable[\s\S]*color:isProductFieldApplicable/, "切换品类时必须清除不适用的未保存字段");
const pricebookForm = read("components/product-pricebook-view.tsx");
assert.match(pricebookForm, /<option value="">请选择已核对的商品<\/option>/, "维护价格不能预选第一件商品");
assert.match(pricebookForm, /disabled=\{!form\.product_id\|\|form\.amount===""\}/, "明确填写的零元费用不能被误判为空值");

const permissions = read("lib/auth/permissions.ts");
for (const code of ["products.view","products.manage","pricebooks.view","pricebooks.sales.view","pricebooks.cost.total.view","pricebooks.cost.view","pricebooks.manage","pricebooks.import","pricebooks.publish"]) {
  assert.match(permissions, new RegExp(code.replaceAll(".", "\\.")), `权限目录缺少 ${code}`);
}
const migration = read("supabase/migrations/202609220002_product_catalog_pricebook.sql");
const closedLoopMigration = read("supabase/migrations/202609220003_product_quote_closed_loop.sql");
const integrityMigration = read("supabase/migrations/202609230001_product_supplier_and_quote_integrity.sql");
const specificationMigration = read("supabase/migrations/202609230003_product_family_specifications.sql");
const parserVersionMigration = read("supabase/migrations/202609230004_product_import_parser_version.sql");
const reviewBatchMigration = read("supabase/migrations/202609230007_product_import_review_batches.sql");
assert.match(specificationMigration, /add column if not exists product_family text/, "分类必须明确规格类型");
assert.match(specificationMigration, /product_specifications_snapshot jsonb/, "报价与备货必须保留商品规格快照");
assert.match(specificationMigration, /product_color_snapshot text/, "报价与备货必须保留保存时的颜色快照");
assert.match(parserVersionMigration, /unique index[\s\S]*file_sha256,parser_version/, "修正来源坐标后，同文件应允许生成新解析版本批次");
assert.match(parserVersionMigration, /旧版解析坐标，禁止发布/, "旧版解析批次不得继续发布");
assert.match(parserVersionMigration, /A1-V12/, "新解析版本须与数据库发布保护同步");
assert.match(integrityMigration, /add column if not exists supplier_identifier text/, "供应商编号必须有独立字段");
assert.match(integrityMigration, /function public\.publish_product_import\(p_batch_id uuid\)[\s\S]*target\.status<>'READY'[\s\S]*uncovered_sheets'[\s\S]*status in \('REVIEW','ERROR'\)/, "仍有未识别来源或未核准行时必须阻止整批发布");
assert.match(integrityMigration, /source_row_count <> target\.candidate_count[\s\S]*selected\.id[\s\S]*status in \('VALID','PUBLISHED'\)/, "分批发布只能选择完整保存批次中的已核准记录");
assert.match(read("app/api/product-imports/route.ts"), /sheet\.mode === "MATRIX"[\s\S]*uncoveredSheets/, "矩阵页必须记入未覆盖工作表");
assert.match(read("app/api/product-imports/route.ts"), /status: "FAILED"[\s\S]*savedCount !== parsed\.candidates\.length[\s\S]*status: finalStatus/, "分批写入未完成时不得把批次开放发布");
assert.match(read("app/api/product-imports/route.ts"), /reparsed\.candidates\.length !== existingBatch\.candidate_count[\s\S]*ignoreDuplicates: true[\s\S]*saved\.count !== reparsed\.candidates\.length[\s\S]*refreshProductImportBatchCounts/, "同文件续传须只补缺失来源行并在完整对账后解锁");
assert.match(read("lib/product-import-batch.ts"), /!\["REVIEW", "READY"\]\.includes\(data\.status\)[\s\S]*refresh_product_import_batch_counts/, "编辑与数量刷新必须经过批次状态检查");
assert.match(reviewBatchMigration, /for update[\s\S]*saved_count <> target\.candidate_count[\s\S]*status='FAILED'/, "数量刷新须锁住批次并拒绝不完整来源");
assert.match(read("app/api/product-imports/[id]/publish/route.ts"), /row_ids[\s\S]*publish_product_import_rows/, "分批发布接口必须提交明确的已核准来源行");
assert.match(integrityMigration, /function public\.publish_product_import_rows[\s\S]*matched_count <> requested_count[\s\S]*status='VALID'[\s\S]*status='PUBLISHED'/, "发布必须只写入所选核准行，并保留已发布行幂等性");
assert.match(integrityMigration, /seen_product_ids[\s\S]*product_record\.id=any\(seen_product_ids\)/, "同次发布不能让一个商品的多个价格线索互相覆盖");
assert.match(reviewBatchMigration, /add column if not exists source_variant[\s\S]*source_excerpt[\s\S]*product_import_rows_source_variant_key/, "人工拆分须保留真实源单元格与变体序号");
assert.match(reviewBatchMigration, /raw_cell:=source_record\.source_values[\s\S]*strpos\(raw_cell,btrim\(p_excerpt\)\)=0[\s\S]*status='REVIEW'[\s\S]*原始整格尚有待核对内容/, "拆分原文必须在真实单元格内，未处理完整格仍须留在待核对");
assert.match(reviewBatchMigration, /target\.parser_version is distinct from 'A1-V12'[\s\S]*target\.candidate_count/, "旧解析批次或保存不完整批次不得拆分");
assert.match(reviewBatchMigration, /source_record\.source_variant<>1[\s\S]*source_record\.status not in \('REVIEW','ERROR'\)[\s\S]*source_variant>1/, "拆分必须始终以未关闭的原始整格为锚，且首次拆分后仍可追加其他商品");
assert.match(integrityMigration, /split_row\.source_variant>1[\s\S]*row_record\.source_variant=1/, "原始整格与拆分商品绝不能重复发布");
const atomicReviewMigration = read("supabase/migrations/202609230008_product_import_atomic_review.sql");
assert.match(atomicReviewMigration, /select \* into target from public\.product_import_batches where id=p_batch_id for update[\s\S]*select \* into source_record from public\.product_import_rows[\s\S]*for update/, "人工核对须先锁批次再锁来源行，避免与发布交错");
assert.match(atomicReviewMigration, /child_exists[\s\S]*confirm_split_complete' is distinct from 'true'/, "结束拆分必须由用户显式确认");
assert.match(read("app/api/product-imports/[id]/rows/[rowId]/route.ts"), /admin\.rpc\("apply_product_import_review"/, "单行核对必须走原子事务");
assert.match(read("app/api/product-imports/[id]/rows/route.ts"), /admin\.rpc\("apply_product_import_review"/, "批量核对必须走原子事务");
assert.match(reviewBatchMigration, /source_excerpt is not null[\s\S]*greatest\(strpos\(raw_cell,btrim\(p_excerpt\)\),strpos\(raw_cell,source_excerpt\)\)/, "同一单元格的拆分片段不得重叠重复发布");
assert.match(read("app/api/product-imports/[id]/rows/[rowId]/split/route.ts"), /requirePermission\("pricebooks\.import"\)[\s\S]*split_product_import_row/, "拆分接口必须通过导入核对权限与数据库事务");
assert.match(read("components/product-import-review-view.tsx"), /publishableIds[\s\S]*row_ids: publishableIds[\s\S]*拆分同一单元格/, "核对页面须支持选择核准行分批发布和逐格拆分");
assert.match(read("components/product-import-review-view.tsx"), /loadVersion\.current[\s\S]*finally \{[\s\S]*setLoading\(false\)[\s\S]*重新加载/, "核对页网络异常不得永久转圈，且应允许重试");
assert.match(integrityMigration, /match_count>1[\s\S]*禁止自动覆盖/, "多商品匹配不能任意选择一条覆盖");
assert.match(integrityMigration, /category_id=\(row_record\.normalized_data->>'category_id'\)::uuid[\s\S]*specifications=coalesce\(row_record\.normalized_data->'specifications'/, "无货号匹配必须比较分类及全部专有规格");
assert.doesNotMatch(integrityMigration, /update public\.products set supplier_identifier=supplier_id/, "价格更新不得覆盖商品主档名称和规格");
assert.match(integrityMigration, /supplier_id:=nullif[\s\S]*supplier_identifier[\s\S]*supplier_code=external_code/, "导入去重须区别供应商编号与单品货号");
assert.match(integrityMigration, /create or replace function public\.revise_quote[\s\S]*product_sku_snapshot,supplier_code_snapshot[\s\S]*unit_cost_cny,suggested_unit_price,exchange_rate_snapshot,pricing_rule_snapshot/, "报价修订不能丢失商品与定价快照");
assert.match(integrityMigration, /function public\.product_cost_at_quantity[\s\S]*pricebooks\.cost\.total\.view[\s\S]*pricebooks\.cost\.view/, "直接调用完整成本函数也必须经过成本权限校验");
assert.match(integrityMigration, /function public\.product_cost_at_quantity[\s\S]*count\(distinct price_kind\)<>3 then null/, "数据库报价成本快照不得把缺失的包装或其他费用算作零");
assert.match(migration, /product_import_batches[\s\S]*file_sha256[\s\S]*unique\(file_sha256\)/, "相同源文件必须幂等去重");
assert.match(migration, /status in \('REVIEW','ERROR'\)[\s\S]*仍有待处理或错误数据，不能发布/, "待核对或错误行必须阻止发布");
assert.match(migration, /source_import_row_id[\s\S]*source_note/, "价格必须追溯到导入来源");
assert.match(migration, /price_kind in \('PROCUREMENT','PACKAGING','OTHER_COST','SALE_REFERENCE'\)/, "完整成本必须拆分采购、包装和其他成本");
assert.match(migration, /role_code = 'SALES'[\s\S]*pricebooks\.cost\.total\.view/, "销售员默认只能查看完整成本合计");
assert.match(migration, /role_code = 'WAREHOUSE'[\s\S]*pricebooks\.cost\.view/, "仓库员默认可查看成本拆分");
assert.match(migration, /price_kind='SALE_REFERENCE' and public\.current_user_has_business_permission\('pricebooks\.sales\.view'\)/, "销售参考价必须单独鉴权");
assert.match(migration, /if target\.status = 'PUBLISHED'[\s\S]*idempotent/, "重复发布必须幂等");
assert.match(closedLoopMigration, /candidate := 'ZK-' \|\| to_char\(current_date, 'YYMM'\)[\s\S]*nextval[\s\S]*not exists\(select 1 from public\.products where sku=candidate\)/, "系统SKU必须由数据库序列并发安全生成并避让历史编码");
assert.match(closedLoopMigration, /product_cost_at_quantity/, "报价成本必须按数量档位计算");
assert.match(closedLoopMigration, /sales_pricing_settings[\s\S]*sales_pricing_rules/, "必须同时支持全局和商品或分类覆盖规则");
assert.match(closedLoopMigration, /product_sku_snapshot[\s\S]*exchange_rate_snapshot[\s\S]*pricing_rule_snapshot/, "报价必须保存商品、汇率和规则快照");

const tiers = [
  {price_kind:"PROCUREMENT",currency:"CNY",amount:100,minimum_quantity:1,is_active:true,effective_from:"2026-01-01"},
  {price_kind:"PROCUREMENT",currency:"CNY",amount:80,minimum_quantity:100,is_active:true,effective_from:"2026-01-01"},
  {price_kind:"PACKAGING",currency:"CNY",amount:2,minimum_quantity:1,is_active:true,effective_from:"2026-01-01"},
  {price_kind:"OTHER_COST",currency:"CNY",amount:3,minimum_quantity:1,is_active:true,effective_from:"2026-01-01"},
];
assert.equal(activeTier(tiers,"PROCUREMENT",50)?.amount,100,"数量50必须使用MOQ1采购价");
assert.equal(activeTier(tiers,"PROCUREMENT",100)?.amount,80,"数量100必须使用MOQ100采购价");
assert.equal(completeCostCny(tiers,100),85,"完整成本不能把不同MOQ采购价相加");
assert.equal(completeCostCny(tiers.filter((tier)=>tier.price_kind!=="PACKAGING"),100),null,"缺包装成本时不得把未知费用当作零");
assert.equal(completeCostCny(tiers.filter((tier)=>tier.price_kind!=="OTHER_COST"),100),null,"缺其他成本时不得把未知费用当作零");
assert.equal(completeCostCny([...tiers.filter((tier)=>tier.price_kind!=="OTHER_COST"),{price_kind:"OTHER_COST",currency:"CNY",amount:0,minimum_quantity:1,is_active:true,effective_from:"2026-01-01"}],100),82,"显式确认无其他费用的零值应正常计入完整成本");
assert.equal(completeCostCny([...tiers.filter((tier)=>tier.price_kind!=="OTHER_COST"),{price_kind:"OTHER_COST",currency:"USD",amount:3,minimum_quantity:1,is_active:true,effective_from:"2026-01-01"}],100),null,"美元费用不得混入人民币完整成本");
assert.equal(activeTier(tiers,"PROCUREMENT",0.5),null,"低于全部有效起订档位时不得冒用价格");
assert.equal(completeCostCny(tiers.filter((tier)=>tier.price_kind!=="PROCUREMENT"),1),null,"没有采购成本时不得把完整成本伪装为0元");
assert.equal(suggestedUsdPrice(72,7.2,{markup_percent:20,minimum_margin_percent:15,rounding_increment:0.5}),12,"建议价必须满足加价和最低毛利并向上取整");
assert.equal(initialQuoteUnitPrice(12,10),12,"完整成本建议价优先用于报价预填");
assert.equal(initialQuoteUnitPrice(0,10),10,"成本未确认但有销售参考价时不得预填零售价");
assert.equal(initialQuoteUnitPrice(0,null),0,"无可靠建议价与参考价时不伪造销售价格");

const shell = read("components/app-shell.tsx");
assert.doesNotMatch(read("components/product-import-review-view.tsx"), /packaging_cny:\s*row\.normalized_data\.packaging_cny\s*\?\?\s*0/, "核对表单不得把未确认包装费静默改成零");
assert.match(read("components/product-import-review-view.tsx"), /核对记录（非商品数）[\s\S]*待拆解数字线索/, "核对页必须明确区分价格线索和已确认商品数");
assert.match(read("components/product-import-view.tsx"), /核对记录（非商品数）/, "导入批次列表不能把来源数字线索冒充商品数");
assert.match(read("app/api/quote-products/route.ts"), /suggested_price_usd:cost===null\?0:Math\.max\(calculated,reference\)/, "成本不完整时不得把销售参考价误称为按成本计算的建议价");
assert.match(read("app/api/product-prices/route.ts"), /if \(!sourceNote \|\| sourceNote\.length > 500\)/, "手工调价必须要求可回查的来源或说明");
assert.match(read("components/product-pricebook-view.tsx"), /source_note:""/, "手工价格表不得预填无法核验的笼统来源");
assert.match(read("app/api/product-prices/route.ts"), /find_product_alias_ids/, "产品价格表搜索必须覆盖商品别名");
assert.match(read("app/api/product-prices/route.ts"), /匹配商品过多，请缩小搜索关键词/, "价格表不得在大范围匹配时静默截断商品");
assert.match(read("supabase/migrations/202609280001_product_price_source_guard.sql"), /nullif\(btrim\(coalesce\(p_source_note,''\)\),''\) is null/, "直接调用价格函数也不得绕过来源要求");
assert.match(read("supabase/migrations/202609280002_product_alias_search.sql"), /unnest\(p\.aliases\)[\s\S]*position\(lower\(btrim\(p_query\)\) in lower\(alias\.value\)\)>0/, "历史商品别名必须可检索且不重写原商品数据");
assert.match(read("app/api/products/route.ts"), /find_product_alias_ids/, "商品资料搜索必须覆盖别名");
assert.match(read("app/api/quote-products/route.ts"), /find_product_alias_ids/, "报价选品搜索必须覆盖别名");
for (const path of ["app/api/products/route.ts","app/api/quote-products/route.ts"]) assert.match(read(path), /\.eq\("prices\.is_active",\s*true\)/, `${path} 不应每次读取所有历史价格版本`);
assert.match(shell, /label: "商品中心"[\s\S]*商品资料[\s\S]*商品分类[\s\S]*产品价格表[\s\S]*销售报价设置[\s\S]*导入报价表/, "商品中心必须提供完整且有序的业务入口");
assert.match(shell, /if \(href === "\/products"\) return path === "\/products"/, "商品资料必须精确匹配，禁止与分类、价格、报价设置或导入页面同时高亮");
for (const path of ["components/product-catalog-view.tsx","components/product-pricebook-view.tsx","components/product-import-view.tsx","components/product-import-review-view.tsx"]) {
  const source = read(path);
  assert.match(source, /AppPagination|AppDialog|AppFilterBar/, `${path} 必须复用现有统一组件`);
  assert.doesNotMatch(source, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/, `${path} 禁止使用浏览器原生弹框`);
}
const importBatch = read("lib/product-import-batch.ts");
assert.match(importBatch, /refresh_product_import_batch_counts/, "导入批次数量须由数据库聚合刷新，不能依赖默认分页行数");
assert.match(reviewBatchMigration, /count\(\*\)[\s\S]*filter \(where status='PUBLISHED'\)/, "导入批次数量须包含已发布来源行");

console.log("商品资料、产品价格表、安全导入和权限回归测试通过。");
