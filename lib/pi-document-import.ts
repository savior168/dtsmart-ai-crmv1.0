import * as XLSX from "xlsx";
import { QUOTE_CURRENCY_CODES } from "./currencies.ts";
import { parsePiProductRows } from "./pi-product-import.ts";
import { calculatePiFees } from "./pi-fees.ts";

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
  customer_tax_number?: string;
  sales_account_email?: string;
  seller_contact_name?: string;
  seller_contact_phone?: string;
  seller_contact_email?: string;
  fx_rate_cny_per_payment?: number;
  valid_until?: string;
  shipping_cny?: number;
  shipping_source?: "CNY" | "PAYMENT";
  last_balance_cny?: number;
  last_balance_payment?: number;
  last_balance_source?: "CNY" | "PAYMENT";
  discount_cny?: number;
  discount_payment?: number;
  discount_source?: "CNY" | "PAYMENT";
  other_cny?: number;
  other_payment?: number;
  other_source?: "CNY" | "PAYMENT";
  paypal_rate_percent?: number;
  show_dual_currency_prices?: boolean;
  stocking_requirements?: string;
};

const cellText = (sheet: XLSX.WorkSheet, address: string) => String(sheet[address]?.v ?? "").trim();
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const afterLabel = (value: string) => value.replace(/^[^:：]*[:：]\s*/, "").trim();
const normalizePaymentInstructions = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase();

export function matchImportedPaymentAccount(sourceInstructions: string, accounts: Array<{ id: string; currency: string; instructions: string; payment_channel?: string }>, currency: string, paymentMethod = "") {
  const normalized = normalizePaymentInstructions(sourceInstructions);
  if (!normalized) return "";
  const matches = accounts.filter((account) => account.currency === currency && (!paymentMethod || account.payment_channel === paymentMethod) && normalizePaymentInstructions(account.instructions) === normalized);
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
  const sales_account_email = read(22);
  if (sales_account_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sales_account_email)) throw new Error("所属销售员账号请填写完整登录邮箱");
  const delivery_company = read(4);
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
  const delivery_recipient = read(11);
  const delivery_phone = read(12);
  const delivery_email = read(13);
  const delivery_address = read(14);
  if (delivery_recipient.length > 200 || delivery_phone.length > 100 || delivery_email.length > 200 || delivery_address.length > 1000 || (delivery_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(delivery_email))) throw new Error("收货信息长度或邮箱格式不正确");
  const fee = (row: number, label: string) => read(row) ? templateMoney(read(row), label) : 0;
  const shipping_cny = fee(15, "运费");
  const last_balance_cny = fee(16, "未付尾款");
  const discount_cny = fee(17, "折扣");
  const other_cny = fee(18, "其他费用");
  const paypal_rate_percent = read(19) ? Number(read(19)) : 0;
  if (!Number.isFinite(paypal_rate_percent) || paypal_rate_percent < 0 || paypal_rate_percent > 100 || !/^\d+(?:\.\d{1,4})?$/.test(read(19) || "0")) throw new Error("PayPal手续费率须在0%至100%之间，最多四位小数");
  const dual = read(20) || "否";
  if (!["是", "否"].includes(dual)) throw new Error("双币种展示须填写 是 或 否");
  const legacyWholeLines = cellText(lines, "I1").startsWith("销售单价（付款币种");
  const legacyCalculatedWholeLines = !legacyWholeLines && cellText(lines, "J1") === "销售金额（CNY）";
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(lines, { header: 1, range: legacyWholeLines ? "A1:O501" : legacyCalculatedWholeLines ? "A1:N501" : "A1:K501", defval: "" });
  const rows = legacyWholeLines ? rawRows.slice(1).map((row) => [
    ...row.slice(0, 8), row[9], row[10], row[11], row[12], row[13], row[14],
  ]) : rawRows;
  const parsedLines = parsePiProductRows(rows, fx_rate_cny_per_payment ? 1 / fx_rate_cny_per_payment : 1);
  const items: ImportedPiItem[] = parsedLines.map((line, index) => {
    if ([line.item_name, line.brand, line.model, line.quality].some((value) => value.length > 160) || line.description.length > 1000 || line.description_zh.length > 1000 || line.preparation_requirement.length > 1000 || line.internal_note.length > 1000) throw new Error(`产品明细第${index + 2}行文本超出长度限制`);
    const quantity = Number(line.quantity);
    const unit_price_cny = Number(line.unit_price_cny);
    const estimated_unit_cost_cny = Number(line.estimated_unit_cost_cny);
    const unit_price_payment = fx_rate_cny_per_payment ? money(unit_price_cny / fx_rate_cny_per_payment) : 0;
    return { item_name: line.item_name, brand: line.brand, model: line.model, quality: line.quality,
      description: line.description, description_zh: line.description_zh, preparation_requirement: line.preparation_requirement,
      internal_note: line.internal_note, quantity, unit_price_cny, estimated_unit_cost_cny, unit_price_payment,
      amount_payment: money(unit_price_payment * quantity) };
  });
  const subtotal_payment = money(items.reduce((sum, item) => sum + item.amount_payment, 0));
  const subtotal_cny = money(items.reduce((sum, item) => sum + money(Number(item.unit_price_cny || 0) * item.quantity), 0));
  const fees = fx_rate_cny_per_payment ? calculatePiFees(subtotal_cny, subtotal_payment, shipping_cny,
    1 / fx_rate_cny_per_payment, read(10), {
      last_balance: { source: "CNY", amount: last_balance_cny },
      discount: { source: "CNY", amount: discount_cny },
      other: { source: "CNY", amount: other_cny },
      paypal_rate_percent,
      show_dual_currency_prices: dual === "是",
    }) : null;
  return { sheet_name: "PI基本信息", payment_account_instructions: read(23), document: {
    source_kind: "SYSTEM_TEMPLATE" as const, customer_name, sales_account_email, delivery_company, warehouse_reference_number, currency,
    fx_rate_cny_per_payment, valid_until, delivery_date, payment_method: read(10), delivery_recipient,
    delivery_phone, delivery_email, delivery_address, shipping_cny, shipping_payment: fees?.shippingPayment ?? 0,
    last_balance_cny, last_balance_payment: fees?.lastBalance.payment ?? 0,
    discount_cny, discount_payment: fees?.discount.payment ?? 0,
    other_cny, other_payment: fees?.other.payment ?? 0, paypal_rate_percent,
    show_dual_currency_prices: dual === "是", stocking_requirements: read(21), items,
    subtotal_payment, total_payment: fees?.totalPayment ?? 0,
  } satisfies ImportedPiDocument };
}

/** Parse only the customer-facing PI layout; internal RMB and account data are never inferred. */
export function parseCustomerPiWorkbook(bytes: Uint8Array): { sheet_name: string; payment_account_instructions: string; document: ImportedPiDocument } {
  if (bytes.byteLength < 100 || bytes.byteLength > 2 * 1024 * 1024) throw new Error("PI文件大小须在2MB以内");
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false, cellFormula: true });
  if (workbook.SheetNames.includes("PI基本信息") || workbook.SheetNames.includes("PI产品明细")) return parseSystemPiWorkbook(workbook);
  const sheetName = workbook.SheetNames.find((name) => {
    const sheet = workbook.Sheets[name];
    return /COMMERCIAL INVOICE/i.test(cellText(sheet, "G2") || cellText(sheet, "H2")) && /^no\.?$/i.test(cellText(sheet, "A18"));
  });
  if (!sheetName) throw new Error("未找到与客户PI模板一致的工作表，请检查COMMERCIAL INVOICE及产品表头");
  const sheet = workbook.Sheets[sheetName];
  const dualCurrencyColumns = /^Unit Price \(CNY\)(?: \*)?$/i.test(cellText(sheet, "I18")) && /^Amount \(CNY\)$/i.test(cellText(sheet, "L18"));
  const invoiceValueColumn = /COMMERCIAL INVOICE/i.test(cellText(sheet, "H2")) ? "K" : "J";
  const invoiceLabelColumn = invoiceValueColumn === "K" ? "H" : "G";
  const warehouse_reference_number = cellText(sheet, `${invoiceValueColumn}2`);
  if (!warehouse_reference_number || warehouse_reference_number.length > 80) throw new Error("PI订单编号不能为空且不得超过80字");
  // The invoice value cell is the explicit import currency; older dual-currency exports used J6.
  const explicitValue = cellText(sheet, `${invoiceValueColumn}6`);
  const explicitCurrency = (explicitValue.match(/\(([A-Z]{3})\)\s*$/i)?.[1] || explicitValue).toUpperCase();
  const sourceLayout = invoiceValueColumn === "K"
    && /^Quotation Currency/i.test(cellText(sheet, "H6"))
    && /^FX: 1 unit = CNY/i.test(cellText(sheet, "H7"));
  const isImportTemplate = sourceLayout || cellText(sheet, `${invoiceLabelColumn}6`).includes("客户付款币种");
  if (isImportTemplate && explicitValue.toUpperCase() !== explicitCurrency) throw new Error("客户付款币种须填写币种代码，请从下拉列表选择");
  if (isImportTemplate && !explicitCurrency) throw new Error("客户付款币种为必填项，请在模板中选择币种");
  if (isImportTemplate && !QUOTE_CURRENCY_CODES.has(explicitCurrency)) throw new Error("客户付款币种不受系统支持，请从模板下拉列表选择");
  const currencyCandidates = [explicitCurrency, cellText(sheet, `${invoiceLabelColumn}6`).match(/\(([A-Z]{3})\)/)?.[1], cellText(sheet, dualCurrencyColumns ? "J18" : "I18").match(/\(([A-Z]{3})\)/)?.[1]];
  const currency = currencyCandidates.find((value) => value && QUOTE_CURRENCY_CODES.has(value)) || "";
  if (!currency) throw new Error("无法识别客户付款币种，请在PI模板中填写有效币种代码");
  let fx_rate_cny_per_payment = 0;
  if (isImportTemplate) {
    const rawRate = cellText(sheet, sourceLayout ? "K7" : "J7");
    if (!/^\d+(?:\.\d{1,8})?$/.test(rawRate)) throw new Error("人民币兑付款币种汇率为必填项，最多填写8位小数");
    fx_rate_cny_per_payment = Number(rawRate);
    if (!Number.isFinite(fx_rate_cny_per_payment) || fx_rate_cny_per_payment <= 0 || fx_rate_cny_per_payment > 100000000) throw new Error("人民币兑付款币种汇率须为大于0的有效数字");
    if (currency === "CNY" && fx_rate_cny_per_payment !== 1) throw new Error("客户付款币种为CNY时，汇率必须为1");
  }
  const paymentText = cellText(sheet, `${invoiceValueColumn}6`);
  const paymentMethod = isImportTemplate
    ? cellText(sheet, sourceLayout ? "K9" : "J8")
    : paymentText === currency ? "" : paymentText.replace(new RegExp(`\\s*\\(${currency}\\)\\s*$`, "i"), "").trim();
  if (isImportTemplate && paymentMethod && !["T/T Bank Transfer", "Alipay", "PayPal", "Wise Transfer", "Payoneer Transfer"].includes(paymentMethod)) {
    throw new Error("付款渠道不受系统支持，请从模板下拉列表选择");
  }
  const items: ImportedPiItem[] = [];
  let subtotalRow = 0;
  for (let row = 19; row <= 518; row += 1) {
    if (/SUBTOTAL/i.test(cellText(sheet, `G${row}`))) { subtotalRow = row; break; }
    const name = cellText(sheet, `B${row}`);
    const brand = cellText(sheet, `D${row}`);
    const model = cellText(sheet, `E${row}`);
    const quality = cellText(sheet, `F${row}`);
    const description = cellText(sheet, `G${row}`);
    const priceCell = sheet[`${dualCurrencyColumns ? "J" : "I"}${row}`];
    const priceValue = priceCell?.v;
    const quantityValue = sheet[`${dualCurrencyColumns ? "K" : "J"}${row}`]?.v;
    const cnyInputValue = dualCurrencyColumns ? sheet[`I${row}`]?.v : undefined;
    if (![name, brand, model, quality, description, priceValue, quantityValue, cnyInputValue].some((value) => String(value ?? "").trim())) continue;
    const quantity = Number(quantityValue);
    const unitPriceCnyInput = dualCurrencyColumns ? Number(cnyInputValue) : null;
    const price = isImportTemplate && dualCurrencyColumns
      ? money(unitPriceCnyInput! / fx_rate_cny_per_payment)
      : Number(priceValue);
    if (!name || !brand || !model || !quality || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0 || price !== money(price)) {
      throw new Error(`客户PI第${row}行缺少产品、品牌、型号、质量，或外币单价/整数数量不正确`);
    }
    const amount = money(price * quantity);
    const amountCell = sheet[`${dualCurrencyColumns ? "M" : "K"}${row}`];
    const shownAmount = amountCell?.v;
    if (!amountCell?.f && shownAmount !== undefined && shownAmount !== null && String(shownAmount).trim() && Math.abs(Number(shownAmount) - amount) > 0.001) {
      throw new Error(`客户PI第${row}行金额与单价×数量不符`);
    }
    const unit_price_cny = dualCurrencyColumns ? unitPriceCnyInput : isImportTemplate ? money(price * fx_rate_cny_per_payment) : null;
    const cnyAmountCell = dualCurrencyColumns ? sheet[`L${row}`] : undefined;
    const shownCnyAmount = cnyAmountCell?.v;
    if (unit_price_cny !== null && (!Number.isFinite(unit_price_cny) || unit_price_cny <= 0 || unit_price_cny !== money(unit_price_cny))) {
      throw new Error(`客户PI第${row}行人民币单价不正确`);
    }
    if (dualCurrencyColumns && unit_price_cny !== null && cnyAmountCell && !cnyAmountCell.f && shownCnyAmount !== undefined && shownCnyAmount !== null && String(shownCnyAmount).trim() && Math.abs(Number(shownCnyAmount) - money(unit_price_cny * quantity)) > 0.001) {
      throw new Error(`客户PI第${row}行人民币金额与人民币单价×数量不符`);
    }
    items.push({ item_name: name.slice(0, 160), brand: brand.slice(0, 120), model: model.slice(0, 160), quality: quality.slice(0, 160),
      description: description.slice(0, 1000), quantity, unit_price_payment: price, amount_payment: amount,
      ...(unit_price_cny !== null ? { unit_price_cny } : {}) });
    if (items.length > 500) throw new Error("每张PI最多导入500条产品");
  }
  if (!subtotalRow || !items.length) throw new Error("客户PI缺少产品明细或小计行，无法生成待补全草稿");
  const subtotal_payment = money(items.reduce((sum, item) => sum + item.amount_payment, 0));
  const subtotalCell = sheet[`${dualCurrencyColumns ? "M" : "K"}${subtotalRow}`];
  const shownSubtotal = subtotalCell?.v;
  if (!subtotalCell?.f && shownSubtotal !== undefined && shownSubtotal !== null && String(shownSubtotal).trim() && Math.abs(Number(shownSubtotal) - subtotal_payment) > 0.001) {
    throw new Error("客户PI产品小计与明细不一致");
  }
  const subtotalCny = money(items.reduce((sum, item) => sum + money((item.unit_price_cny ?? 0) * item.quantity), 0));
  const shownSubtotalCny = dualCurrencyColumns ? sheet[`L${subtotalRow}`] : undefined;
  if (shownSubtotalCny && !shownSubtotalCny.f && shownSubtotalCny.v !== undefined && shownSubtotalCny.v !== ""
    && Math.abs(Number(shownSubtotalCny.v) - subtotalCny) > 0.001) {
    throw new Error("客户PI人民币产品小计与明细不一致");
  }
  const deliveryLines = Array.from({ length: 5 }, (_, index) => cellText(sheet, `A${13 + index}`));
  const deliveryValue = (label: string) => {
    const line = deliveryLines.find((value) => new RegExp(`^${label}\\*?\\s*[:：]`, "i").test(value));
    return line ? afterLabel(line) : "";
  };
  const recipientLine = isImportTemplate && !sourceLayout ? cellText(sheet, "D15") : deliveryValue("To");
  const separateRecipientPhone = sourceLayout && /^TEL\*?\s*[:：]/i.test(cellText(sheet, "D15"));
  const recipient = (separateRecipientPhone ? recipientLine : recipientLine.split(/\s*[·•]\s*TEL\*?\s*[:：]/i)[0]).trim();
  const phone = separateRecipientPhone ? afterLabel(cellText(sheet, "D15")) : isImportTemplate
    ? recipientLine.match(/\s*(?:·|•)\s*TEL\*?\s*[:：]\s*(.*)$/i)?.[1]?.trim() || ""
    : recipientLine.match(/TEL\*?\s*[:：]\s*(.*)$/i)?.[1]?.trim() || "";
  const delivery_address = isImportTemplate && !sourceLayout ? cellText(sheet, "G14") : afterLabel(cellText(sheet, "G13"));
  const delivery_company = isImportTemplate && !sourceLayout ? cellText(sheet, "D13") : deliveryValue("Company");
  const customer_tax_number = isImportTemplate && !sourceLayout ? cellText(sheet, "D14") : deliveryValue("Tax No.");
  const delivery_email = isImportTemplate && !sourceLayout ? cellText(sheet, "D16") : deliveryValue("Email");
  if (isImportTemplate) {
    if (!dateValue(sheet[sourceLayout ? "K4" : "J4"]?.v, workbook.Workbook?.WBProps?.date1904 === true)) throw new Error("PI有效期为必填项，请填写有效日期");
    if (!recipient || !phone) throw new Error(separateRecipientPhone ? "收货人（客户）和联系电话为必填项，请分别填写To和TEL" : "收货人（客户）和联系电话为必填项，请按“To: 姓名 · TEL: 电话”格式填写");
    if (!delivery_address) throw new Error("客户收货地址为必填项");
    const salesEmail = cellText(sheet, sourceLayout ? "D10" : "J10").replace(/^\*?\s*销售员登录邮箱\s*[:：]\s*/, "").trim();
    if (salesEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(salesEmail)) throw new Error("所属销售员登录邮箱格式不正确");
    if (sourceLayout) {
      if (!salesEmail) throw new Error("所属销售员登录邮箱为必填项");
      const sellerEmail = cellText(sheet, "D9").replace(/^Email\*?\s*[:：]\s*/i, "").trim();
      if (sellerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sellerEmail)) throw new Error("销售员业务邮箱格式不正确");
    } else if (cellText(sheet, "D2").startsWith("DT-Smart Technology")) {
      const sellerName = cellText(sheet, "D7").replace(/^Sales Manager\*?\s*[:：]\s*/i, "").trim();
      const sellerPhone = cellText(sheet, "D8").replace(/^Contact No\*?\s*[:：]\s*/i, "").trim();
      const sellerEmail = cellText(sheet, "D9").replace(/^Email\*?\s*[:：]\s*/i, "").trim();
      if (!sellerName || !sellerPhone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sellerEmail) || !salesEmail) {
        throw new Error("请填写销售员姓名、业务电话、业务邮箱和所属销售员登录邮箱");
      }
    }
  }
  const amountColumn = dualCurrencyColumns ? "M" : "K";
  const amountCnyColumn = dualCurrencyColumns ? "L" : "";
  const readAmount = (row: number, column: string, label: string) => {
    const cell = sheet[`${column}${row}`];
    const raw = cell?.v;
    // Spreadsheet editors may leave stale error caches before recalculation.
    // Formula-derived fees are recomputed from entered amounts below.
    if (cell?.f && (raw === undefined || raw === null || raw === "" || !Number.isFinite(Number(raw)))) return 0;
    if (raw === undefined || raw === null || raw === "") return 0;
    const value = Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) > 999999999999 || Math.abs(value - money(value)) > 0.000001) throw new Error(`客户PI${label}金额不正确`);
    return money(value);
  };
  const inputModeSource = (feeSheet: XLSX.WorkSheet, row: number): "CNY" | "PAYMENT" | undefined => {
    const value = cellText(feeSheet, `K${row}`);
    return value === "CNY" ? "CNY" : value === "外币" ? "PAYMENT" : undefined;
  };
  let paymentAccountInstructions = "";
  let shipping_payment = 0;
  let shipping_cny = 0;
  let last_balance_payment = 0;
  let last_balance_cny = 0;
  let other_payment = 0;
  let other_cny = 0;
  let discount_payment = 0;
  let discount_cny = 0;
  let paypal_fee = 0;
  let paypal_rate_percent = 0;
  let shownTotal: number | undefined;
  const sourceFeeInputs = isImportTemplate && sourceLayout && !/^费用输入金额/.test(cellText(sheet, `N${subtotalRow}`));
  let shipping_source: "CNY" | "PAYMENT" | undefined;
  let last_balance_source: "CNY" | "PAYMENT" | undefined;
  let other_source: "CNY" | "PAYMENT" | undefined;
  let discount_source: "CNY" | "PAYMENT" | undefined;
  for (let row = subtotalRow + 1; row <= subtotalRow + 12; row += 1) {
    const label = cellText(sheet, `G${row}`).toUpperCase();
    if (/PAYMENT INFORMATION/i.test(cellText(sheet, `A${row}`))) { paymentAccountInstructions = cellText(sheet, isImportTemplate && !sourceLayout ? "A77" : `A${row + 1}`); break; }
    if (!label) continue;
    let paid = readAmount(row, amountColumn, label);
    let cny = amountCnyColumn ? readAmount(row, amountCnyColumn, label) : 0;
    if (isImportTemplate && /^(SHIPPING COST|UNPAID BALANCE|OTHER CHARGES|DISCOUNT)\s*:/.test(label)) {
      const inputMode = cellText(sheet, `K${row}`);
      const inputRaw = sourceFeeInputs ? undefined : sheet[`N${row}`]?.v;
      if (sourceFeeInputs) {
        if (inputMode && inputMode !== "CNY" && inputMode !== "外币") throw new Error(`客户PI${label}费用币种不正确`);
        const cnyCell = sheet[`L${row}`];
        const paidCell = sheet[`M${row}`];
        const hasCny = cnyCell?.v !== undefined && cnyCell?.v !== null && String(cnyCell.v).trim() !== "";
        const hasPaid = paidCell?.v !== undefined && paidCell?.v !== null && String(paidCell.v).trim() !== "";
        if ((hasCny || hasPaid) && !inputMode) throw new Error(`客户PI${label}请选择CNY或外币作为输入币种`);
        if (inputMode === "CNY" && hasPaid && !hasCny || inputMode === "外币" && hasCny && !hasPaid) throw new Error(`客户PI${label}请在所选币种对应的金额栏填写`);
        if (hasCny || hasPaid) {
          if (cny < 0 || paid < 0) throw new Error(`客户PI${label}输入金额须为非负数`);
          if (inputMode === "CNY") {
            paid = money(cny / fx_rate_cny_per_payment);
            if (hasPaid && Math.abs(readAmount(row, "M", label) - paid) > 0.001) throw new Error(`客户PI${label}双币种金额与汇率不一致`);
          } else {
            cny = money(paid * fx_rate_cny_per_payment);
            if (hasCny && Math.abs(readAmount(row, "L", label) - cny) > 0.001) throw new Error(`客户PI${label}双币种金额与汇率不一致`);
          }
        }
        if (/^DISCOUNT\s*:/.test(label)) { cny = -cny; paid = -paid; }
      } else if (inputRaw !== undefined && inputRaw !== null && String(inputRaw).trim() !== "") {
        const input = Number(inputRaw);
        if (!Number.isFinite(input) || input < 0 || input !== money(input)) throw new Error(`客户PI${label}输入金额须为非负数且最多两位小数`);
        if (inputMode !== "CNY" && inputMode !== "外币") throw new Error(`客户PI${label}请选择CNY或外币作为输入币种`);
        cny = inputMode === "CNY" ? input : money(input * fx_rate_cny_per_payment);
        paid = inputMode === "CNY" ? money(input / fx_rate_cny_per_payment) : input;
        if (/^DISCOUNT\s*:/.test(label)) { cny = -cny; paid = -paid; }
        if (sourceLayout && ((sheet[`L${row}`] && !sheet[`L${row}`]?.f && Math.abs(readAmount(row, "L", label) - cny) > 0.001)
          || (sheet[`M${row}`] && !sheet[`M${row}`]?.f && Math.abs(readAmount(row, "M", label) - paid) > 0.001))) {
          throw new Error(`客户PI${label}显示金额与费用输入不一致`);
        }
      } else if (inputMode && inputMode !== "CNY" && inputMode !== "外币") {
        throw new Error(`客户PI${label}费用币种不正确`);
      } else if (sourceLayout && (paid || cny)) {
        throw new Error(`客户PI${label}请在费用输入格填写币种和金额，不要直接覆盖自动计算结果`);
      }
    }
    if (/^SHIPPING COST\s*:/.test(label)) { shipping_payment = paid; shipping_cny = cny; shipping_source = inputModeSource(sheet, row); if (paid < 0 || cny < 0) throw new Error("客户PI运费不正确"); }
    else if (/^UNPAID BALANCE\s*:/.test(label)) { last_balance_payment = paid; last_balance_cny = cny; last_balance_source = inputModeSource(sheet, row); if (paid < 0 || cny < 0) throw new Error("客户PI未付尾款不正确"); }
    else if (/^OTHER CHARGES\s*:/.test(label)) { other_payment = paid; other_cny = cny; other_source = inputModeSource(sheet, row); if (paid < 0 || cny < 0) throw new Error("客户PI其他费用不正确"); }
    else if (/^DISCOUNT\s*:/.test(label)) { discount_payment = -paid; discount_cny = -cny; discount_source = inputModeSource(sheet, row); if (paid > 0 || cny > 0) throw new Error("客户PI折扣方向不正确"); }
    else if (/^PAYPAL FEE\s*\((\d+(?:\.\d{1,4})?)%\)\s*:/.test(label)) {
      paypal_rate_percent = Number(label.match(/\((\d+(?:\.\d{1,4})?)%\)/)?.[1]);
      if (paypal_rate_percent > 100 || paid < 0 || cny < 0) throw new Error("客户PI PayPal 手续费不正确");
      paypal_fee = paid;
    }
    else if (/^TOTAL AMOUNT\s*:/.test(label)) { shownTotal = paid; }
    else throw new Error(`客户PI含无法识别的费用项目：${label}`);
  }
  if (shownTotal === undefined) throw new Error("客户PI缺少订单总金额，无法校验费用");
  const totalCell = Array.from({ length: 12 }, (_, index) => subtotalRow + index + 1)
    .find((row) => /^TOTAL AMOUNT\s*:/i.test(cellText(sheet, `G${row}`)));
  if (isImportTemplate) {
    // With explicit fee inputs, preserve the entered CNY amount instead of
    // converting it through a rounded payment amount a second time.
    if (!sourceFeeInputs) {
      if (!sheet[`N${subtotalRow + 1}`]?.v && shipping_payment) shipping_cny = money(shipping_payment * fx_rate_cny_per_payment);
      if (!sheet[`N${subtotalRow + 2}`]?.v && last_balance_payment) last_balance_cny = money(last_balance_payment * fx_rate_cny_per_payment);
      if (!sheet[`N${subtotalRow + 3}`]?.v && other_payment) other_cny = money(other_payment * fx_rate_cny_per_payment);
      if (!sheet[`N${subtotalRow + 4}`]?.v && discount_payment) discount_cny = money(discount_payment * fx_rate_cny_per_payment);
    }
    const templatePaypalRate = sourceLayout ? Number(sheet[`K${subtotalRow + 5}`]?.v ?? 5) : 5;
    if (!Number.isFinite(templatePaypalRate) || templatePaypalRate < 0 || templatePaypalRate > 100) {
      throw new Error("PayPal 手续费比例须在0%至100%之间");
    }
    paypal_rate_percent = paymentMethod === "PayPal" ? templatePaypalRate : 0;
    paypal_fee = paymentMethod === "PayPal"
      ? money((subtotal_payment + shipping_payment + last_balance_payment + other_payment - discount_payment) * paypal_rate_percent / 100)
      : 0;
  }
  const total_payment = money(subtotal_payment + shipping_payment + last_balance_payment + other_payment - discount_payment + paypal_fee);
  if (totalCell && !sheet[`${amountColumn}${totalCell}`]?.f && Math.abs(shownTotal - total_payment) > 0.001) {
    throw new Error("客户PI订单总金额与产品和费用明细不一致");
  }
  return { sheet_name: sheetName, payment_account_instructions: paymentAccountInstructions, document: {
    warehouse_reference_number, currency, payment_method: paymentMethod, customer_name: recipient,
    delivery_date: isImportTemplate ? dateValue(sheet[sourceLayout ? "K8" : "J9"]?.v, workbook.Workbook?.WBProps?.date1904 === true) : dateValue(sheet[`${invoiceValueColumn}8`]?.v, workbook.Workbook?.WBProps?.date1904 === true), delivery_recipient: recipient,
    delivery_phone: phone, delivery_company, customer_tax_number,
    delivery_email, delivery_address,
    items, subtotal_payment, shipping_payment, shipping_cny: dualCurrencyColumns ? shipping_cny : undefined,
    last_balance_payment, last_balance_cny: dualCurrencyColumns ? last_balance_cny : undefined,
    other_payment, other_cny: dualCurrencyColumns ? other_cny : undefined,
    discount_payment, discount_cny: dualCurrencyColumns ? discount_cny : undefined,
    paypal_rate_percent, show_dual_currency_prices: dualCurrencyColumns, total_payment,
    ...(isImportTemplate ? {
      fx_rate_cny_per_payment,
      valid_until: dateValue(sheet[sourceLayout ? "K4" : "J4"]?.v, workbook.Workbook?.WBProps?.date1904 === true),
      sales_account_email: cellText(sheet, sourceLayout ? "D10" : "J10").replace(/^\*?\s*销售员登录邮箱\s*[:：]\s*/, "").trim(),
      seller_contact_name: cellText(sheet, "D7").replace(/^Sales Manager\*?\s*[:：]\s*/i, "").trim(),
      seller_contact_phone: cellText(sheet, "D8").replace(/^Contact No\*?\s*[:：]\s*/i, "").trim(),
      seller_contact_email: cellText(sheet, "D9").replace(/^Email\*?\s*[:：]\s*/i, "").trim(),
      shipping_cny, shipping_source, last_balance_cny, last_balance_source, other_cny, other_source, discount_cny, discount_source,
    } : {}),
  } satisfies ImportedPiDocument };
}
