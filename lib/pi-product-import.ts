import { validPiMoney, validPiQuantity, validPiSellingPrice } from "./pi-line-values.ts";

export type ParsedPiProductLine = {
  item_name: string;
  brand: string;
  model: string;
  quality: string;
  description: string;
  description_zh: string;
  quantity: string;
  unit_price_cny: string;
  unit_price_payment: string;
  estimated_unit_cost_cny: string;
  preparation_requirement: string;
  internal_note: string;
};

const productHeaders = ["产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "成本单价（CNY） *", "销售单价（CNY） *", "数量 *"];
const expandedProductHeaders = ["产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "产品质量/描述中文（展示给后端）", "成本单价（CNY） *", "销售单价（CNY） *", "数量 *", "理货要求", "销售备注"];
const legacyCalculatedHeaders = ["产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "产品质量/描述中文（展示给后端）", "成本单价（CNY） *", "销售单价（CNY） *", "数量 *", "销售金额（CNY）", "总利润（CNY）", "利润率", "理货要求", "销售备注"];
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Shared parser for the PI detail Excel import and tab-delimited paste actions. */
export function parsePiProductRows(rows: unknown[][], paymentPerCny: number): ParsedPiProductLine[] {
  if (!Number.isFinite(paymentPerCny) || paymentPerCny <= 0) throw new Error("请先选择付款币种并填写有效汇率，再导入产品明细");
  const cells = rows.map((row) => row.map((value) => String(value ?? "").trim()));
  const first = cells.find((row) => row.some(Boolean)) || [];
  if (first.some((value) => /PI基本信息|PI整单导入模板/.test(value))) throw new Error("请使用“PI产品明细”导入模板，不要导入PI整单模板");
  const legacy = first[0] === "产品名称";
  const productHeader = first[0] === productHeaders[0] && first[5] === productHeaders[5] && first[7] === productHeaders[7];
  const expandedProductHeader = first[0] === expandedProductHeaders[0] && first[8] === expandedProductHeaders[8] && first[10] === expandedProductHeaders[10];
  const legacyCalculatedHeader = first[0] === legacyCalculatedHeaders[0] && first[9] === legacyCalculatedHeaders[9];
  const oldTemplate = first[0] === "产品";
  const legacyCalculated = legacyCalculatedHeader || (!productHeader && !legacy && !oldTemplate && first.length >= 14);
  const withChineseDescription = !productHeader && (expandedProductHeader || legacyCalculated || legacy || oldTemplate || first[5]?.startsWith("产品质量/描述中文") || first.length >= 11);
  const dataRows = cells.filter((row) => (legacyCalculated ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13] : Array.from({ length: Math.min(row.length, 11) }, (_, index) => index)).some((index) => String(row[index] ?? "").trim()));
  if (productHeader || expandedProductHeader || legacyCalculatedHeader || oldTemplate || legacy) dataRows.shift();
  if (!dataRows.length || dataRows.length > 500) throw new Error("请导入1至500条产品明细");
  return dataRows.map((row, index) => {
    const quantityIndex = legacy ? 6 : withChineseDescription ? 8 : 7;
    const priceIndex = legacy ? 7 : withChineseDescription ? 7 : 6;
    const costIndex = legacy ? 8 : withChineseDescription ? 6 : 5;
    const quantity = Number(row[quantityIndex]);
    const unitPrice = Number(row[priceIndex]);
    const cost = Number(row[costIndex]);
    if (!row[0] || !row[1] || !row[2] || !row[3] || !validPiQuantity(row[quantityIndex]) || !validPiMoney(row[priceIndex]) || !validPiMoney(row[costIndex])) {
      throw new Error(`第${index + 1}行须填写产品、品牌、型号、质量、整数数量、人民币成本和售价（金额最多两位小数）`);
    }
    if (!validPiSellingPrice(row[priceIndex], row[costIndex])) throw new Error(`第${index + 1}行人民币售价必须高于成本价`);
    return {
      item_name: row[0], brand: row[1], model: row[2], quality: row[3],
      description: row[4] || "", description_zh: withChineseDescription ? row[5] || "" : "",
      quantity: String(quantity), unit_price_cny: String(unitPrice),
      unit_price_payment: roundMoney(unitPrice * paymentPerCny).toFixed(2),
      estimated_unit_cost_cny: String(cost),
      preparation_requirement: expandedProductHeader || legacyCalculated || legacy || oldTemplate || withChineseDescription ? row[legacyCalculated ? 12 : legacy ? 9 : 9] || "" : "",
      internal_note: legacy || productHeader ? "" : row[legacyCalculated ? 13 : withChineseDescription ? 10 : 9] || "",
    };
  });
}
