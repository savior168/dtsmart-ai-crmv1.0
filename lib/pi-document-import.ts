import * as XLSX from "xlsx";
import { QUOTE_CURRENCY_CODES } from "./currencies.ts";

export type ImportedPiItem = {
  item_name: string;
  brand: string;
  model: string;
  quality: string;
  description: string;
  quantity: number;
  unit_price_payment: number;
  amount_payment: number;
  description_zh?: string;
  estimated_unit_cost_cny?: number;
  unit_price_cny?: number;
  preparation_requirement?: string;
  internal_note?: string;
};

export type ImportedPiDocument = {
  warehouse_reference_number: string;
  currency: string;
  payment_method: string;
  delivery_date: string;
  delivery_recipient: string;
  delivery_phone: string;
  delivery_company: string;
  delivery_email: string;
  delivery_address: string;
  payment_account_id?: string | null;
  items: ImportedPiItem[];
  subtotal_payment: number;
  shipping_payment: number;
  total_payment: number;
  source_kind?: "SYSTEM_TEMPLATE";
  customer_name?: string;
  fx_rate_cny_per_payment?: number;
  valid_until?: string;
  shipping_cny?: number;
  last_balance_cny?: number;
  discount_cny?: number;
  other_cny?: number;
  paypal_rate_percent?: number;
  show_dual_currency_prices?: boolean;
  stocking_requirements?: string;
};

const cellText = (sheet: XLSX.WorkSheet, address: string) => String(sheet[address]?.v ?? "").trim();
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const afterLabel = (value: string) => value.replace(/^[^:：]*[:：]\s*/, "").trim();
const normalizePaymentInstructions = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase();

export function matchImportedPaymentAccount(sourceInstructions: string, accounts: Array<{ id: string; currency: string; instructions: string }>, currency: string) {
  const normalized = normalizePaymentInstructions(sourceInstructions);
  if (!normalized) return "";
  const matches = accounts.filter((account) => account.currency === currency && normalizePaymentInstructions(account.instructions) === normalized);
  return matches.length === 1 ? matches[0].id : "";
}
function dateValue(value: unknown, date1904 = false) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 1 || value > 2958465) return "";
    const date = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + Math.floor(value) * 86400000);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return "";
  const normalized = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized ? "" : normalized;
}

function templateMoney(value: unknown, label: string, allowZero = true) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(`${label}须为非负且最多两位小数的金额`);
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount > 999999999999 || (!allowZero && amount <= 0)) throw new Error(`${label}金额超出允许范围`);
  return amount;
}

function parseSystemPiWorkbook(workbook: XLSX.WorkBook) {
  const basic = workbook.Sheets["PI基本信息"];
  const lines = workbook.Sheets["PI产品明细"];
  if (!basic || !lines || cellText(basic, "A1") !== "PI整单导入模板" || !cellText(lines, "A1").startsWith("产品类型")) {
    throw new Error("PI整单模板结构已改变，请重新下载模板填写");
  }
  const read = (row: number) => cellText(basic, `B${row}`);
  const required = (row: number, label: string) => {
    const result = read(row);
    if (!result) throw new Error(`${label}不能为空`);
    return result;
  };
  const customer_name = required(3, "客户名称");
  const delivery_company = required(4, "公司名称");
  const warehouse_reference_number = required(5, "PI订单编号");
  if (warehouse_reference_number.length > 80) throw new Error("PI订单编号不能超过80字");
  const currency = required(6, "客户付款币种").toUpperCase();
  if (!QUOTE_CURRENCY_CODES.has(currency)) throw new Error("客户付款币种不受系统支持");
  const rawRate = read(7);
  const fx_rate_cny_per_payment = rawRate ? Number(rawRate) : 0;
  if (rawRate && (!Number.isFinite(fx_rate_cny_per_payment) || fx_rate_cny_per_payment <= 0 || fx_rate_cny_per_payment > 100000000)) throw new Error("汇率须为正数");
  const date = (row: number, label: string) => {
    const raw = basic[`B${row}`]?.v;
    if (raw === undefined || raw === null || raw === "") return "";
    const parsed = dateValue(raw, workbook.Workbook?.WBProps?.date1904 === true);
    if (!parsed) throw new Error(`${label}须为有效日期 YYYY-MM-DD`);
    return parsed;
  };
  const valid_until = date(8, "PI有效期");
  const delivery_date = date(9, "预计交付日期");
  const delivery_recipient = required(11, "收件人");
  const delivery_phone = required(12, "电话");
  const delivery_email = required(13, "邮箱");
  const delivery_address = required(14, "收货地址");
  if (delivery_recipient.length > 200 || delivery_phone.length > 100 || delivery_email.length > 200 || delivery_address.length > 1000 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(delivery_email)) throw new Error("收货信息长度或邮箱格式不正确");
  const fee = (row: number, label: string) => read(row) ? templateMoney(read(row), label) : 0;
  const shipping_cny = fee(15, "运费");
  const last_balance_cny = fee(16, "未付尾款");
  const discount_cny = fee(17, "折扣");
  const other_cny = fee(18, "其他费用");
  const paypal_rate_percent = read(19) ? Number(read(19)) : 0;
  if (!Number.isFinite(paypal_rate_percent) || paypal_rate_percent < 0 || paypal_rate_percent > 100 || !/^\d+(?:\.\d{1,4})?$/.test(read(19) || "0")) throw new Error("PayPal手续费率须在0%至100%之间，最多四位小数");
  const dual = read(20) || "否";
  if (!["是", "否"].includes(dual)) throw new Error("双币种展示须填写 是 或 否");
  const items: ImportedPiItem[] = [];
  for (let row = 2; row <= 501; row += 1) {
    const fields = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "N", "O"].map((column) => cellText(lines, `${column}${row}`));
    if (!fields.some(Boolean)) continue;
    const [item_name, brand, model, quality, description, description_zh, costText, priceText, quantityText, preparation_requirement, internal_note] = fields;
    if (![item_name, brand, model, quality, costText, priceText, quantityText].every(Boolean)) throw new Error(`产品明细第${row}行缺少红色 * 必填项`);
    const estimated_unit_cost_cny = templateMoney(costText, `产品明细第${row}行成本`);
    const unit_price_cny = templateMoney(priceText, `产品明细第${row}行售价`, false);
    const quantity = Number(quantityText);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error(`产品明细第${row}行数量须为正整数`);
    if (unit_price_cny <= estimated_unit_cost_cny) throw new Error(`产品明细第${row}行售价须高于成本`);
    if ([item_name, brand, model, quality].some((value) => value.length > 160) || description.length > 1000 || description_zh.length > 1000 || preparation_requirement.length > 1000 || internal_note.length > 1000) throw new Error(`产品明细第${row}行文本超出长度限制`);
    const unit_price_payment = fx_rate_cny_per_payment ? money(unit_price_cny / fx_rate_cny_per_payment) : 0;
    items.push({ item_name, brand, model, quality, description, description_zh, quantity, estimated_unit_cost_cny, unit_price_cny, unit_price_payment, amount_payment: money(unit_price_payment * quantity), preparation_requirement, internal_note });
  }
  if (!items.length) throw new Error("PI产品明细至少填写一行");
  const subtotal_payment = money(items.reduce((sum, item) => sum + item.amount_payment, 0));
  const shipping_payment = fx_rate_cny_per_payment ? money(shipping_cny / fx_rate_cny_per_payment) : 0;
  return { sheet_name: "PI基本信息", payment_account_instructions: "", document: {
    source_kind: "SYSTEM_TEMPLATE" as const, customer_name, delivery_company, warehouse_reference_number, currency,
    fx_rate_cny_per_payment, valid_until, delivery_date, payment_method: read(10), delivery_recipient,
    delivery_phone, delivery_email, delivery_address, shipping_cny, shipping_payment,
    last_balance_cny, discount_cny, other_cny, paypal_rate_percent,
    show_dual_currency_prices: dual === "是", stocking_requirements: read(21), items,
    subtotal_payment, total_payment: money(subtotal_payment + shipping_payment),
  } satisfies ImportedPiDocument };
}

/** Parse only the customer-facing PI layout; internal RMB and account data are never inferred. */
export function parseCustomerPiWorkbook(bytes: Uint8Array) {
  if (bytes.byteLength < 100 || bytes.byteLength > 2 * 1024 * 1024) throw new Error("PI文件大小须在2MB以内");
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false, cellFormula: true });
  if (workbook.SheetNames.includes("PI基本信息") || workbook.SheetNames.includes("PI产品明细")) return parseSystemPiWorkbook(workbook);
  const sheetName = workbook.SheetNames.find((name) => {
    const sheet = workbook.Sheets[name];
    return /COMMERCIAL INVOICE/i.test(cellText(sheet, "G2")) && /^no\.?$/i.test(cellText(sheet, "A18"));
  });
  if (!sheetName) throw new Error("未找到与客户PI模板一致的工作表，请检查COMMERCIAL INVOICE及产品表头");
  const sheet = workbook.Sheets[sheetName];
  const warehouse_reference_number = cellText(sheet, "J2");
  if (!warehouse_reference_number || warehouse_reference_number.length > 80) throw new Error("PI订单编号不能为空且不得超过80字");
  // J6 is the explicit import currency; formula-cached header text may be stale until Excel recalculates.
  const currencyCandidates = [cellText(sheet, "J6"), cellText(sheet, "G6").match(/\(([A-Z]{3})\)/)?.[1], cellText(sheet, "I18").match(/\(([A-Z]{3})\)/)?.[1]];
  const currency = currencyCandidates.find((value) => value && QUOTE_CURRENCY_CODES.has(value)) || "";
  if (!currency) throw new Error("无法识别客户付款币种，请在PI模板中填写有效币种代码");
  const paymentText = cellText(sheet, "J6");
  const paymentMethod = paymentText === currency ? "" : paymentText.replace(new RegExp(`\\s*\\(${currency}\\)\\s*$`, "i"), "").trim();
  const items: ImportedPiItem[] = [];
  let subtotalRow = 0;
  for (let row = 19; row <= 518; row += 1) {
    if (/SUBTOTAL/i.test(cellText(sheet, `G${row}`))) { subtotalRow = row; break; }
    const name = cellText(sheet, `B${row}`);
    const brand = cellText(sheet, `D${row}`);
    const model = cellText(sheet, `E${row}`);
    const quality = cellText(sheet, `F${row}`);
    const description = cellText(sheet, `G${row}`);
    const priceValue = sheet[`I${row}`]?.v;
    const quantityValue = sheet[`J${row}`]?.v;
    if (![name, brand, model, quality, description, priceValue, quantityValue].some((value) => String(value ?? "").trim())) continue;
    const quantity = Number(quantityValue);
    const price = Number(priceValue);
    if (!name || !brand || !model || !quality || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0 || price !== money(price)) {
      throw new Error(`客户PI第${row}行缺少产品、品牌、型号、质量，或外币单价/整数数量不正确`);
    }
    const amount = money(price * quantity);
    const shownAmount = sheet[`K${row}`]?.v;
    if (!sheet[`K${row}`]?.f && shownAmount !== undefined && shownAmount !== null && String(shownAmount).trim() && Math.abs(Number(shownAmount) - amount) > 0.01) {
      throw new Error(`客户PI第${row}行金额与单价×数量不符`);
    }
    items.push({ item_name: name.slice(0, 160), brand: brand.slice(0, 120), model: model.slice(0, 160), quality: quality.slice(0, 160),
      description: description.slice(0, 1000), quantity, unit_price_payment: price, amount_payment: amount });
    if (items.length > 500) throw new Error("每张PI最多导入500条产品");
  }
  if (!subtotalRow || !items.length) throw new Error("客户PI缺少产品明细或小计行，无法生成待补全草稿");
  const subtotal_payment = money(items.reduce((sum, item) => sum + item.amount_payment, 0));
  const shownSubtotal = sheet[`K${subtotalRow}`]?.v;
  if (!sheet[`K${subtotalRow}`]?.f && shownSubtotal !== undefined && shownSubtotal !== null && String(shownSubtotal).trim() && Math.abs(Number(shownSubtotal) - subtotal_payment) > 0.01) {
    throw new Error("客户PI产品小计与明细不一致");
  }
  const deliveryValue = (row: number, label: string) => {
    const combined = cellText(sheet, `A${row}`);
    return new RegExp(`^${label}\\s*[:：]`, "i").test(combined) && afterLabel(combined) ? afterLabel(combined) : cellText(sheet, `D${row}`);
  };
  const shippingRow = subtotalRow + 1;
  const shipping_payment = Number(sheet[`K${shippingRow}`]?.v || 0);
  if (!Number.isFinite(shipping_payment) || shipping_payment < 0) throw new Error("客户PI运费不正确");
  return { sheet_name: sheetName, payment_account_instructions: cellText(sheet, "A32"), document: {
    warehouse_reference_number, currency, payment_method: paymentMethod,
    delivery_date: dateValue(sheet.J8?.v, workbook.Workbook?.WBProps?.date1904 === true), delivery_recipient: deliveryValue(13, "To"),
    delivery_phone: deliveryValue(14, "TEL"), delivery_company: deliveryValue(15, "Company"),
    delivery_email: deliveryValue(16, "Email"), delivery_address: afterLabel(cellText(sheet, "G13")),
    items, subtotal_payment, shipping_payment: money(shipping_payment), total_payment: money(subtotal_payment + shipping_payment),
  } satisfies ImportedPiDocument };
}
