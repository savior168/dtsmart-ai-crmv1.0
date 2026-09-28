import * as XLSX from "xlsx";

export const PRICE_IMPORT_HEADERS = ["系统SKU", "价格项目", "新价格", "起订量", "生效日期", "价格来源"] as const;
export type PriceKind = "PROCUREMENT" | "PACKAGING" | "OTHER_COST" | "SALE_REFERENCE";
export type PriceImportRow = {
  source_row: number;
  sku: string;
  price_kind: PriceKind;
  currency: "CNY" | "USD";
  amount: number;
  minimum_quantity: number;
  effective_from: string;
  source_note: string;
};

const kinds: Record<string, PriceKind> = {
  "采购价": "PROCUREMENT",
  "包装费": "PACKAGING",
  "其他成本": "OTHER_COST",
  "美元销售参考价": "SALE_REFERENCE",
};

function decimal(value: unknown, places: number, positive: boolean) {
  const raw = String(value ?? "").trim();
  if (!new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${places}})?$`).test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed >= 100000000000000 || (positive ? parsed <= 0 : parsed < 0)) return null;
  return parsed;
}

function date(value: unknown) {
  let raw: string;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    raw = `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  } else {
    raw = String(value ?? "").trim();
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? "" : raw;
}

export function parseProductPriceImport(buffer: Buffer, today = new Date().toISOString().slice(0, 10)): PriceImportRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", dense: false, cellDates: false });
  if (workbook.SheetNames.length !== 1 || workbook.SheetNames[0] !== "价格更新") throw new Error("请使用价格更新专用模板，仅保留“价格更新”工作表");
  const sheet = workbook.Sheets["价格更新"];
  if (!sheet?.["!ref"]) throw new Error("价格更新表为空");
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  if (range.e.r > 500 || range.e.c > 5) throw new Error("每次最多导入 500 条价格，且不得增加模板外的列");
  for (let column = 0; column < PRICE_IMPORT_HEADERS.length; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: column })];
    if (String(cell?.v ?? "").trim() !== PRICE_IMPORT_HEADERS[column]) throw new Error(`第 ${column + 1} 列表头必须是“${PRICE_IMPORT_HEADERS[column]}”`);
  }
  const rows: PriceImportRow[] = [];
  const seen = new Set<string>();
  for (let index = 1; index <= range.e.r; index += 1) {
    const cells = PRICE_IMPORT_HEADERS.map((_, column) => sheet[XLSX.utils.encode_cell({ r: index, c: column })]);
    if (cells.every((cell) => cell?.v === undefined || String(cell.v).trim() === "")) continue;
    const line = index + 1;
    if (cells.some((cell) => Boolean(cell?.f))) throw new Error(`第 ${line} 行包含公式；请粘贴核准后的实际值`);
    const sku = String(cells[0]?.v ?? "").trim().toUpperCase();
    const price_kind = kinds[String(cells[1]?.v ?? "").trim()];
    const amount = decimal(cells[2]?.v, 4, false);
    const minimum_quantity = decimal(cells[3]?.v, 3, true);
    const effective_from = date(cells[4]?.v);
    const source_note = String(cells[5]?.v ?? "").trim();
    if (!/^ZK-\d{4}-\d{6}$/.test(sku)) throw new Error(`第 ${line} 行缺少有效的系统 SKU；供应商编号不能代替系统 SKU`);
    if (!price_kind) throw new Error(`第 ${line} 行价格项目无效`);
    if (amount === null) throw new Error(`第 ${line} 行新价格无效；空白与 0 不等价`);
    if (minimum_quantity === null) throw new Error(`第 ${line} 行起订量必须大于 0`);
    if (!effective_from || effective_from > today) throw new Error(`第 ${line} 行生效日期无效或晚于今天`);
    if (!source_note || source_note.length > 500) throw new Error(`第 ${line} 行必须填写不超过 500 字的价格来源`);
    const key = `${sku}\u0000${price_kind}\u0000${minimum_quantity}`;
    if (seen.has(key)) throw new Error(`第 ${line} 行与文件内其他行重复：同一 SKU、价格项目和起订量`);
    seen.add(key);
    rows.push({ source_row: line, sku, price_kind, currency: price_kind === "SALE_REFERENCE" ? "USD" : "CNY", amount, minimum_quantity, effective_from, source_note });
  }
  if (!rows.length) throw new Error("价格更新表没有有效数据行");
  return rows;
}
