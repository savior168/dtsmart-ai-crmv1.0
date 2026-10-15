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
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}

/** Parse only the customer-facing PI layout; internal RMB and account data are never inferred. */
export function parseCustomerPiWorkbook(bytes: Uint8Array) {
  if (bytes.byteLength < 100 || bytes.byteLength > 2 * 1024 * 1024) throw new Error("PI文件大小须在2MB以内");
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false, cellFormula: true });
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

