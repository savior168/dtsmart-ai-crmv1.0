import { validPiMoney, validPiQuantity, validPiSellingPrice } from "./pi-line-values.ts";

export type ParsedPiProductLine = {
  source_row: number;
  item_name: string; brand: string; model: string; quality: string;
  description: string; description_zh: string; quantity: string;
  unit_price_cny: string; unit_price_payment: string;
  unit_price_source: "CNY" | "PAYMENT";
  estimated_unit_cost_cny: string; preparation_requirement: string; internal_note: string;
};

type Field = "item_name" | "brand" | "model" | "quality" | "description" | "description_zh" | "cost" | "price" | "quantity" | "preparation_requirement" | "internal_note";
type Columns = Partial<Record<Field, number>>;
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const text = (value: unknown) => String(value ?? "").trim();
const normalizedHeader = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s*：:()（）/_-]/g, "");

function fieldFor(value: string): Field | null {
  const key = normalizedHeader(value);
  if (/^(产品类型|产品名称|产品|items?|producttype)$/.test(key)) return "item_name";
  if (/^(产品品牌|brands?)$/.test(key)) return "brand";
  if (/^(产品型号|models?)$/.test(key)) return "model";
  if (/^(产品质量|quality)$/.test(key)) return "quality";
  if (/^(产品描述|description)$/.test(key)) return "description";
  if (key.startsWith("产品质量描述中文")) return "description_zh";
  if (/^(成本|成本单价(?:cny)?|unitcost(?:cny)?|purchasecost)$/.test(key)) return "cost";
  if (/^(销售单价(?:cny|usd|cny或usd)?|unitprice(?:cny|usd)?|price(?:cny|usd)?)$/.test(key)) return "price";
  if (/^(数量|quantity|qty)$/.test(key)) return "quantity";
  if (key === "理货要求") return "preparation_requirement";
  if (key === "销售备注") return "internal_note";
  return null;
}

function findHeader(rows: string[][]): { index: number; columns: Columns; priceCurrency: "CNY" | "USD" } | null {
  for (let index = 0; index < Math.min(rows.length, 60); index++) {
    const columns: Columns = {};
    rows[index].forEach((value, column) => { const field = fieldFor(value); if (field && columns[field] === undefined) columns[field] = column; });
    if (["item_name", "brand", "model", "quality", "price", "quantity"].every((field) => columns[field as Field] !== undefined)) {
      const priceHeading = rows[index][columns.price!].normalize("NFKC");
      return { index, columns, priceCurrency: /\bUSD\b|美元/i.test(priceHeading) && !/CNY\s*或\s*USD/i.test(priceHeading) ? "USD" : "CNY" };
    }
  }
  return null;
}

export function hasPiProductHeader(rows: unknown[][]): boolean {
  return findHeader(rows.map((row) => row.map(text))) !== null;
}

function moneyToken(value: string, row: number, field: string, defaultCurrency: "CNY" | "USD") {
  const match = value.normalize("NFKC").match(/^(¥|\$|CNY|RMB|USD)?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)$/i);
  if (!match) throw new Error(`第${row}行${field}须填写金额，最多两位小数；可用 ¥ 或 $ 标明币种`);
  const currency = match[1] ? /^(\$|USD)$/i.test(match[1]) ? "USD" : "CNY" : defaultCurrency;
  const amount = Number(match[2].replaceAll(",", ""));
  if (!Number.isFinite(amount) || amount > 999999999999) throw new Error(`第${row}行${field}超出允许范围`);
  return { currency, amount };
}

/** One strict parser for the concise template, legacy templates and copied PI product tables. */
export function parsePiProductRows(rows: unknown[][], paymentPerCny: number, paymentCurrency = "USD"): ParsedPiProductLine[] {
  if (!Number.isFinite(paymentPerCny) || paymentPerCny <= 0) throw new Error("请先选择付款币种并填写有效汇率，再导入产品明细");
  const cells = rows.map((row) => row.map(text));
  const recognized = findHeader(cells);
  const firstIndex = cells.findIndex((row) => row.some(Boolean));
  if (firstIndex < 0) throw new Error("请导入1至500条产品明细");
  if (!recognized && cells[firstIndex].some((value) => /PI基本信息|PI整单导入模板/.test(value))) throw new Error("未识别产品表头，请核对文件中的产品明细区域");
  const first = cells[recognized?.index ?? firstIndex];
  const oldLegacy = !recognized && first[0] === "产品名称";
  const oldWide = !recognized && (oldLegacy || first.length >= 14);
  const piSource = !recognized && !oldWide && /^\d+$/.test(first[0] || "") && first.length >= 12;
  const piSourceWithoutNumber = !recognized && !oldWide && !piSource && first.length >= 11 && Boolean(first[2]) && Boolean(first[7]);
  let columns: Columns;
  if (recognized) columns = recognized.columns;
  else if (piSource) columns = { item_name: 1, brand: 3, model: 4, quality: 5, description: 6, price: 8, quantity: 9, cost: 11 };
  else if (piSourceWithoutNumber) columns = { item_name: 0, brand: 2, model: 3, quality: 4, description: 5, price: 7, quantity: 8, cost: 10 };
  else if (oldLegacy) columns = { item_name: 0, brand: 1, model: 2, quality: 3, description: 4, description_zh: 5, quantity: 6, price: 7, cost: 8, preparation_requirement: 9 };
  else if (oldWide) columns = { item_name: 0, brand: 1, model: 2, quality: 3, description: 4, description_zh: 5, cost: 6, price: 7, quantity: 8, preparation_requirement: 12, internal_note: 13 };
  else columns = { item_name: 0, brand: 1, model: 2, quality: 3, description: 4, cost: 5, price: 6, quantity: 7 };
  if (columns.cost === undefined) throw new Error("产品表缺少成本单价列，请补齐后导入");
  const start = recognized ? recognized.index + 1 : oldLegacy ? firstIndex + 1 : firstIndex;
  const imported: ParsedPiProductLine[] = [];
  for (let index = start; index < cells.length; index++) {
    const row = cells[index];
    if (row.some((value) => /^(?:SUBTOTAL|小计|TOTAL|合计)\s*[:：]?$/i.test(value))) break;
    const read = (field: Field) => text(row[columns[field] ?? -1]);
    const item_name = read("item_name"), brand = read("brand"), model = read("model"), quality = read("quality");
    const costText = read("cost"), priceText = read("price"), quantityText = read("quantity");
    if (![item_name, brand, model, quality, read("description"), costText, priceText, quantityText].some(Boolean)) continue;
    const sourceRow = index + 1;
    if (quantityText && !validPiQuantity(quantityText)) throw new Error(`第${sourceRow}行数量须填写正整数`);
    const cost = costText ? moneyToken(costText, sourceRow, "成本单价", "CNY") : null;
    const price = priceText ? moneyToken(priceText, sourceRow, "销售单价", recognized?.priceCurrency || "CNY") : null;
    if ((cost?.currency === "USD" || price?.currency === "USD") && paymentCurrency !== "USD") {
      throw new Error(`第${sourceRow}行含美元价格，请先将PI付款币种选为USD，或改填人民币价格`);
    }
    const costCny = cost ? roundMoney(cost.currency === "USD" ? cost.amount / paymentPerCny : cost.amount) : null;
    const priceCny = price ? roundMoney(price.currency === "USD" ? price.amount / paymentPerCny : price.amount) : null;
    const pricePayment = price && priceCny !== null ? price.currency === "USD" ? price.amount : roundMoney(priceCny * paymentPerCny) : null;
    if ((costCny !== null && !validPiMoney(String(costCny))) || (priceCny !== null && !validPiMoney(String(priceCny))) || (pricePayment !== null && !validPiMoney(String(pricePayment))) || (costCny !== null && priceCny !== null && !validPiSellingPrice(String(priceCny), String(costCny)))) {
      throw new Error(`第${sourceRow}行换算后人民币售价须高于成本价，且金额不能超出允许范围`);
    }
    imported.push({ source_row: sourceRow, item_name, brand, model, quality, description: read("description"), description_zh: read("description_zh"),
      quantity: quantityText, unit_price_cny: priceCny === null ? "" : priceCny.toFixed(2), unit_price_payment: pricePayment === null ? "" : pricePayment.toFixed(2),
      unit_price_source: price?.currency === "USD" ? "PAYMENT" : "CNY", estimated_unit_cost_cny: costCny === null ? "" : costCny.toFixed(2),
      preparation_requirement: read("preparation_requirement"), internal_note: read("internal_note") });
    if (imported.length > 500) throw new Error("每张PI最多导入500条产品明细");
  }
  if (!imported.length) throw new Error("请导入1至500条产品明细");
  return imported;
}

