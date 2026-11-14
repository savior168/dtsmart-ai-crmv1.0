import { validPiMoney, validPiQuantity, validPiSellingPrice } from "./pi-line-values.ts";
import { QUOTE_CURRENCY_CODES } from "./currencies.ts";

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
const currencySymbols: Record<string, string> = { "€": "EUR", "£": "GBP", "₹": "INR", "₩": "KRW", "฿": "THB", "₫": "VND", "₱": "PHP", "₴": "UAH", "₽": "RUB", "₺": "TRY", "₪": "ILS", "₦": "NGN", "R$": "BRL", "C$": "CAD", "A$": "AUD", "AU$": "AUD", "US$": "USD", "CA$": "CAD", "CN¥": "CNY", "JP¥": "JPY", "NZ$": "NZD", "HK$": "HKD", "S$": "SGD" };
const moneyPrefix = /^(AU\$|US\$|CA\$|CN¥|JP¥|R\$|C\$|A\$|NZ\$|HK\$|S\$|¥|\$|€|£|₹|₩|฿|₫|₱|₺|₪|₦|[A-Z]{3})\s*(?=\d)/i;
function currencyFromPrefix(prefix: string): string {
  if (/^(¥|CNY|RMB|CN¥)$/i.test(prefix)) return "CNY";
  if (prefix === "$" ) return "USD";
  return currencySymbols[prefix] || prefix.toUpperCase();
}
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
  if (/^销售单价(?:[a-z]{3}|cny或[a-z]{3}|cny或付款币种)?$/.test(key) || /^(?:unitprice|price)(?:[a-z]{3})?$/.test(key)) return "price";
  if (/^(数量|quantity|qty)$/.test(key)) return "quantity";
  if (key === "理货要求") return "preparation_requirement";
  if (key === "销售备注") return "internal_note";
  return null;
}

function headerCurrency(value: string) {
  const code = value.normalize("NFKC").match(/\b([A-Z]{3})\b/i)?.[1]?.toUpperCase();
  return code && QUOTE_CURRENCY_CODES.has(code) ? code : null;
}

function findHeader(rows: string[][]): { index: number; columns: Columns; priceCurrency: string | null; cnyPriceColumn?: number; paymentPriceColumn?: number } | null {
  for (let index = 0; index < Math.min(rows.length, 60); index++) {
    const columns: Columns = {};
    rows[index].forEach((value, column) => { const field = fieldFor(value); if (field && columns[field] === undefined) columns[field] = column; });
    if (["item_name", "brand", "model", "quality", "price", "quantity"].every((field) => columns[field as Field] !== undefined)) {
      const priceHeading = rows[index][columns.price!].normalize("NFKC");
      const explicit = headerCurrency(priceHeading);
      const dual = /CNY\s*或\s*[A-Z]{3}|CNY\s*或\s*付款币种/i.test(priceHeading);
      const priceColumns = rows[index].map((value, column) => fieldFor(value) === "price" ? { column, currency: headerCurrency(value) } : null).filter((value): value is { column: number; currency: string | null } => Boolean(value));
      const cnyPriceColumn = priceColumns.find((value) => value.currency === "CNY")?.column;
      const paymentPriceColumn = priceColumns.find((value) => value.currency && value.currency !== "CNY")?.column;
      return { index, columns, priceCurrency: dual ? "CNY" : explicit || (/unit\s*price/i.test(priceHeading) ? null : "CNY"), cnyPriceColumn, paymentPriceColumn };
    }
  }
  return null;
}

export function hasPiProductHeader(rows: unknown[][]): boolean {
  return findHeader(rows.map((row) => row.map(text))) !== null;
}

/** Parse Excel-style TSV, preserving quoted tabs/newlines inside a cell. */
export function parsePiClipboardTsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index++; }
      else if (quoted) quoted = false;
      else if (!field) quoted = true;
      else field += character;
      continue;
    }
    if (quoted) {
      if (character === "\r" && source[index + 1] === "\n") { field += "\n"; index++; }
      else field += character;
      continue;
    }
    if (character === "\t") { row.push(field); field = ""; continue; }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index++;
      row.push(field); rows.push(row); row = []; field = ""; continue;
    }
    field += character;
  }
  if (quoted) throw new Error("剪贴板表格引号未闭合，请重新复制产品明细区域后重试");
  if (field || row.length || source.endsWith("\t")) { row.push(field); rows.push(row); }
  return rows.filter((values) => values.some((value) => value.trim()));
}

/** Prefer the PI's explicit PAYMENT/METHOD field; otherwise use a unique price prefix. */
export function detectPiPaymentCurrency(rows: unknown[][]): string | null {
  const cells = rows.map((row) => row.map(text));
  for (const row of cells.slice(0, 60)) {
    const labelIndex = row.findIndex((value) => /PAYMENT\s*\/?\s*METHOD\s*[:：]?/i.test(value));
    if (labelIndex < 0) continue;
    const inline = row[labelIndex].match(/PAYMENT\s*\/?\s*METHOD\s*[:：]?\s*([A-Z]{3})\b/i)?.[1];
    const rawCandidate = (inline || row.slice(labelIndex + 1).find((value) => /^[A-Z]{3}$/i.test(value)) || "").toUpperCase();
    const candidate = rawCandidate === "RMB" ? "CNY" : rawCandidate;
    if (!QUOTE_CURRENCY_CODES.has(candidate)) throw new Error(`PAYMENT/METHOD 的币种 ${candidate || "为空"} 不受系统支持，请填写有效的三位币种代码`);
    return candidate;
  }
  const header = findHeader(cells);
  if (!header) {
    // A copied product block often has no header or PAYMENT/METHOD row.
    const quoted = new Set<string>();
    for (const row of cells) {
      if (row.length < 7 || !row.some((cell) => /^\d+$/.test(cell))) continue;
      for (const value of row) {
        const prefix = value.normalize("NFKC").match(moneyPrefix)?.[1];
        if (prefix) quoted.add(currencyFromPrefix(prefix));
      }
    }
    const foreign = [...quoted].filter((code) => code !== "CNY");
    if (foreign.length > 1) throw new Error(`产品单价混用 ${foreign.join("、")}，每张PI只能选择一种外币`);
    return foreign[0] || (quoted.has("CNY") ? "CNY" : null);
  }
  const headingCode = header.paymentPriceColumn === undefined ? null : headerCurrency(cells[header.index][header.paymentPriceColumn]);
  if (headingCode) return headingCode;
  const quoted = new Set<string>();
  for (const row of cells.slice(header.index + 1, header.index + 501)) {
    const price = row[header.columns.price ?? -1] || "";
    const prefix = price.normalize("NFKC").match(moneyPrefix)?.[1];
    if (prefix) quoted.add(currencyFromPrefix(prefix));
  }
  const foreign = [...quoted].filter((code) => code !== "CNY");
  if (foreign.length > 1) throw new Error(`产品单价混用 ${foreign.join("、")}，每张PI只能选择一种外币`);
  return foreign[0] || (quoted.has("CNY") ? "CNY" : null);
}

/** A dual-quoted PI supplies the transaction rate itself: CNY unit price / foreign unit price. */
export function derivePiCnyRate(rows: unknown[][], paymentCurrency: string): number | null {
  if (paymentCurrency === "CNY") return null;
  const cells = rows.map((row) => row.map(text));
  const header = findHeader(cells);
  const inferred = !header ? inferHeaderlessDualColumns(cells, paymentCurrency) : null;
  const cnyPriceColumn = header?.cnyPriceColumn ?? inferred?.cnyPriceColumn;
  const paymentPriceColumn = header?.paymentPriceColumn ?? inferred?.paymentPriceColumn;
  if (cnyPriceColumn === undefined || paymentPriceColumn === undefined) return null;
  const headingCode = header ? headerCurrency(cells[header.index][paymentPriceColumn]) : paymentCurrency;
  if (headingCode !== paymentCurrency) throw new Error(`产品外币单价列为 ${headingCode || "未知币种"}，与付款币种 ${paymentCurrency} 不一致`);
  const quotes: Array<{ row: number; cny: number; payment: number }> = [];
  const firstDataIndex = header ? header.index + 1 : cells.findIndex((row) => row.some(Boolean));
  for (let index = firstDataIndex; index < cells.length && quotes.length < 500; index++) {
    const row = cells[index];
    if (row.some((value) => /^(?:SUBTOTAL|小计|TOTAL|合计)\s*[:：]?$/i.test(value))) break;
    const cnyText = row[cnyPriceColumn] || "";
    const paymentText = row[paymentPriceColumn] || "";
    if (!cnyText && !paymentText) continue;
    // Incomplete rows are still imported for in-form completion; derive the
    // document rate only from rows that provide both unit-price currencies.
    if (!cnyText || !paymentText) continue;
    const cny = moneyToken(cnyText, index + 1, "人民币单价", "CNY");
    const payment = moneyToken(paymentText, index + 1, "外币单价", paymentCurrency);
    if (cny.currency !== "CNY" || payment.currency !== paymentCurrency || cny.amount <= 0 || payment.amount <= 0) throw new Error(`第${index + 1}行双币种单价币种或金额不正确`);
    quotes.push({ row: index + 1, cny: cny.amount, payment: payment.amount });
  }
  if (!quotes.length) return null;
  const rate = Math.round((quotes[0].cny / quotes[0].payment) * 100) / 100;
  const inconsistent = quotes.find(({ cny, payment }) => {
    const lineRate = Math.round((cny / payment) * 100) / 100;
    return lineRate !== rate || Math.abs(cny - roundMoney(payment * rate)) > Math.max(0.02, payment * 0.005 + 0.005);
  });
  if (inconsistent) throw new Error(`第${inconsistent.row}行双币种单价与首行反推汇率 ${rate} 不一致，请核对该行价格或汇率后重新导入`);
  return rate;
}

function moneyToken(value: string, row: number, field: string, defaultCurrency: string) {
  const match = value.normalize("NFKC").match(/^(AU\$|US\$|CA\$|CN¥|JP¥|R\$|C\$|A\$|NZ\$|HK\$|S\$|¥|\$|€|£|₹|₩|฿|₫|₱|₺|₪|₦|[A-Z]{3})?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)$/i);
  if (!match) throw new Error(`第${row}行${field}须填写金额，最多两位小数；可用 ¥、$ 或币种代码标明币种`);
  const currency = !match[1] ? defaultCurrency : currencyFromPrefix(match[1]);
  if (!QUOTE_CURRENCY_CODES.has(currency)) throw new Error(`第${row}行${field}币种 ${currency} 不受系统支持`);
  const amount = Number(match[2].replaceAll(",", ""));
  if (!Number.isFinite(amount) || amount > 999999999999) throw new Error(`第${row}行${field}超出允许范围`);
  return { currency, amount };
}

/** Infer a headerless dual-price PI table (unit prices + optional amount columns). */
function inferHeaderlessDualColumns(rows: string[][], paymentCurrency: string) {
  for (const row of rows) {
    const tagged = row.map((value, column) => {
      const prefix = value.normalize("NFKC").match(moneyPrefix)?.[1];
      return prefix ? { column, currency: currencyFromPrefix(prefix) } : null;
    }).filter((value): value is { column: number; currency: string } => Boolean(value));
    const pairs = tagged.flatMap((foreignUnit) => foreignUnit.currency === paymentCurrency
      ? tagged.filter((cnyUnit) => cnyUnit.currency === "CNY" && cnyUnit.column !== foreignUnit.column)
        .map((cnyUnit) => ({ cnyUnit, foreignUnit, end: Math.max(cnyUnit.column, foreignUnit.column) }))
      : []);
    let selected: { cnyUnit: typeof tagged[number]; foreignUnit: typeof tagged[number]; quantityColumn: number; costColumn: number } | null = null;
    for (const pair of pairs.sort((left, right) => left.end - right.end)) {
      const nextMoneyColumn = tagged.filter((value) => value.column > pair.end).reduce((minimum, value) => Math.min(minimum, value.column), Number.POSITIVE_INFINITY);
      const quantityColumn = row.findIndex((value, column) => column > pair.end && column < nextMoneyColumn && validPiQuantity(value));
      if (quantityColumn < 0) continue;
      const costColumn = tagged.filter((value) => value.currency === "CNY" && value.column > quantityColumn).at(-1)?.column;
      if (costColumn === undefined) continue;
      selected = { ...pair, quantityColumn, costColumn };
      break;
    }
    if (!selected) continue;
    return {
      columns: { item_name: 0, brand: 1, model: 2, quality: 3, description: 4, price: selected.foreignUnit.column, quantity: selected.quantityColumn, cost: selected.costColumn } satisfies Columns,
      cnyPriceColumn: selected.cnyUnit.column,
      paymentPriceColumn: selected.foreignUnit.column,
    };
  }
  return null;
}

/** Infer a compact no-header layout with one tagged unit-price column. */
function inferHeaderlessSingleColumns(rows: string[][], paymentCurrency: string) {
  for (const row of rows) {
    const tagged = row.map((value, column) => {
      const prefix = value.normalize("NFKC").match(moneyPrefix)?.[1];
      return prefix ? { column, currency: currencyFromPrefix(prefix) } : null;
    }).filter((value): value is { column: number; currency: string } => Boolean(value));
    const candidates = tagged.filter((value) => value.currency === paymentCurrency);
    for (const price of candidates) {
      const nextMoneyColumn = tagged.filter((value) => value.column > price.column).reduce((minimum, value) => Math.min(minimum, value.column), Number.POSITIVE_INFINITY);
      const quantityColumn = row.findIndex((value, column) => column > price.column && column < nextMoneyColumn && validPiQuantity(value));
      if (quantityColumn < 0) continue;
      const precedingCost = tagged.filter((value) => value.currency !== paymentCurrency && value.column < price.column).at(-1)
        || tagged.filter((value) => value.column < price.column).at(-1);
      const trailingCost = tagged.filter((value) => value.currency === "CNY" && value.column > quantityColumn).at(-1);
      return {
        columns: { item_name: 0, brand: 1, model: 2, quality: 3, description: 4, price: price.column, quantity: quantityColumn, cost: (precedingCost || trailingCost)?.column } satisfies Columns,
        paymentPriceColumn: price.column,
      };
    }
  }
  return null;
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
  const numberedPiSource = !recognized && /^\d+$/.test(first[0] || "") && first.length >= 12;
  const detectedCurrency = !recognized ? detectPiPaymentCurrency(cells) : null;
  const inferredDual = !recognized && !numberedPiSource ? inferHeaderlessDualColumns(cells.slice(firstIndex), detectedCurrency || paymentCurrency) : null;
  const inferredSingle = !recognized && !numberedPiSource && !inferredDual ? inferHeaderlessSingleColumns(cells.slice(firstIndex), detectedCurrency || paymentCurrency) : null;
  if ((inferredDual || inferredSingle) && detectedCurrency && detectedCurrency !== paymentCurrency) {
    throw new Error(`第${firstIndex + 1}行价格币种与PI付款币种 ${paymentCurrency} 不一致，请选择正确付款币种或改填人民币价格`);
  }
  const oldLegacy = !recognized && first[0] === "产品名称";
  const oldWide = !recognized && (oldLegacy || first.length >= 14);
  const piSource = !recognized && !oldWide && numberedPiSource;
  const piSourceWithoutNumber = !recognized && !oldWide && !piSource && first.length >= 11 && Boolean(first[2]) && Boolean(first[7]);
  let columns: Columns;
  if (recognized) columns = recognized.columns;
  else if (inferredDual) columns = inferredDual.columns;
  else if (inferredSingle) columns = inferredSingle.columns;
  else if (piSource) columns = { item_name: 1, brand: 3, model: 4, quality: 5, description: 6, price: 8, quantity: 9, cost: 11 };
  else if (piSourceWithoutNumber) columns = { item_name: 0, brand: 2, model: 3, quality: 4, description: 5, price: 7, quantity: 8, cost: 10 };
  else if (oldLegacy) columns = { item_name: 0, brand: 1, model: 2, quality: 3, description: 4, description_zh: 5, quantity: 6, price: 7, cost: 8, preparation_requirement: 9 };
  else if (oldWide) columns = { item_name: 0, brand: 1, model: 2, quality: 3, description: 4, description_zh: 5, cost: 6, price: 7, quantity: 8, preparation_requirement: 12, internal_note: 13 };
  else columns = { item_name: 0, brand: 1, model: 2, quality: 3, description: 4, cost: 5, price: 6, quantity: 7 };
  if (columns.cost === undefined && !inferredSingle && !inferredDual) throw new Error("产品表缺少成本单价列，请补齐后导入");
  const start = recognized ? recognized.index + 1 : oldLegacy ? firstIndex + 1 : firstIndex;
  const imported: ParsedPiProductLine[] = [];
  for (let index = start; index < cells.length; index++) {
    const row = cells[index];
    if (row.some((value) => /^(?:SUBTOTAL|小计|TOTAL|合计)\s*[:：]?$/i.test(value))) break;
    const read = (field: Field) => text(row[columns[field] ?? -1]);
    const item_name = read("item_name"), brand = read("brand"), model = read("model"), quality = read("quality");
    const paymentPriceColumn = recognized?.paymentPriceColumn ?? inferredDual?.paymentPriceColumn ?? inferredSingle?.paymentPriceColumn;
    const costText = read("cost"), priceText = paymentPriceColumn !== undefined ? text(row[paymentPriceColumn]) : read("price"), quantityText = read("quantity");
    if (![item_name, brand, model, quality, read("description"), costText, priceText, quantityText].some(Boolean)) continue;
    const sourceRow = index + 1;
    if (quantityText && !validPiQuantity(quantityText)) throw new Error(`第${sourceRow}行数量须填写正整数`);
    const cost = costText ? moneyToken(costText, sourceRow, "成本单价", "CNY") : null;
    const price = priceText ? moneyToken(priceText, sourceRow, "销售单价", recognized?.priceCurrency ?? (recognized ? paymentCurrency : "CNY")) : null;
    if ((cost && cost.currency !== "CNY" && cost.currency !== paymentCurrency) || (price && price.currency !== "CNY" && price.currency !== paymentCurrency)) {
      throw new Error(`第${sourceRow}行价格币种与PI付款币种 ${paymentCurrency} 不一致，请选择正确付款币种或改填人民币价格`);
    }
    const costCny = cost ? roundMoney(cost.currency !== "CNY" ? cost.amount / paymentPerCny : cost.amount) : null;
    const cnyPriceColumn = recognized?.cnyPriceColumn ?? inferredDual?.cnyPriceColumn;
    const pairedCnyText = cnyPriceColumn !== undefined && paymentPriceColumn !== undefined ? text(row[cnyPriceColumn]) : "";
    const pairedCny = pairedCnyText ? moneyToken(pairedCnyText, sourceRow, "人民币单价", "CNY") : null;
    if (pairedCny && pairedCny.currency !== "CNY") throw new Error(`第${sourceRow}行人民币单价须填写 CNY 金额`);
    if (pairedCny && price && Math.abs(pairedCny.amount - roundMoney(price.amount / paymentPerCny)) > 0.02) throw new Error(`第${sourceRow}行双币种单价与本单汇率不一致，请核对后导入`);
    const priceCny = pairedCny ? pairedCny.amount : price ? roundMoney(price.currency !== "CNY" ? price.amount / paymentPerCny : price.amount) : null;
    const pricePayment = price && priceCny !== null ? price.currency !== "CNY" ? price.amount : roundMoney(priceCny * paymentPerCny) : null;
    if ((costCny !== null && !validPiMoney(String(costCny))) || (priceCny !== null && !validPiMoney(String(priceCny))) || (pricePayment !== null && !validPiMoney(String(pricePayment))) || (costCny !== null && priceCny !== null && !validPiSellingPrice(String(priceCny), String(costCny)))) {
      throw new Error(`第${sourceRow}行售价或成本金额格式不正确，或超出允许范围`);
    }
    imported.push({ source_row: sourceRow, item_name, brand, model, quality, description: read("description"), description_zh: read("description_zh"),
      quantity: quantityText, unit_price_cny: priceCny === null ? "" : priceCny.toFixed(2), unit_price_payment: pricePayment === null ? "" : pricePayment.toFixed(2),
      unit_price_source: price && price.currency !== "CNY" ? "PAYMENT" : "CNY", estimated_unit_cost_cny: costCny === null ? "" : costCny.toFixed(2),
      preparation_requirement: read("preparation_requirement"), internal_note: read("internal_note") });
    if (imported.length > 500) throw new Error("每张PI最多导入500条产品明细");
  }
  if (!imported.length) throw new Error("请导入1至500条产品明细");
  return imported;
}
