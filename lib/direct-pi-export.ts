import XLSX, { type CellStyle } from "xlsx-js-style";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createPiDocumentModel } from "./pi-document-model.ts";

const nodeRequire = createRequire(import.meta.url);
const Zip = nodeRequire("xlsx") as typeof import("xlsx");

/** Preserve the supplied corporate logo, sized to the compact PI header. */
function addPiLogo(workbook: Uint8Array): Buffer {
  const template = Zip.CFB.read(readFileSync(path.join(process.cwd(), "assets", "templates", "DT-Smart_PI_Template.xlsx")), { type: "buffer" });
  const output = Zip.CFB.read(Buffer.from(workbook), { type: "buffer" });
  for (const part of ["/xl/drawings/drawing1.xml", "/xl/drawings/_rels/drawing1.xml.rels", "/xl/media/image.png", "/xl/worksheets/_rels/sheet1.xml.rels"]) {
    const original = Zip.CFB.find(template, part);
    if (!original?.content) throw new Error(`PI模板缺少品牌图像部件 ${part}`);
    let bytes = Buffer.from(original.content);
    if (part.endsWith("drawing1.xml")) {
      const drawingXml = bytes.toString("utf8")
        // Excel anchors use EMUs (9,525 per CSS pixel). Keep the 80px logo
        // inside A:C (about 117px wide) and vertically centred in rows 2:9.
        .replace(/<xdr:from>[\s\S]*?<\/xdr:from>/, "<xdr:from><xdr:col>0</xdr:col><xdr:colOff>171450</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>533400</xdr:rowOff></xdr:from>")
        .replace(/<xdr:ext cx="\d+" cy="\d+"\s*\/>/, '<xdr:ext cx="762000" cy="762000" />');
      bytes = Buffer.from(drawingXml, "utf8");
    }
    Zip.CFB.utils.cfb_add(output, part, bytes);
  }
  const worksheet = Zip.CFB.find(output, "/xl/worksheets/sheet1.xml");
  const contentTypes = Zip.CFB.find(output, "/[Content_Types].xml");
  if (!worksheet?.content || !contentTypes?.content) throw new Error("PI工作簿结构不完整");
  let xml = Buffer.from(worksheet.content).toString("utf8");
  if (/<(?:\w+:)?drawing\b/.test(xml)) throw new Error("PI工作簿已包含图像，不能重复插入");
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
  customer?: { company_name?: string | null } | null;
  delivery_recipient: string | null;
  delivery_phone: string | null;
  delivery_email: string | null;
  delivery_address: string | null;
  delivery_date: string | null;
  currency: string;
  fx_rate_cny_to_payment: number;
  payment_method: string | null;
  payment_account_snapshot: string | null;
  subtotal_cny: number;
  shipping_cny: number;
  total_cny: number;
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
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("PI付款币种不正确");
  if (!Number.isFinite(Number(order.fx_rate_cny_to_payment)) || Number(order.fx_rate_cny_to_payment) <= 0) throw new Error("PI汇率不正确");
  if (!order.payment_account_snapshot?.trim()) throw new Error("PI缺少已确认的收款账户");
  const sumCny = roundMoney(items.reduce((sum, item) => sum + roundMoney(Number(item.unit_price_cny) * Number(item.quantity)), 0));
  const sumPaid = roundMoney(items.reduce((sum, item) => sum + roundMoney(Number(item.unit_price) * Number(item.quantity)), 0));
  if (items.some((item) => !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0 ||
      Math.abs(roundMoney(Number(item.unit_price_cny) * Number(order.fx_rate_cny_to_payment)) - Number(item.unit_price)) > 0.01)) {
    throw new Error("PI产品数量或换算单价不正确，请核对后重试");
  }
  if (Math.abs(sumCny - Number(order.subtotal_cny)) > 0.01 || Math.abs(sumPaid - Number(order.subtotal)) > 0.01 ||
      Math.abs(roundMoney(Number(order.subtotal_cny) + Number(order.shipping_cny)) - Number(order.total_cny)) > 0.01 ||
      Math.abs(roundMoney(Number(order.subtotal) + Number(order.shipping_cost)) - Number(order.total_amount)) > 0.01) {
    throw new Error("PI产品金额与订单汇总不一致，请核对后重试");
  }
  const document = createPiDocumentModel(order, items);
  const issueDate = document.issueDate;
  const lastItemRow = 18 + Math.max(9, items.length);
  const subtotalRow = lastItemRow + 1;
  const shippingRow = subtotalRow + 1;
  const totalRow = shippingRow + 1;
  const paymentHeader = totalRow + 1;
  const paymentBody = paymentHeader + 1;
  const signatureHeader = paymentBody + 1;
  const signatureName = signatureHeader + 1;
  const signatureDate = signatureName + 1;
  const sheet = XLSX.utils.aoa_to_sheet([[""]]);
  sheet["!ref"] = `A1:K${signatureDate}`;
  // The logical nine-column table uses the same proportions as the browser preview.
  sheet["!cols"] = [5, 6, 6, 9, 12, 14, 9, 8, 13, 8, 16].map((wch) => ({ wch }));
  sheet["!rows"] = Array.from({ length: signatureDate }, (_, index) => ({
    hpt: index === paymentBody - 1 ? Math.max(72, order.payment_account_snapshot!.split(/\r?\n/).length * 14) : index === 17 ? 34 : index >= 18 && index < lastItemRow ? (index < 18 + items.length ? 24 : 19) : 18,
  }));
  sheet["!margins"] = { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.1 };

  set(sheet, "I1", "DCN: E-S-002 Rev.05", { ...base, alignment: { horizontal: "right" } }); merge(sheet, "I1:K1");
  set(sheet, "D2", document.companyName, { ...base, font: { name: "Arial", sz: 12, bold: true } }); merge(sheet, "D2:F3");
  const green: CellStyle = { ...boxed, fill: { fgColor: { rgb: "70AD47" } }, font: { name: "Arial", sz: 14, bold: true, underline: true } };
  set(sheet, "G2", "COMMERCIAL INVOICE", green); merge(sheet, "G2:I3");
  set(sheet, "J2", document.orderNumber, { ...green, font: { name: "Arial", sz: 14 } }); merge(sheet, "J2:K3");
  set(sheet, "D4", `Address: ${document.companyAddress}`, { ...base, alignment: { vertical: "center", wrapText: true } }); merge(sheet, "D4:F5");
  set(sheet, "G4", "QUOTATION VALID", boxed); merge(sheet, "G4:I5");
  set(sheet, "J4", document.quotationValidUntil, boxed); merge(sheet, "J4:K5");
  set(sheet, "D6", `Official Website: ${document.website}`); merge(sheet, "D6:F6");
  set(sheet, "G6", "PAYMENT / METHOD:", boxed); merge(sheet, "G6:I7");
  set(sheet, "J6", document.paymentMethod, boxed); merge(sheet, "J6:K7");
  set(sheet, "D7", `Sales Manager: ${document.salesManager}`); merge(sheet, "D7:F7");
  set(sheet, "D8", `Contact No: ${document.contactPhone}`); merge(sheet, "D8:F8");
  set(sheet, "G8", "DELIVERY DATE", boxed); merge(sheet, "G8:I9");
  set(sheet, "J8", document.deliveryDate, boxed); merge(sheet, "J8:K9");
  set(sheet, "D9", `Email: ${document.contactEmail}`); merge(sheet, "D9:F9");
  set(sheet, "A12", "Delivery Info  ⚠ To ensure that you receive the product safely, please confirm the accuracy of the shipping information.", { ...base, font: { name: "Arial", sz: 10, bold: true, color: { rgb: "E00000" } } }); merge(sheet, "A12:K12");
  const delivery: Array<[number, string, string]> = [
    [13, "To:", document.recipient], [14, "TEL:", document.deliveryPhone],
    [15, "Company:", document.deliveryCompany], [16, "Email:", document.deliveryEmail],
  ];
  for (const [row, label, value] of delivery) {
    set(sheet, `A${row}`, `${label} ${value}`.trim(), { ...base, alignment: { vertical: "center", wrapText: true } });
    merge(sheet, `A${row}:F${row}`);
  }
  set(sheet, "G13", `Delivery address: ${document.deliveryAddress}`, { ...base, alignment: { wrapText: true, vertical: "center" } }); merge(sheet, "G13:K16");
  set(sheet, "F17", "Thanks your business!", { ...center, font: { name: "Arial", sz: 15, bold: true, italic: true, color: { rgb: "0070C0" } } }); merge(sheet, "F17:H17");

  const heading: CellStyle = { ...boxed, font: { name: "Arial", sz: 10, bold: true }, fill: { fgColor: { rgb: "E2EFDA" } } };
  const headings: Array<[string, string, string?]> = [
    ["A", "No."], ["B", "Items", "B18:C18"], ["D", "Brand"], ["E", "Models"], ["F", "Quality"],
    ["G", "Description", "G18:H18"], ["I", `Unit Price\n(${currency})`],
    ["J", "Quantity"], ["K", `Amount\n(${currency})`],
  ];
  for (const [column, label, range] of headings) {
    set(sheet, `${column}18`, label, column === "I" || column === "K" ? { ...heading, alignment: { horizontal: "right", vertical: "center", wrapText: true } } : heading);
    if (range) merge(sheet, range);
  }
  for (let index = 0; index < Math.max(9, items.length); index += 1) {
    const row = 19 + index;
    const item = items[index];
    const values: Array<[string, string | number]> = item ? [
      ["A", index + 1], ["B", item.item_name], ["D", item.brand || ""], ["E", item.model || ""],
      ["F", item.quality || ""], ["G", item.description || ""], ["I", Number(item.unit_price)], ["J", Number(item.quantity)],
    ] : [["A", ""], ["B", ""], ["D", ""], ["E", ""], ["F", ""], ["G", ""], ["I", ""], ["J", ""]];
    for (const [column, value] of values) set(sheet, `${column}${row}`, value,
      column === "I" ? moneyStyle(currency) : boxed);
    if (item) {
      calculated(sheet, `K${row}`, `I${row}*J${row}`, roundMoney(Number(item.unit_price) * Number(item.quantity)), moneyStyle(currency));
    } else { set(sheet, `K${row}`, "", boxed); }
    merge(sheet, `B${row}:C${row}`); merge(sheet, `G${row}:H${row}`);
  }
  const totalRows: Array<[number, string, number | string, number]> = [
    [subtotalRow, "SUBTOTAL:", items.reduce((sum, item) => sum + Number(item.quantity), 0), Number(order.subtotal)],
    [shippingRow, "SHIPPING COST:", "", Number(order.shipping_cost)],
    [totalRow, "TOTAL AMOUNT:", "", Number(order.total_amount)],
  ];
  for (const [row, label, quantity, paid] of totalRows) {
    set(sheet, `G${row}`, label, { ...boxed, font: { name: "Arial", sz: 10, bold: true } }); merge(sheet, `G${row}:I${row}`);
    set(sheet, `J${row}`, quantity, boxed);
    if (row === subtotalRow) {
      calculated(sheet, `K${row}`, `SUM(K19:K${18 + items.length})`, paid, moneyStyle(currency));
    } else if (row === totalRow) {
      calculated(sheet, `K${row}`, `K${subtotalRow}+K${shippingRow}`, paid, moneyStyle(currency, true));
    } else {
      set(sheet, `K${row}`, paid, moneyStyle(currency));
    }
  }
  set(sheet, `A${paymentHeader}`, "**PAYMENT INFORMATION**", { ...boxed, font: { name: "Arial", sz: 11, bold: true }, fill: { fgColor: { rgb: "F1F5F9" } } }); merge(sheet, `A${paymentHeader}:K${paymentHeader}`);
  set(sheet, `A${paymentBody}`, order.payment_account_snapshot.trim(), { ...base, border: { top: border, bottom: border, left: border, right: border }, font: { name: "Arial", sz: 12, bold: true, color: { rgb: blue } }, alignment: { wrapText: true, vertical: "top" } }); merge(sheet, `A${paymentBody}:K${paymentBody}`);
  set(sheet, `A${signatureHeader}`, "Signature By Supplier:", center); merge(sheet, `A${signatureHeader}:F${signatureHeader}`);
  set(sheet, `G${signatureHeader}`, "Signature By Buyer:", center); merge(sheet, `G${signatureHeader}:K${signatureHeader}`);
  set(sheet, `A${signatureName}`, "DT-SMART", center); merge(sheet, `A${signatureName}:F${signatureName}`);
  set(sheet, `G${signatureName}`, document.deliveryCompany, center); merge(sheet, `G${signatureName}:K${signatureName}`);
  set(sheet, `A${signatureDate}`, issueDate, center); merge(sheet, `A${signatureDate}:F${signatureDate}`);
  set(sheet, `G${signatureDate}`, issueDate, center); merge(sheet, `G${signatureDate}:K${signatureDate}`);
  outline(sheet, "A2:F9");
  outline(sheet, "A12:K16");
  outline(sheet, "A13:F16");
  outline(sheet, "G13:K16");
  outline(sheet, "A18:K18");
  outline(sheet, `A19:K${totalRow}`);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "PI");
  return addPiLogo(XLSX.write(book, { bookType: "xlsx", type: "array", compression: true }) as Uint8Array);
}
