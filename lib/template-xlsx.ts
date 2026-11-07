import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { QuoteItem } from "@/lib/types";

// SheetJS 0.18 is CommonJS. Loading it through Node's explicit ESM bridge
// avoids a false default-export shape in the Next.js server bundle while also
// remaining executable in the native Node regression test.
type SheetJsModule = typeof import("xlsx");
const nodeRequire = createRequire(import.meta.url);
const XLSX = nodeRequire("xlsx") as SheetJsModule;

type QuoteExportData = {
  quote_number: string;
  currency: string;
  valid_until?: string | null;
  payment_method?: string | null;
  delivery_date?: string | null;
  customer_short_name?: string | null;
  destination_country?: string | null;
  stocking_requirements?: string | null;
  shipping_cost: number;
  subtotal: number;
  total_amount: number;
  created_at?: string | null;
  owner?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  customer?: { company_name?: string | null; contact_name?: string | null; phone?: string | null } | null;
};

type StockExportData = {
  stock_number: string;
  order_number: string;
  warehouse_reference_number?: string | null;
  quote_number: string;
  customer_short_name: string;
  customer_name?: string | null;
  destination_country?: string | null;
  stocking_requirements?: string | null;
  status_note?: string | null;
  order_change_note?: string | null;
  expected_ready_at?: string | null;
  shipped_at?: string | null;
  status_label?: string | null;
  delivery_recipient?: string | null;
  delivery_phone?: string | null;
  delivery_email?: string | null;
  delivery_address?: string | null;
  forwarder_address?: string | null;
  forwarder_recipient?: string | null;
  forwarder_phone?: string | null;
  created_at: string;
  salesperson?: { name?: string | null; email?: string | null } | null;
};

const PI_TEMPLATE = path.join(process.cwd(), "assets", "templates", "DT-Smart_PI_Template.xlsx");
const STOCK_TEMPLATE = path.join(process.cwd(), "assets", "templates", "Warehouse_Stock_Template.xlsx");

// Keep the template writer directly executable by Node's TypeScript-strip test.
function escapeXml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function cellMarkup(reference: string, style: string, value: unknown, formula: string | undefined, prefix: string) {
  const attrs = `${style ? ` s="${style}"` : ""}`;
  if (formula) return `<${prefix}c r="${reference}"${attrs}><${prefix}f>${escapeXml(formula)}</${prefix}f>${typeof value === "number" && Number.isFinite(value) ? `<${prefix}v>${value}</${prefix}v>` : ""}</${prefix}c>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<${prefix}c r="${reference}"${attrs} t="n"><${prefix}v>${value}</${prefix}v></${prefix}c>`;
  const text = escapeXml(value);
  return `<${prefix}c r="${reference}"${attrs} t="inlineStr"><${prefix}is><${prefix}t xml:space="preserve">${text}</${prefix}t></${prefix}is></${prefix}c>`;
}

function setCell(xml: string, reference: string, value: unknown, formula?: string) {
  const prefix = xml.includes("<x:c") ? "x:" : "";
  const opening = xml.match(new RegExp(`<${prefix}c\\b(?=[^>]*\\br="${reference}")[^>]*>`));
  if (!opening || opening.index === undefined) throw new Error(`模板缺少单元格 ${reference}`);
  const start = opening.index;
  let end = start + opening[0].length;
  if (!/\/\s*>$/.test(opening[0])) {
    const closingTag = `</${prefix}c>`;
    const closing = xml.indexOf(closingTag, end);
    if (closing < 0) throw new Error(`模板单元格 ${reference} 结构不完整`);
    end = closing + closingTag.length;
  }
  const style = opening[0].match(/\bs="(\d+)"/)?.[1] || "";
  return `${xml.slice(0, start)}${cellMarkup(reference, style, value, formula, prefix)}${xml.slice(end)}`;
}

function shiftCellReference(reference: string, startRow: number, delta: number) {
  return reference.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, (all, column: string, absolute: string, row: string) => {
    const number = Number(row);
    return number >= startRow ? `${column}${absolute}${number + delta}` : all;
  });
}

function shiftPiRows(xml: string, delta: number) {
  if (delta <= 0) return xml;
  const rowTemplate = xml.match(/<x:row[^>]*r="27"[\s\S]*?<\/x:row>/)?.[0];
  if (!rowTemplate) throw new Error("报价模板缺少可扩展的产品行");
  const sheetDataEnd = xml.indexOf("</x:sheetData>");
  const beforeEnd = xml.slice(0, sheetDataEnd);
  const afterEnd = xml.slice(sheetDataEnd);
  const shifted = beforeEnd.replace(/<x:row[^>]*r="(\d+)"[\s\S]*?<\/x:row>/g, rowXml => {
    const row = Number(rowXml.match(/\br="(\d+)"/)?.[1] || 0);
    if (row < 28) return rowXml;
    return rowXml
      .replace(/(<x:row[^>]*\br=")(\d+)(")/, (_, start, value, end) => `${start}${Number(value) + delta}${end}`)
      .replace(/(<x:c[^>]*\br=")([A-Z]+)(\d+)(")/g, (_, start, column, value, end) => `${start}${column}${Number(value) + delta}${end}`)
      .replace(/(<x:f>)([\s\S]*?)(<\/x:f>)/g, (_, start, formula, end) => {
        const extended = formula.replace(/(\$?[A-Z]{1,3}\$?19):(\$?[A-Z]{1,3}\$?)27\b/g, (_range: string, first: string, last: string) => `${first}:${last}${27 + delta}`);
        return `${start}${shiftCellReference(extended, 28, delta)}${end}`;
      });
  });
  const extraRows = Array.from({ length: delta }, (_, index) => {
    const row = 28 + index;
    return rowTemplate
      .replace(/(<x:row[^>]*\br=")27(")/, `$1${row}$2`)
      .replace(/([A-Z]{1,3})27\b/g, `$1${row}`);
  }).join("");
  const firstFooterRow = 28 + delta;
  let result = shifted.replace(new RegExp(`(<x:row[^>]*r="${firstFooterRow}"[\\s\\S]*?<\\/x:row>)`), `${extraRows}$1`) + afterEnd;
  result = result.replace(/(<x:dimension[^>]*ref=")([^"]+)(")/, (_, start, range, end) => `${start}${shiftCellReference(range, 28, delta)}${end}`);
  result = result.replace(/(<x:mergeCell[^>]*ref=")([^"]+)(")/g, (_, start, range, end) => `${start}${shiftCellReference(range, 28, delta)}${end}`);
  return result;
}

function ensurePiProductMerges(xml: string, lastProductRow: number) {
  const closing = xml.includes("</x:mergeCells>") ? "</x:mergeCells>" : "</mergeCells>";
  const prefix = closing.startsWith("</x:") ? "x:" : "";
  const additions: string[] = [];
  for (let row = 19; row <= lastProductRow; row += 1) {
    for (const reference of [`B${row}:C${row}`, `G${row}:H${row}`]) {
      if (!xml.includes(`ref="${reference}"`)) additions.push(`<${prefix}mergeCell ref="${reference}" />`);
    }
  }
  return additions.length ? xml.replace(closing, `${additions.join("")}${closing}`) : xml;
}

async function openTemplate(file: string) {
  const cfb = XLSX.CFB.read(await readFile(file), { type: "buffer" });
  const entry = XLSX.CFB.find(cfb, "/xl/worksheets/sheet1.xml");
  if (!entry) throw new Error("模板工作表不存在");
  return { cfb, entry, xml: Buffer.from(entry.content).toString("utf8") };
}

function finishTemplate(cfb: ReturnType<typeof XLSX.CFB.read>, entry: { content: unknown }, xml: string) {
  entry.content = Buffer.from(xml, "utf8");
  return Buffer.from(XLSX.CFB.write(cfb, { fileType: "zip", type: "buffer" }) as Uint8Array);
}

function stockTextStyles(cfb: ReturnType<typeof XLSX.CFB.read>, includeProcurement: boolean) {
  const entry = XLSX.CFB.find(cfb, "/xl/styles.xml");
  if (!entry?.content) throw new Error("备货模板缺少样式定义");
  let xml = Buffer.from(entry.content).toString("utf8");
  // The supplied workbook contains an empty fill node. Excel tolerates it,
  // but OOXML readers such as openpyxl reject the exported workbook.
  xml = xml.replace(/<fill\s*\/>/g, '<fill><patternFill patternType="none"/></fill>');
  xml = xml.replace(/&quot;采购成本 ∑= &quot;/, includeProcurement ? '&quot;采购总金额 ∑= &quot;' : '&quot;PI预估成本 ∑= &quot;');
  const fonts = xml.match(/<fonts count="(\d+)"[^>]*>([\s\S]*?)<\/fonts>/);
  const cellXfs = xml.match(/<cellXfs count="(\d+)"[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!fonts || !cellXfs) throw new Error("备货模板样式结构不完整");
  const itemNoteFont = Number(fonts[1]);
  xml = xml.replace(fonts[0], `<fonts count="${itemNoteFont + 1}">${fonts[2]}<font><sz val="9"/><color rgb="FF986C47"/><name val="微软雅黑"/></font></fonts>`);
  const existing = [...cellXfs[2].matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map((match) => match[0]);
  if (existing.length !== Number(cellXfs[1]) || !existing[24] || !existing[31] || !existing[56]) throw new Error("备货模板基础样式已变更，请核对模板");
  const clone = (source: number, fontId: number | null) => {
    let style = existing[source];
    if (fontId !== null) style = style.replace(/fontId="\d+"/, `fontId="${fontId}"`).replace("<xf ", '<xf applyFont="1" ');
    if (/<alignment\b/.test(style)) style = style.replace(/<alignment\b[^>]*\/>/, (alignment) => alignment.includes("wrapText=") ? alignment.replace(/wrapText="\d+"/, 'wrapText="1"') : alignment.replace("/>", ' wrapText="1"/>'));
    else style = style.replace(/\/>$/, '><alignment vertical="center" wrapText="1"/></xf>');
    return style;
  };
  const nStyle = existing.length;
  const contactStyle = nStyle + 1;
  const descriptionStyle = contactStyle + 1;
  const additions = clone(56, itemNoteFont) + clone(31, null) + clone(55, null);
  const customStyles = [...additions.matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map((match) => match[0]);
  const baseStyles = [...existing, ...customStyles];
  xml = xml.replace(cellXfs[0], `<cellXfs count="${baseStyles.length}">${baseStyles.join("")}</cellXfs>`);
  const borders = xml.match(/<borders count="(\d+)"[^>]*>([\s\S]*?)<\/borders>/);
  if (!borders) throw new Error("备货模板缺少边框样式");
  const procurementBorderId = Number(borders[1]);
  const procurementBorder = '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>';
  xml = xml.replace(borders[0], `<borders count="${procurementBorderId + 1}">${borders[2]}${procurementBorder}</borders>`);
  const addBorder = (style: string) => {
    const opening = style.match(/^<xf\b([^>]*?)(\/?)>/);
    if (!opening) throw new Error("备货模板单元格样式结构不完整");
    let attrs = opening[1].replace(/\bborderId="\d+"/, `borderId="${procurementBorderId}"`);
    if (!/\bborderId="/.test(attrs)) attrs += ` borderId="${procurementBorderId}"`;
    attrs = /\bapplyBorder="/.test(attrs) ? attrs.replace(/\bapplyBorder="\d+"/, 'applyBorder="1"') : `${attrs} applyBorder="1"`;
    return `<xf${attrs}${opening[2] ? "/" : ""}>${style.slice(opening[0].length)}`;
  };
  const borderedStyles = baseStyles.map(addBorder);
  const currentXfs = xml.match(/<cellXfs count="(\d+)"[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!currentXfs) throw new Error("备货模板单元格样式结构不完整");
  const procurementBorderStyles = baseStyles.map((_, index) => Number(currentXfs[1]) + index);
  xml = xml.replace(currentXfs[0], `<cellXfs count="${Number(currentXfs[1]) + borderedStyles.length}">${currentXfs[2]}${borderedStyles.join("")}</cellXfs>`);
  entry.content = Buffer.from(xml, "utf8");
  return { nStyle, contactStyle, descriptionStyle, procurementBorderStyles };
}

function withProcurementBorder(xml: string, reference: string, styles: number[]) {
  return xml.replace(new RegExp(`(<c\\b[^>]*\\br="${reference}"[^>]*\\bs=")(\\d+)("[^>]*>)`), (all, before, styleId, after) => {
    const borderedStyle = styles[Number(styleId)];
    return borderedStyle === undefined ? all : `${before}${borderedStyle}${after}`;
  });
}

function withCellStyle(xml: string, reference: string, style: number) {
  return xml.replace(new RegExp(`(<c\\b[^>]*\\br="${reference}"[^>]*\\bs=")\\d+("[^>]*>)`), `$1${style}$2`);
}

function withRowHeight(xml: string, row: number, height: number) {
  return xml.replace(new RegExp(`(<row\\b[^>]*\\br="${row}"[^>]*\\bht=")([^"]+)(")`), `$1${height}$3`);
}

type StockRequirementImage = { id: string; filename: string; lineNumber: number | null; url: string; thumbnail: Uint8Array; rowIndex?: number };

function xmlPart(parts: Record<string, Uint8Array>, partPath: string) {
  const content = parts[partPath];
  if (!content) throw new Error(`备货模板缺少 ${partPath}`);
  return Buffer.from(content).toString("utf8");
}

function columnPixels(sheetXml: string, columnIndex: number) {
  const columnNumber = columnIndex + 1;
  for (const column of sheetXml.match(/<(?:x:)?col\b[^>]*\/?\s*>/g) || []) {
    const min = Number(column.match(/\bmin="(\d+)"/)?.[1]);
    const max = Number(column.match(/\bmax="(\d+)"/)?.[1]);
    const width = Number(column.match(/\bwidth="([\d.]+)"/)?.[1]);
    if (columnNumber >= min && columnNumber <= max && Number.isFinite(width)) return Math.max(1, Math.round(width * 7 + 5));
  }
  return 64;
}

function rowPixels(sheetXml: string, rowIndex: number) {
  const rowNumber = rowIndex + 1;
  const row = (sheetXml.match(/<(?:x:)?row\b[^>]*>/g) || []).find((candidate) => Number(candidate.match(/\br="(\d+)"/)?.[1]) === rowNumber);
  const height = Number(row?.match(/\bht="([\d.]+)"/)?.[1]);
  return Number.isFinite(height) && height > 0 ? Math.max(1, Math.ceil(height * 96 / 72)) : 20;
}

function axisMarker(sheetXml: string, columnIndex: number, rowIndex: number, xPixels: number, yPixels: number) {
  let col = columnIndex;
  let colOffset = xPixels;
  while (colOffset >= columnPixels(sheetXml, col)) {
    colOffset -= columnPixels(sheetXml, col);
    col += 1;
  }
  let row = rowIndex;
  let rowOffset = yPixels;
  while (rowOffset >= rowPixels(sheetXml, row)) {
    rowOffset -= rowPixels(sheetXml, row);
    row += 1;
  }
  const emu = (pixels: number) => Math.round(pixels * 9525);
  return { col, row, colOffset: emu(colOffset), rowOffset: emu(rowOffset) };
}

function addStockRequirementImages(buffer: Buffer, attachments: StockRequirementImage[]) {
  if (!attachments.length) return buffer;
  const parts = unzipSync(new Uint8Array(buffer));
  const worksheetPath = "xl/worksheets/sheet1.xml";
  let worksheet = xmlPart(parts, worksheetPath);
  if (/<(?:x:)?drawing\b/.test(worksheet)) throw new Error("备货模板已有绘图层，不能安全添加理货图片");
  const sheetRelsPath = "xl/worksheets/_rels/sheet1.xml.rels";
  const rels = parts[sheetRelsPath] ? xmlPart(parts, sheetRelsPath) : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const nextRelId = [...rels.matchAll(/\bId="rId(\d+)"/g)].reduce((max, match) => Math.max(max, Number(match[1])), 0) + 1;
  const drawingRelId = `rId${nextRelId}`;
  const drawingRelationship = `<Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>`;
  parts[sheetRelsPath] = strToU8(rels.replace("</Relationships>", `${drawingRelationship}</Relationships>`));
  if (!/\bxmlns:r=/.test(worksheet)) worksheet = worksheet.replace(/<((?:x:)?worksheet)\b/, '<$1 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
  const drawingTag = `<drawing r:id="${drawingRelId}"/>`;
  worksheet = /<(?:x:)?extLst\b/.test(worksheet)
    ? worksheet.replace(/<(?:x:)?extLst\b/, `${drawingTag}<extLst`)
    : worksheet.replace("</worksheet>", `${drawingTag}</worksheet>`);
  parts[worksheetPath] = strToU8(worksheet);

  const drawingRels: string[] = [];
  const anchors: string[] = [];
  attachments.forEach((attachment, index) => {
    const safeUrl = new URL(attachment.url);
    if (!["https:", "http:"].includes(safeUrl.protocol)) throw new Error("理货图片预览链接格式不正确");
    const mediaName = `stock-requirement-${String(index + 1).padStart(4, "0")}.jpg`;
    parts[`xl/media/${mediaName}`] = attachment.thumbnail;
    const imageRelId = `rId${index + 1}`;
    const hyperlinkRelId = `rId${attachments.length + index + 1}`;
    drawingRels.push(`<Relationship Id="${imageRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/>`);
    drawingRels.push(`<Relationship Id="${hyperlinkRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(safeUrl.toString())}" TargetMode="External"/>`);

    const wholeOrder = attachment.lineNumber === null;
    const rowIndex = wholeOrder ? 6 : attachment.rowIndex ?? 12 + Number(attachment.lineNumber) - 1;
    const columnIndex = wholeOrder ? 10 : 13;
    const imageIndex = attachments.slice(0, index).filter((item) => item.lineNumber === attachment.lineNumber).length;
    const startX = wholeOrder ? 4 + imageIndex * 78 : [4, 80, columnPixels(worksheet, 13) + 4][imageIndex % 3];
    const startY = wholeOrder ? 4 : 5 + Math.floor(imageIndex / 3) * 54;
    const from = axisMarker(worksheet, columnIndex, rowIndex, startX, startY);
    const to = axisMarker(worksheet, columnIndex, rowIndex, startX + 72, startY + 48);
    const marker = (tag: "from" | "to", point: typeof from) => `<xdr:${tag}><xdr:col>${point.col}</xdr:col><xdr:colOff>${point.colOffset}</xdr:colOff><xdr:row>${point.row}</xdr:row><xdr:rowOff>${point.rowOffset}</xdr:rowOff></xdr:${tag}>`;
    const name = escapeXml(attachment.filename);
    const description = escapeXml(`${wholeOrder ? "整单理货要求" : `第 ${attachment.lineNumber} 项理货要求`}：${attachment.filename}。点击打开原图；选中图片可拖拽调整大小。`);
    anchors.push(`<xdr:twoCellAnchor editAs="oneCell">${marker("from", from)}${marker("to", to)}<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 1}" name="理货要求图片 ${index + 1} - ${name}" descr="${description}"><a:hlinkClick r:id="${hyperlinkRelId}" tooltip="点击打开原始理货要求图片"/></xdr:cNvPr><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${imageRelId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="685800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`);
  });
  parts["xl/drawings/drawing1.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join("")}</xdr:wsDr>`);
  parts["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels.join("")}</Relationships>`);
  let contentTypes = xmlPart(parts, "[Content_Types].xml");
  if (!/<Default\b[^>]*\bExtension="jpg"/.test(contentTypes)) contentTypes = contentTypes.replace("</Types>", '<Default Extension="jpg" ContentType="image/jpeg"/></Types>');
  contentTypes = contentTypes.replace("</Types>", '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
  parts["[Content_Types].xml"] = strToU8(contentTypes);
  return Buffer.from(zipSync(parts, { level: 6 }));
}

export async function buildQuoteWorkbook(quote: QuoteExportData, items: QuoteItem[]) {
  const opened = await openTemplate(PI_TEMPLATE);
  const extra = Math.max(0, items.length - 9);
  let xml = ensurePiProductMerges(shiftPiRows(opened.xml, extra), Math.max(27, 18 + items.length));
  const totalRow = 28 + extra;
  const shippingRow = totalRow + 1;
  const grandTotalRow = totalRow + 2;
  const values: Array<[string, unknown]> = [
    ["J2", quote.quote_number],
    ["J4", quote.valid_until || ""],
    ["J6", quote.payment_method || quote.currency],
    ["J8", quote.delivery_date || ""],
    ["D7", `Sales Manager: ${quote.owner?.name || ""}`],
    ["D8", `Contact No: ${quote.owner?.phone || ""}`],
    ["D9", `Email: ${quote.owner?.email || ""}`],
    ["D13", quote.customer?.contact_name || ""],
    ["D14", quote.customer?.phone || ""],
    ["D15", quote.customer?.company_name || quote.customer_short_name || ""],
    [`J${totalRow}`, items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)],
    [`K${totalRow}`, Number(quote.subtotal || 0)],
    [`K${shippingRow}`, Number(quote.shipping_cost || 0)],
    [`K${grandTotalRow}`, Number(quote.total_amount || 0)],
    [`A${35 + extra}`, quote.created_at?.slice(0, 10) || ""],
    [`G${35 + extra}`, ""],
  ];
  for (const [cell, value] of values) xml = setCell(xml, cell, value);
  for (let index = 0; index < Math.max(items.length, 9); index += 1) {
    const row = 19 + index;
    const item = items[index];
    const rowValues: Array<[string, unknown]> = item ? [
      [`B${row}`, item.item_name], [`D${row}`, item.brand || ""], [`E${row}`, item.model || ""],
      [`F${row}`, item.quality || ""], [`G${row}`, [item.product_color_snapshot ? `Color: ${item.product_color_snapshot}` : "", item.description || ""].filter(Boolean).join("; ")], [`I${row}`, Number(item.unit_price || 0)],
      [`J${row}`, Number(item.quantity || 0)],
    ] : [[`B${row}`, ""], [`D${row}`, ""], [`E${row}`, ""], [`F${row}`, ""], [`G${row}`, ""], [`I${row}`, ""], [`J${row}`, ""]];
    for (const [cell, value] of rowValues) xml = setCell(xml, cell, value);
    xml = setCell(xml, `A${row}`, "", `IF(COUNTA(B${row}:J${row})=0,"",ROW()-18)`);
    xml = setCell(xml, `K${row}`, "", `IF(OR(I${row}="",J${row}=""),"",ROUND(I${row}*J${row},2))`);
  }
  xml = setCell(xml, `J${totalRow}`, "", `SUM(J19:J${18 + items.length})`);
  xml = setCell(xml, `K${totalRow}`, "", `SUM(K19:K${18 + items.length})`);
  xml = setCell(xml, `K${grandTotalRow}`, "", `K${totalRow}+K${shippingRow}`);
  return finishTemplate(opened.cfb, opened.entry, xml);
}

export async function buildStockWorkbook(stock: StockExportData, items: (QuoteItem & { line_number?: number; procurement_cost_confirmed?: boolean; estimated_unit_cost_cny?: number | null; received_quantity?: number; warehouse_supplier_code?: string | null; internal_note?: string | null; warehouse_note?: string | null })[], options: { includeProcurement?: boolean; requirementAttachments?: StockRequirementImage[] } = {}) {
  if (items.length > 987) throw new Error("备货模板最多支持987条产品明细");
  const opened = await openTemplate(STOCK_TEMPLATE);
  let xml = opened.xml;
  const styles = stockTextStyles(opened.cfb, options.includeProcurement === true);
  const changes = String(stock.order_change_note || "").split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.、)]|[⑴⑵⑶])\s*/, "").trim()).filter(Boolean);
  const values: Array<[string, unknown]> = [
    ["B3", stock.salesperson?.name || stock.salesperson?.email || ""], ["E3", stock.created_at.slice(0, 10)],
    ["G3", stock.warehouse_reference_number || stock.order_number], ["H3", stock.customer_name?.trim() || "历史未留存"], ["K3", /^[A-Z]{2}$/.test(stock.destination_country || "") ? new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(stock.destination_country || "") || stock.destination_country : stock.destination_country || ""],
    ["M3", stock.expected_ready_at?.slice(0, 10) || ""], ["N3", stock.shipped_at?.slice(0, 10) || ""],
    ["K4", [stock.stocking_requirements?.trim() || "常规理货", (options.requirementAttachments || []).some((attachment) => attachment.lineNumber === null) ? `理货图片：${options.requirementAttachments?.filter((attachment) => attachment.lineNumber === null).length} 张，点击缩略图查看原图` : ""].filter(Boolean).join("\n")],
    ["C5", changes[0] || ""], ["C6", changes[1] || ""], ["C7", changes.slice(2).join("；")],
    ["D9", [`货代收货信息：`, `收货人：${stock.forwarder_recipient || "未填写"}`, `电话：${stock.forwarder_phone || "未填写"}`, `地址：${stock.forwarder_address || "未填写"}`].join("\n")],
    ["B9", "货代收货信息：\n＊收货人（姓名/电话）\n＊详细收货地址："],
    ["B10", stock.status_label ? `备货状态：${stock.status_label}` : ""],
  ];
  for (const [cell, value] of values) xml = setCell(xml, cell, value);
  if (stock.status_label) xml = withRowHeight(xml, 10, 20);
  xml = withCellStyle(withRowHeight(xml, 9, 75), "D9", styles.contactStyle);
  if (stock.stocking_requirements?.trim() && stock.stocking_requirements.trim() !== "常规理货") xml = withCellStyle(xml, "K4", styles.nStyle);
  xml = setCell(xml, "B11", "", "SUM(K13:K999)");
  const totalEstimatedCost = items.length > 0 && items.every((item) => typeof item.estimated_unit_cost_cny === "number" && Number.isFinite(item.estimated_unit_cost_cny))
    ? Math.round(items.reduce((sum, item) => sum + Number(item.estimated_unit_cost_cny) * Number(item.quantity || 0), 0) * 100) / 100
    : "";
  const estimatedTotalComplete = items.length > 0 && items.every((item) => typeof item.estimated_unit_cost_cny === "number" && Number.isFinite(item.estimated_unit_cost_cny));
  if (options.includeProcurement) {
    const completeProcurement = items.length > 0 && items.every((item) => item.procurement_cost_confirmed === true
      && typeof item.procurement_cost === "number" && Number.isFinite(item.procurement_cost));
    const totalProcurement = completeProcurement
      ? Math.round(items.reduce((sum, item) => sum + Number(item.procurement_cost) * Number(item.quantity || 0), 0) * 100) / 100
      : "";
    const totalCostDifference = completeProcurement && estimatedTotalComplete
      ? Math.round(items.reduce((sum, item) => sum + (Number(item.estimated_unit_cost_cny) - Number(item.procurement_cost)) * Number(item.quantity || 0), 0) * 100) / 100
      : "";
    xml = setCell(xml, "J11", totalProcurement, 'IF(COUNT(P13:P999)<COUNT(K13:K999),"",SUMPRODUCT(P13:P999,K13:K999))');
    xml = setCell(xml, "P11", "成本差价总额（CNY）");
    xml = setCell(xml, "Q11", totalCostDifference, 'IF(OR(COUNT(J13:J999)<COUNT(K13:K999),COUNT(P13:P999)<COUNT(K13:K999)),"",SUMPRODUCT(J13:J999,K13:K999)-SUMPRODUCT(P13:P999,K13:K999))');
    xml = setCell(xml, "P12", "采购单价（CNY）");
    xml = setCell(xml, "Q12", "成本差价（CNY/件）");
    xml = setCell(xml, "R12", "仓库备注");
  } else {
    xml = setCell(xml, "J11", totalEstimatedCost, 'IF(COUNT(J13:J999)<COUNT(K13:K999),"",SUMPRODUCT(J13:J999,K13:K999))');
  }
  for (let index = 0; index < Math.max(items.length, 9); index += 1) {
    const row = 13 + index;
    const item = items[index];
    const warehouseDescription = item?.description_zh?.trim() || "";
    const lineAttachments = item ? (options.requirementAttachments || []).filter((attachment) => attachment.lineNumber === (item.line_number ?? index + 1)) : [];
    const warehouseAttention = item ? [item.preparation_requirement ? `理货要求：${item.preparation_requirement}` : "", item.internal_note ? `销售备注：${item.internal_note}` : "", lineAttachments.length ? `理货图片：${lineAttachments.length} 张，点击缩略图查看原图` : ""].filter(Boolean).join("\n") : "";
    const valuesForRow: Array<[string, unknown]> = item ? [
      [`B${row}`, index + 1], [`C${row}`, item.product_type_snapshot || item.item_name || ""], [`E${row}`, item.brand || ""], [`F${row}`, item.model || ""],
      [`G${row}`, item.quality || ""], [`H${row}`, item.description || ""], [`J${row}`, typeof item.estimated_unit_cost_cny === "number" && Number.isFinite(item.estimated_unit_cost_cny) ? Number(item.estimated_unit_cost_cny) : ""],
      [`K${row}`, Number(item.quantity || 0)], [`L${row}`, warehouseDescription], [`N${row}`, warehouseAttention],
    ] : [[`B${row}`, ""], [`C${row}`, ""], [`E${row}`, ""], [`F${row}`, ""], [`G${row}`, ""], [`H${row}`, ""], [`J${row}`, ""], [`K${row}`, ""], [`L${row}`, ""], [`N${row}`, ""]];
    for (const [cell, value] of valuesForRow) xml = setCell(xml, cell, value);
    if (options.includeProcurement) {
      const purchasePrice = item?.procurement_cost_confirmed && typeof item.procurement_cost === "number" && Number.isFinite(item.procurement_cost)
        ? Number(item.procurement_cost) : "";
      const costDifference = typeof purchasePrice === "number" && typeof item?.estimated_unit_cost_cny === "number" && Number.isFinite(item.estimated_unit_cost_cny)
        ? Math.round((Number(item.estimated_unit_cost_cny) - purchasePrice) * 100) / 100 : "";
      xml = setCell(xml, `P${row}`, purchasePrice);
      xml = setCell(xml, `Q${row}`, costDifference);
      xml = setCell(xml, `R${row}`, item?.warehouse_note || "");
      if (item?.warehouse_note) xml = withCellStyle(xml, `R${row}`, styles.nStyle);
    }
    if (item) {
      if (warehouseDescription) xml = withCellStyle(xml, `L${row}`, styles.descriptionStyle);
      if (warehouseAttention) xml = withCellStyle(xml, `N${row}`, styles.nStyle);
      const attentionLines = warehouseAttention.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 34)), 0);
      const warehouseNoteLines = item?.warehouse_note ? Math.max(1, Math.ceil(item.warehouse_note.length / 24)) : 0;
      const lines = Math.max(Math.ceil(warehouseDescription.length / 28), attentionLines, warehouseNoteLines);
      const imageRows = Math.ceil(lineAttachments.length / 3);
      if (lines > 0 || imageRows > 0) xml = withRowHeight(xml, row, Math.max(28, 18 + lines * 11, imageRows ? 44 * imageRows : 0));
    }
  }
  if (options.includeProcurement) {
    const lastProcurementRow = 12 + Math.max(items.length, 9);
    for (let row = 12; row <= lastProcurementRow; row += 1) {
      for (const column of ["P", "Q", "R"]) xml = withProcurementBorder(xml, `${column}${row}`, styles.procurementBorderStyles);
    }
  }
  const buffer = finishTemplate(opened.cfb, opened.entry, xml);
  const lineRows = new Map(items.map((item, index) => [item.line_number ?? index + 1, 12 + index]));
  const attachments = (options.requirementAttachments || []).map((attachment) => ({
    ...attachment,
    rowIndex: attachment.lineNumber === null ? undefined : lineRows.get(attachment.lineNumber),
  }));
  if (attachments.some((attachment) => attachment.lineNumber !== null && attachment.rowIndex === undefined)) {
    throw new Error("理货图片关联的产品项不存在，请刷新备货单后重试导出");
  }
  return addStockRequirementImages(buffer, attachments);
}

