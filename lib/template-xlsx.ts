import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
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
  destination_country?: string | null;
  stocking_requirements?: string | null;
  status_note?: string | null;
  order_change_note?: string | null;
  expected_ready_at?: string | null;
  shipped_at?: string | null;
  delivery_recipient?: string | null;
  delivery_phone?: string | null;
  delivery_email?: string | null;
  delivery_address?: string | null;
  created_at: string;
  salesperson?: { name?: string | null; email?: string | null } | null;
};

const PI_TEMPLATE = path.join(process.cwd(), "assets", "templates", "DT-Smart_PI_Template.xlsx");
const STOCK_TEMPLATE = path.join(process.cwd(), "assets", "templates", "Warehouse_Stock_Template.xlsx");

// Keep the template writer directly executable by Node's TypeScript-strip test.
const stockSpecificationLabels: Record<string, string> = {
  assembly: "交付形态", panel_subtype: "显示技术细分", size_grade: "尺寸规格", fingerprint_support: "指纹功能", glass_grade: "玻璃或盖板版本",
  capacity_mah: "标称容量（mAh）", cell_material: "电芯材料", health_grade: "拆机电池健康度", diagnostic_support: "跑诊断支持情况", certification: "认证信息",
  assembly_scope: "装配范围", frame_structure: "一体或分体", included_parts: "随附配件", market_version: "区域版本",
  component_position: "配件位置", connector_variant: "接口或排线版本",
};

function stockSpecificationText(value: Record<string, string> | null | undefined) {
  return Object.entries(value || {})
    .filter(([key, entry]) => key !== "color_source" && typeof entry === "string" && entry.trim())
    .map(([key, entry]) => `${stockSpecificationLabels[key] || key}：${entry}`)
    .join(" · ");
}

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

function stockTextStyles(cfb: ReturnType<typeof XLSX.CFB.read>) {
  const entry = XLSX.CFB.find(cfb, "/xl/styles.xml");
  if (!entry?.content) throw new Error("备货模板缺少样式定义");
  let xml = Buffer.from(entry.content).toString("utf8");
  xml = xml.replace('&quot;采购成本 ∑= &quot;', '&quot;总成本价（人民币）∑= &quot;');
  const fonts = xml.match(/<fonts count="(\d+)"[^>]*>([\s\S]*?)<\/fonts>/);
  const cellXfs = xml.match(/<cellXfs count="(\d+)"[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!fonts || !cellXfs) throw new Error("备货模板样式结构不完整");
  const attentionFont = Number(fonts[1]);
  const itemNoteFont = attentionFont + 1;
  xml = xml.replace(fonts[0], `<fonts count="${attentionFont + 2}">${fonts[2]}<font><b/><sz val="10"/><color rgb="FF9A3412"/><name val="微软雅黑"/></font><font><sz val="9"/><color rgb="FF986C47"/><name val="微软雅黑"/></font></fonts>`);
  const existing = [...cellXfs[2].matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map((match) => match[0]);
  if (existing.length !== Number(cellXfs[1]) || !existing[24] || !existing[31] || !existing[56]) throw new Error("备货模板基础样式已变更，请核对模板");
  const clone = (source: number, fontId: number | null) => {
    let style = existing[source];
    if (fontId !== null) style = style.replace(/fontId="\d+"/, `fontId="${fontId}"`).replace("<xf ", '<xf applyFont="1" ');
    if (/<alignment\b/.test(style)) style = style.replace(/<alignment\b[^>]*\/>/, (alignment) => alignment.includes("wrapText=") ? alignment.replace(/wrapText="\d+"/, 'wrapText="1"') : alignment.replace("/>", ' wrapText="1"/>'));
    else style = style.replace(/\/>$/, '><alignment vertical="center" wrapText="1"/></xf>');
    return style;
  };
  const kStyle = existing.length;
  const nStyle = kStyle + 1;
  const contactStyle = nStyle + 1;
  const descriptionStyle = contactStyle + 1;
  const additions = clone(24, attentionFont) + clone(56, itemNoteFont) + clone(31, null) + clone(55, null);
  xml = xml.replace(cellXfs[0], `<cellXfs count="${existing.length + 4}">${cellXfs[2]}${additions}</cellXfs>`);
  entry.content = Buffer.from(xml, "utf8");
  return { kStyle, nStyle, contactStyle, descriptionStyle };
}

function withCellStyle(xml: string, reference: string, style: number) {
  return xml.replace(new RegExp(`(<c\\b[^>]*\\br="${reference}"[^>]*\\bs=")\\d+("[^>]*>)`), `$1${style}$2`);
}

function withRowHeight(xml: string, row: number, height: number) {
  return xml.replace(new RegExp(`(<row\\b[^>]*\\br="${row}"[^>]*\\bht=")([^"]+)(")`), `$1${height}$3`);
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

export async function buildStockWorkbook(stock: StockExportData, items: (QuoteItem & { procurement_cost_confirmed?: boolean; estimated_unit_cost_cny?: number | null; received_quantity?: number; warehouse_supplier_code?: string | null; internal_note?: string | null })[]) {
  if (items.length > 987) throw new Error("备货模板最多支持987条产品明细");
  const opened = await openTemplate(STOCK_TEMPLATE);
  let xml = opened.xml;
  const styles = stockTextStyles(opened.cfb);
  const changes = String(stock.order_change_note || "").split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.、)]|[⑴⑵⑶])\s*/, "").trim()).filter(Boolean);
  const values: Array<[string, unknown]> = [
    ["B3", stock.salesperson?.name || stock.salesperson?.email || ""], ["E3", stock.created_at.slice(0, 10)],
    ["G3", stock.warehouse_reference_number || stock.order_number], ["H3", stock.customer_short_name], ["K3", /^[A-Z]{2}$/.test(stock.destination_country || "") ? new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(stock.destination_country || "") || stock.destination_country : stock.destination_country || ""],
    ["M3", stock.expected_ready_at?.slice(0, 10) || ""], ["N3", stock.shipped_at?.slice(0, 10) || ""],
    ["K4", stock.stocking_requirements?.trim() || "常规理货"],
    ["C5", changes[0] || ""], ["C6", changes[1] || ""], ["C7", changes.slice(2).join("；")],
    ["D9", [`姓名：${stock.delivery_recipient || "—"}　电话：${stock.delivery_phone || "—"}`, `邮箱：${stock.delivery_email || "—"}`, `地址：${stock.delivery_address || "—"}`].join("\n")],
  ];
  for (const [cell, value] of values) xml = setCell(xml, cell, value);
  xml = withCellStyle(withRowHeight(xml, 9, 57), "D9", styles.contactStyle);
  if (stock.stocking_requirements?.trim() && stock.stocking_requirements.trim() !== "常规理货") xml = withCellStyle(xml, "K4", styles.kStyle);
  xml = setCell(xml, "B11", "", "SUM(K13:K999)");
  for (const [cell, label] of [
    ["G12", "产品质量"], ["H12", "产品描述"], ["J12", "成本单价（人民币）"],
    ["K12", "数量"], ["N12", "理货要求／仓库备注"],
  ] as const) xml = setCell(xml, cell, label);
  const totalEstimatedCost = items.every((item) => typeof item.estimated_unit_cost_cny === "number" && Number.isFinite(item.estimated_unit_cost_cny))
    ? Math.round(items.reduce((sum, item) => sum + Number(item.estimated_unit_cost_cny) * Number(item.quantity || 0), 0) * 100) / 100
    : "";
  xml = setCell(xml, "J11", totalEstimatedCost, "IF(COUNT(J13:J999)<COUNT(K13:K999),\"\",SUMPRODUCT(J13:J999,K13:K999))");
  for (let index = 0; index < Math.max(items.length, 9); index += 1) {
    const row = 13 + index;
    const item = items[index];
    const warehouseDescription = item ? [item.description_zh, item.product_color_snapshot ? `颜色：${item.product_color_snapshot}` : "", stockSpecificationText(item.product_specifications_snapshot)].filter(Boolean).join("；") : "";
    const warehouseAttention = item ? [item.preparation_requirement ? `理货要求：${item.preparation_requirement}` : "", item.internal_note ? `仓库备注：${item.internal_note}` : ""].filter(Boolean).join("；") : "";
    const valuesForRow: Array<[string, unknown]> = item ? [
      [`B${row}`, index + 1], [`C${row}`, item.product_type_snapshot || item.item_name || ""], [`E${row}`, item.brand || ""], [`F${row}`, item.model || ""],
      [`G${row}`, item.quality || ""], [`H${row}`, item.description || ""], [`J${row}`, typeof item.estimated_unit_cost_cny === "number" && Number.isFinite(item.estimated_unit_cost_cny) ? Number(item.estimated_unit_cost_cny) : ""],
      [`K${row}`, Number(item.quantity || 0)], [`L${row}`, warehouseDescription], [`N${row}`, warehouseAttention],
    ] : [[`B${row}`, ""], [`C${row}`, ""], [`E${row}`, ""], [`F${row}`, ""], [`G${row}`, ""], [`H${row}`, ""], [`J${row}`, ""], [`K${row}`, ""], [`L${row}`, ""], [`N${row}`, ""]];
    for (const [cell, value] of valuesForRow) xml = setCell(xml, cell, value);
    if (item) {
      if (warehouseDescription) xml = withCellStyle(xml, `L${row}`, styles.descriptionStyle);
      if (warehouseAttention) xml = withCellStyle(xml, `N${row}`, styles.nStyle);
      const lines = Math.max(Math.ceil(warehouseDescription.length / 28), Math.ceil(warehouseAttention.length / 34));
      if (lines > 0) xml = withRowHeight(xml, row, Math.max(28, 18 + lines * 11));
    }
  }
  return finishTemplate(opened.cfb, opened.entry, xml);
}
