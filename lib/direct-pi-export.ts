import XLSX, { type CellStyle } from "xlsx-js-style";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createPiDocumentModel } from "./pi-document-model.ts";

const nodeRequire = createRequire(import.meta.url);
const Zip = nodeRequire("xlsx") as typeof import("xlsx");

/** Preserve the supplied corporate logo in the customer-facing header. */
function addPiLogo(workbook: Uint8Array): Buffer {
  const template = Zip.CFB.read(readFileSync(path.join(process.cwd(), "assets", "templates", "DT-Smart_PI_Template.xlsx")), { type: "buffer" });
  const output = Zip.CFB.read(Buffer.from(workbook), { type: "buffer" });
  for (const part of ["/xl/drawings/drawing1.xml", "/xl/drawings/_rels/drawing1.xml.rels", "/xl/media/image.png", "/xl/worksheets/_rels/sheet1.xml.rels"]) {
    const original = Zip.CFB.find(template, part);
    if (!original?.content) throw new Error(`PI模板缺少品牌图像部件 ${part}`);
    let bytes = Buffer.from(original.content);
    if (part.endsWith("drawing1.xml")) {
      const drawingXml = bytes.toString("utf8")
        // Use A:C for a centered logo while leaving D:G for seller details.
        .replace(/<xdr:from>[\s\S]*?<\/xdr:from>/, "<xdr:from><xdr:col>0</xdr:col><xdr:colOff>76200</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>76200</xdr:rowOff></xdr:from>")
        .replace(/<xdr:ext cx="\d+" cy="\d+"\s*\/>/, '<xdr:ext cx="1295400" cy="1295400" />');
      bytes = Buffer.from(drawingXml, "utf8");
    }
    Zip.CFB.utils.cfb_add(output, part, bytes);
  }
  const worksheet = Zip.CFB.find(output, "/xl/worksheets/sheet1.xml");
  const contentTypes = Zip.CFB.find(output, "/[Content_Types].xml");
  if (!worksheet?.content || !contentTypes?.content) throw new Error("PI工作簿结构不完整");
  let xml = Buffer.from(worksheet.content).toString("utf8");
  if (/<(?:\w+:)?drawing\b/.test(xml)) throw new Error("PI工作簿已包含图像，不能重复插入");
  xml = xml.replace(/<sheetView workbookViewId="0"\s*\/>/, '<sheetView showGridLines="0" workbookViewId="0"/>');
  const originalSheet = Zip.CFB.find(template, "/xl/worksheets/sheet1.xml");
  const drawingId = originalSheet?.content ? Buffer.from(originalSheet.content).toString("utf8").match(/<x:drawing\b[^>]*r:id="([^"]+)"/)?.[1] : null;
  if (!drawingId) throw new Error("PI模板缺少品牌图像位置");
  xml = xml.replace(/<\/worksheet>$/, `<drawing r:id="${drawingId}"/></worksheet>`);
  worksheet.content = Buffer.from(xml, "utf8");
  let types = Buffer.from(contentTypes.content).toString("utf8");
  if (!/Extension="png"/.test(types)) types = types.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
  if (!/PartName="\/xl\/drawings\/drawing1.xml"/.test(types)) types = types.replace("</Types>", '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
  contentTypes.content = Buffer.from(types, "utf8");
  return Buffer.from(Zip.CFB.write(output, { fileType: "zip", type: "buffer" }) as Uint8Array);
}

type DirectPiOrder = {
  order_number: string;
  created_at?: string | null;
  confirmed_at: string;
  pi_valid_until: string | null;
  seller_company_name: string | null;
  seller_company_address: string | null;
  seller_website: string | null;
  seller_contact_name: string | null;
  seller_contact_phone: string | null;
  seller_contact_email: string | null;
  customer_short_name: string;
  customer?: { company_name?: string | null; contact_name?: string | null; tax_number?: string | null } | null;
  delivery_recipient: string | null;
  delivery_phone: string | null;
  delivery_email: string | null;
  delivery_address: string | null;
  delivery_date: string | null;
  currency: string;
  show_dual_currency_prices?: boolean | null;
  fx_rate_cny_to_payment: number;
  payment_method: string | null;
  payment_account_snapshot: string | null;
  subtotal_cny: number;
  shipping_cny: number;
  total_cny: number;
  last_balance_cny?: number;
  last_balance_amount?: number;
  discount_cny?: number;
  discount_amount?: number;
  other_charge_cny?: number;
  other_charge_amount?: number;
  paypal_fee_percent?: number;
  paypal_fee_cny?: number;
  paypal_fee_amount?: number;
  subtotal: number;
  shipping_cost: number;
  total_amount: number;
};

type DirectPiItem = {
  line_number: number;
  item_name: string;
  brand: string | null;
  model: string | null;
  quality: string | null;
  description: string | null;
  quantity: number;
  unit_price_cny: number;
  unit_price: number;
};

const border = { style: "thin" as const, color: { rgb: "475569" } };
const blue = "173EA9";
const base: CellStyle = { font: { name: "Arial", sz: 10 }, alignment: { vertical: "center" } };
const center: CellStyle = { ...base, alignment: { horizontal: "center", vertical: "center", wrapText: true } };
const boxed: CellStyle = { ...center, border: { top: border, bottom: border, left: border, right: border } };
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
// The preview deliberately displays fixed two-decimal amounts without grouping.
const formatMoney = (currency: string) => currency === "CNY" ? '"¥"0.00' : currency === "NGN" ? '"₦"0.00' : `"${currency} "0.00`;

function set(sheet: XLSX.WorkSheet, address: string, value: string | number, style: CellStyle = base) {
  sheet[address] = { t: typeof value === "number" ? "n" : "s", v: value, s: style };
}

function calculated(sheet: XLSX.WorkSheet, address: string, formula: string, value: number, style: CellStyle) {
  sheet[address] = { t: "n", f: formula, v: value, s: style };
}

function merge(sheet: XLSX.WorkSheet, reference: string) {
  const range = XLSX.utils.decode_range(reference);
  (sheet["!merges"] ||= []).push(range);
  const anchor = sheet[XLSX.utils.encode_cell(range.s)];
  const style = anchor?.s as CellStyle | undefined;
  if (!style?.border && !style?.fill) return;
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address] || (sheet[address] = { t: "s", v: "" });
      const edgeBorder = style.border ? {
        ...(row === range.s.r ? { top: style.border.top } : {}),
        ...(row === range.e.r ? { bottom: style.border.bottom } : {}),
        ...(col === range.s.c ? { left: style.border.left } : {}),
        ...(col === range.e.c ? { right: style.border.right } : {}),
      } : undefined;
      cell.s = { ...style, ...(edgeBorder ? { border: edgeBorder } : {}) };
    }
  }
}

function outline(sheet: XLSX.WorkSheet, reference: string) {
  const range = XLSX.utils.decode_range(reference);
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      if (row !== range.s.r && row !== range.e.r && col !== range.s.c && col !== range.e.c) continue;
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address] || (sheet[address] = { t: "s", v: "" });
      const existing = (cell.s || base) as CellStyle;
      cell.s = { ...existing, border: {
        ...existing.border,
        ...(row === range.s.r ? { top: border } : {}),
        ...(row === range.e.r ? { bottom: border } : {}),
        ...(col === range.s.c ? { left: border } : {}),
        ...(col === range.e.c ? { right: border } : {}),
      } };
    }
  }
}

function moneyStyle(currency: string, highlighted = false): CellStyle {
  return {
    ...boxed,
    numFmt: formatMoney(currency),
    alignment: { horizontal: "right", vertical: "center" },
    font: { name: "Arial", sz: 10, bold: true, color: { rgb: highlighted ? "B91C1C" : blue } },
    ...(highlighted ? { fill: { fgColor: { rgb: "FEF08A" } } } : {}),
  };
}

/** Build only the customer-visible PI. Never import the internal workbook or its external links. */
export function buildDirectPiWorkbook(order: DirectPiOrder, items: DirectPiItem[]) {
  if (!items.length || items.length > 500) throw new Error("PI产品明细需为1至500行");
  const currency = order.currency.toUpperCase();
  const showDualCurrencyPrices = order.show_dual_currency_prices === true && currency !== "CNY";
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("PI付款币种不正确");
  if (!Number.isFinite(Number(order.fx_rate_cny_to_payment)) || Number(order.fx_rate_cny_to_payment) <= 0) throw new Error("PI汇率不正确");
  if (!order.payment_account_snapshot?.trim()) throw new Error("PI缺少已确认的收款账户");
  const sumCny = roundMoney(items.reduce((sum, item) => sum + roundMoney(Number(item.unit_price_cny) * Number(item.quantity)), 0));
  const sumPaid = roundMoney(items.reduce((sum, item) => sum + roundMoney(Number(item.unit_price) * Number(item.quantity)), 0));
  if (items.some((item) => !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0 ||
      !Number.isFinite(Number(item.unit_price_cny)) || Number(item.unit_price_cny) < 0 ||
      Math.abs(roundMoney(Number(item.unit_price_cny) * Number(order.fx_rate_cny_to_payment)) - Number(item.unit_price)) > 0.01)) {
    throw new Error("PI产品数量或换算单价不正确，请核对后重试");
  }
  if (Math.abs(sumCny - Number(order.subtotal_cny)) > 0.01 || Math.abs(sumPaid - Number(order.subtotal)) > 0.01 ||
      Math.abs(roundMoney(Number(order.subtotal_cny) + Number(order.shipping_cny) + Number(order.last_balance_cny || 0) + Number(order.other_charge_cny || 0) - Number(order.discount_cny || 0) + Number(order.paypal_fee_cny || 0)) - Number(order.total_cny)) > 0.01 ||
      Math.abs(roundMoney(Number(order.subtotal) + Number(order.shipping_cost) + Number(order.last_balance_amount || 0) + Number(order.other_charge_amount || 0) - Number(order.discount_amount || 0) + Number(order.paypal_fee_amount || 0)) - Number(order.total_amount)) > 0.01) {
    throw new Error("PI产品金额与订单汇总不一致，请核对后重试");
  }
  const document = createPiDocumentModel(order, items);
  const issueDate = document.issueDate;
  const feeRows = [
    ["UNPAID BALANCE:", document.lastBalance, document.lastBalanceCny],
    ["OTHER CHARGES:", document.otherCharge, document.otherChargeCny],
    ["DISCOUNT:", -document.discount, -document.discountCny],
    [`PAYPAL FEE (${document.paypalFeePercent}%):`, document.paypalFee, document.paypalFeeCny],
  ].filter(([, amount]) => Number(amount) !== 0) as Array<[string, number, number]>;
  const lastItemRow = 18 + Math.max(9, items.length);
  const subtotalRow = lastItemRow + 1;
  const shippingRow = subtotalRow + 1;
  const totalRow = shippingRow + feeRows.length + 1;
  const paymentHeader = totalRow + 1;
  const paymentBody = paymentHeader + 1;
  const signatureHeader = paymentBody + 1;
  const signatureName = signatureHeader + 1;
  const signatureDate = signatureName + 1;
  const sheet = XLSX.utils.aoa_to_sheet([[""]]);
  sheet["!ref"] = `A1:${showDualCurrencyPrices ? "M" : "K"}${signatureDate}`;
  // The logical nine-column table uses the same proportions as the browser preview.
  sheet["!cols"] = (showDualCurrencyPrices
    ? [6, 7, 11, 12, 15, 17, 9, 8, 13, 13, 8, 15, 15]
    : [6, 7, 11, 12, 15, 17, 9, 8, 13, 8, 16]).map((wch) => ({ wch }));
  const paymentLineCount = order.payment_account_snapshot!.trim().split(/\r?\n/)
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 95)), 0);
  sheet["!rows"] = Array.from({ length: signatureDate }, (_, index) => ({
    hpt: index === paymentBody - 1 ? Math.max(80, paymentLineCount * 13 + 8) : index === 17 ? 34 : index >= 18 && index < lastItemRow ? (index < 18 + items.length ? 24 : 19) : index >= 1 && index <= 8 ? 14 : index === 9 || index === 10 ? 6 : 21,
  }));
  sheet["!margins"] = { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.1 };

  const sellerEnd = showDualCurrencyPrices ? "G" : "F";
  const invoiceStart = showDualCurrencyPrices ? "H" : "G";
  const invoiceLabelEnd = showDualCurrencyPrices ? "J" : "I";
  const invoiceValueStart = showDualCurrencyPrices ? "K" : "J";
  const invoiceEnd = showDualCurrencyPrices ? "M" : "K";
  set(sheet, showDualCurrencyPrices ? "K1" : "I1", "DCN: E-S-002 Rev.05", { ...base, alignment: { horizontal: "right" } }); merge(sheet, `${showDualCurrencyPrices ? "K" : "I"}1:${invoiceEnd}1`);
  set(sheet, "D2", document.companyName, { ...base, font: { name: "Arial", sz: 11, bold: true }, alignment: { vertical: "center", wrapText: true } }); merge(sheet, `D2:${sellerEnd}3`);
  const green: CellStyle = { ...boxed, fill: { fgColor: { rgb: "70AD47" } }, font: { name: "Arial", sz: 10, bold: true, underline: true } };
  set(sheet, `${invoiceStart}2`, "COMMERCIAL INVOICE", green); merge(sheet, `${invoiceStart}2:${invoiceLabelEnd}3`);
  set(sheet, `${invoiceValueStart}2`, document.orderNumber, { ...green, font: { name: "Arial", sz: 11 } }); merge(sheet, `${invoiceValueStart}2:${invoiceEnd}3`);
  const companyLine: CellStyle = { ...base, font: { name: "Arial", sz: 9 }, alignment: { vertical: "center", wrapText: true } };
  set(sheet, "D4", `Address: ${document.companyAddress}`, companyLine); merge(sheet, `D4:${sellerEnd}5`);
  set(sheet, `${invoiceStart}4`, "QUOTATION VALID", boxed); merge(sheet, `${invoiceStart}4:${invoiceLabelEnd}5`);
  set(sheet, `${invoiceValueStart}4`, document.quotationValidUntil, boxed); merge(sheet, `${invoiceValueStart}4:${invoiceEnd}5`);
  set(sheet, "D6", `Official Website: ${document.website}`, companyLine); merge(sheet, `D6:${sellerEnd}6`);
  set(sheet, `${invoiceStart}6`, "PAYMENT / METHOD:", boxed); merge(sheet, `${invoiceStart}6:${invoiceLabelEnd}7`);
  set(sheet, `${invoiceValueStart}6`, document.paymentMethod, boxed); merge(sheet, `${invoiceValueStart}6:${invoiceEnd}7`);
  set(sheet, "D7", `Sales Manager: ${document.salesManager}`, companyLine); merge(sheet, `D7:${sellerEnd}7`);
  set(sheet, "D8", `Contact No: ${document.contactPhone}`, companyLine); merge(sheet, `D8:${sellerEnd}8`);
  set(sheet, `${invoiceStart}8`, "DELIVERY DATE", boxed); merge(sheet, `${invoiceStart}8:${invoiceLabelEnd}9`);
  set(sheet, `${invoiceValueStart}8`, document.deliveryDate, boxed); merge(sheet, `${invoiceValueStart}8:${invoiceEnd}9`);
  set(sheet, "D9", `Email: ${document.contactEmail}`, companyLine); merge(sheet, `D9:${sellerEnd}9`);
  set(sheet, "A12", "Delivery Info  ⚠ To ensure that you receive the product safely, please confirm the accuracy of the shipping information.", { ...base, font: { name: "Arial", sz: 10, bold: true, color: { rgb: "E00000" } } }); merge(sheet, `A12:${showDualCurrencyPrices ? "M" : "K"}12`);
  const delivery = [
    `Company: ${document.deliveryCompany}`,
    ...(document.deliveryTaxNumber ? [`Tax No.: ${document.deliveryTaxNumber}`] : []),
    `To: ${document.recipient} · TEL: ${document.deliveryPhone}`,
    `Email: ${document.deliveryEmail}`,
  ];
  for (const [index, value] of delivery.entries()) {
    const row = 13 + index;
    set(sheet, `A${row}`, value.trim(), { ...base, alignment: { vertical: "center", wrapText: true } });
    merge(sheet, `A${row}:F${row}`);
  }
  set(sheet, "G13", `Delivery address: ${document.deliveryAddress}`, { ...base, alignment: { wrapText: true, vertical: "center" } }); merge(sheet, `G13:${showDualCurrencyPrices ? "M" : "K"}16`);
  set(sheet, "F17", "Thanks your business!", { ...center, font: { name: "Arial", sz: 15, bold: true, italic: true, color: { rgb: "0070C0" } } }); merge(sheet, "F17:H17");

  const heading: CellStyle = { ...boxed, font: { name: "Arial", sz: 10, bold: true }, fill: { fgColor: { rgb: "E2EFDA" } } };
  const headings: Array<[string, string, string?]> = [
    ["A", "No."], ["B", "Items", "B18:C18"], ["D", "Brand"], ["E", "Models"], ["F", "Quality"],
    ["G", "Description", "G18:H18"],
    ...(showDualCurrencyPrices
      ? [["I", "Unit Price (CNY)"], ["J", `Unit Price (${currency})`], ["K", "Quantity"], ["L", "Amount (CNY)"], ["M", `Amount (${currency})`]] as Array<[string, string]>
      : [["I", `Unit Price\n(${currency})`], ["J", "Quantity"], ["K", `Amount\n(${currency})`]] as Array<[string, string]>),
  ];
  for (const [column, label, range] of headings) {
    set(sheet, `${column}18`, label, ["I", "J", "K", "L", "M"].includes(column) && label !== "Quantity" ? { ...heading, alignment: { horizontal: "right", vertical: "center", wrapText: true } } : heading);
    if (range) merge(sheet, range);
  }
  for (let index = 0; index < Math.max(9, items.length); index += 1) {
    const row = 19 + index;
    const item = items[index];
    const values: Array<[string, string | number]> = item ? [
      ["A", index + 1], ["B", item.item_name], ["D", item.brand || ""], ["E", item.model || ""],
      ["F", item.quality || ""], ["G", item.description || ""], ["I", showDualCurrencyPrices ? Number(item.unit_price_cny) : Number(item.unit_price)],
      ...(showDualCurrencyPrices ? [["J", Number(item.unit_price)], ["K", Number(item.quantity)]] as Array<[string, number]> : [["J", Number(item.quantity)]] as Array<[string, number]>),
    ] : [["A", ""], ["B", ""], ["D", ""], ["E", ""], ["F", ""], ["G", ""], ["I", ""], ["J", ""], ...(showDualCurrencyPrices ? [["K", ""]] as Array<[string, string]> : [])];
    for (const [column, value] of values) set(sheet, `${column}${row}`, value,
      column === "I" ? moneyStyle(showDualCurrencyPrices ? "CNY" : currency) : showDualCurrencyPrices && column === "J" ? moneyStyle(currency) : boxed);
    if (item) {
      if (showDualCurrencyPrices) {
        calculated(sheet, `L${row}`, `I${row}*K${row}`, roundMoney(Number(item.unit_price_cny) * Number(item.quantity)), moneyStyle("CNY"));
        calculated(sheet, `M${row}`, `J${row}*K${row}`, roundMoney(Number(item.unit_price) * Number(item.quantity)), moneyStyle(currency));
      } else calculated(sheet, `K${row}`, `I${row}*J${row}`, roundMoney(Number(item.unit_price) * Number(item.quantity)), moneyStyle(currency));
    } else { for (const column of showDualCurrencyPrices ? ["L", "M"] : ["K"]) set(sheet, `${column}${row}`, "", boxed); }
    merge(sheet, `B${row}:C${row}`); merge(sheet, `G${row}:H${row}`);
  }
  const totalRows: Array<[number, string, number | string, number, number]> = [
    [subtotalRow, "SUBTOTAL:", items.reduce((sum, item) => sum + Number(item.quantity), 0), Number(order.subtotal), Number(order.subtotal_cny)],
    [shippingRow, "SHIPPING COST:", "", Number(order.shipping_cost), Number(order.shipping_cny)],
    ...feeRows.map(([label, amount, amountCny], index): [number, string, string, number, number] => [shippingRow + index + 1, label, "", amount, amountCny]),
    [totalRow, "TOTAL AMOUNT:", "", Number(order.total_amount), Number(order.total_cny)],
  ];
  for (const [row, label, quantity, paid, cny] of totalRows) {
    set(sheet, `G${row}`, label, { ...boxed, font: { name: "Arial", sz: 10, bold: true } }); merge(sheet, `G${row}:${showDualCurrencyPrices ? "J" : "I"}${row}`);
    set(sheet, `${showDualCurrencyPrices ? "K" : "J"}${row}`, quantity, boxed);
    if (showDualCurrencyPrices) {
      for (const [column, amount, code] of [["L", cny, "CNY"], ["M", paid, currency]] as const) {
        if (row === subtotalRow) calculated(sheet, `${column}${row}`, `SUM(${column}19:${column}${18 + items.length})`, amount, moneyStyle(code));
        else if (row === totalRow) calculated(sheet, `${column}${row}`, `SUM(${column}${subtotalRow}:${column}${totalRow - 1})`, amount, moneyStyle(code, true));
        else set(sheet, `${column}${row}`, amount, moneyStyle(code));
      }
    } else if (row === subtotalRow) {
      calculated(sheet, `K${row}`, `SUM(K19:K${18 + items.length})`, paid, moneyStyle(currency));
    } else if (row === totalRow) {
      calculated(sheet, `K${row}`, `SUM(K${subtotalRow}:K${totalRow - 1})`, paid, moneyStyle(currency, true));
    } else {
      set(sheet, `K${row}`, paid, moneyStyle(currency));
    }
  }
  set(sheet, `A${paymentHeader}`, "**PAYMENT INFORMATION**", { ...boxed, font: { name: "Arial", sz: 11, bold: true }, fill: { fgColor: { rgb: "F1F5F9" } } }); merge(sheet, `A${paymentHeader}:${showDualCurrencyPrices ? "M" : "K"}${paymentHeader}`);
  set(sheet, `A${paymentBody}`, order.payment_account_snapshot.trim(), { ...base, border: { top: border, bottom: border, left: border, right: border }, font: { name: "Arial", sz: 10, bold: true, color: { rgb: blue } }, alignment: { wrapText: true, vertical: "top" } }); merge(sheet, `A${paymentBody}:${showDualCurrencyPrices ? "M" : "K"}${paymentBody}`);
  set(sheet, `A${signatureHeader}`, "Signature By Supplier:", center); merge(sheet, `A${signatureHeader}:F${signatureHeader}`);
  set(sheet, `G${signatureHeader}`, "Signature By Buyer:", center); merge(sheet, `G${signatureHeader}:${showDualCurrencyPrices ? "M" : "K"}${signatureHeader}`);
  set(sheet, `A${signatureName}`, "DT-SMART", center); merge(sheet, `A${signatureName}:F${signatureName}`);
  set(sheet, `G${signatureName}`, document.deliveryCompany, center); merge(sheet, `G${signatureName}:${showDualCurrencyPrices ? "M" : "K"}${signatureName}`);
  set(sheet, `A${signatureDate}`, issueDate, center); merge(sheet, `A${signatureDate}:F${signatureDate}`);
  set(sheet, `G${signatureDate}`, issueDate, center); merge(sheet, `G${signatureDate}:${showDualCurrencyPrices ? "M" : "K"}${signatureDate}`);
  outline(sheet, `A2:${sellerEnd}9`);
  outline(sheet, `A12:${showDualCurrencyPrices ? "M" : "K"}16`);
  outline(sheet, "A13:F16");
  outline(sheet, `G13:${showDualCurrencyPrices ? "M" : "K"}16`);
  outline(sheet, `A18:${showDualCurrencyPrices ? "M" : "K"}18`);
  outline(sheet, `A19:${showDualCurrencyPrices ? "M" : "K"}${totalRow}`);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "PI");
  return addPiLogo(XLSX.write(book, { bookType: "xlsx", type: "array", compression: true }) as Uint8Array);
}
