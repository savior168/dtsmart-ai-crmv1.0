import * as XLSX from "xlsx";

export type ProductImportNormalized = {
  sku: string;
  name_zh: string;
  name_en: string;
  brand: string;
  model: string;
  part_type: string;
  quality: string;
  color: string;
  packaging: string;
  description_zh: string;
  description_en: string;
  aliases: string[];
  unit: string;
  minimum_order_quantity: number;
  procurement_cny: number | null;
  packaging_cny: number | null;
  other_cost_cny: number | null;
  sale_usd: number | null;
};

export type ProductImportCandidate = {
  source_sheet: string;
  source_row: number;
  source_cell: string;
  source_values: unknown[];
  normalized_data: ProductImportNormalized;
  status: "VALID" | "REVIEW" | "ERROR";
  issues: string[];
};

const aliases: Record<keyof Omit<ProductImportNormalized, "aliases">, string[]> = {
  sku: ["sku", "货号", "产品编码", "商品编码", "型号编码"],
  name_zh: ["中文名称", "商品名称", "产品名称", "品名", "items", "item"],
  name_en: ["英文名称", "english name", "item name"],
  brand: ["品牌", "brand", "产品品牌"],
  model: ["型号", "model", "models", "产品型号"],
  part_type: ["产品类型", "配件类型", "类型", "category", "type"],
  quality: ["质量", "品质", "quality", "产品质量", "产品质量（展示给客户）"],
  color: ["颜色", "color", "colour"],
  packaging: ["包装", "包装规格", "package", "packaging"],
  description_zh: ["中文描述", "后端描述", "产品质量/描述中文（展示给后端）"],
  description_en: ["英文描述", "description", "产品描述（展示给客户）"],
  unit: ["单位", "unit"],
  minimum_order_quantity: ["moq", "起订量", "最小起订量", "minimum quantity"],
  procurement_cny: ["采购价", "成本价", "成本单价", "人民币价格", "rmb", "cny", "price", "单价"],
  packaging_cny: ["人民币包装费", "包装费", "包装成本"],
  other_cost_cny: ["人民币其他成本", "其他费用", "其他成本"],
  sale_usd: ["美元售价", "销售参考价", "usd", "unit price"],
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function canonical(value: unknown) {
  return text(value).toLowerCase().replace(/[\s_\-（）()：:]/g, "");
}

function findColumn(headers: unknown[], names: string[]) {
  const wanted = names.map(canonical);
  return headers.findIndex((header) => {
    const value = canonical(header);
    return Boolean(value) && wanted.some((name) => value === name || value.includes(name));
  });
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(text(value).replace(/[￥¥$,]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function validate(normalized: ProductImportNormalized) {
  const issues: string[] = [];
  if (!normalized.sku) issues.push("缺少唯一SKU，请核对后填写");
  if (!normalized.name_zh) issues.push("缺少商品名称");
  if (normalized.procurement_cny === null && normalized.packaging_cny === null && normalized.other_cost_cny === null && normalized.sale_usd === null) issues.push("缺少可识别的人民币成本或美元销售参考价");
  if (normalized.procurement_cny !== null && normalized.procurement_cny < 0) issues.push("人民币采购价不能为负数");
  if (normalized.sale_usd !== null && normalized.sale_usd < 0) issues.push("美元销售参考价不能为负数");
  if (!Number.isFinite(normalized.minimum_order_quantity) || normalized.minimum_order_quantity <= 0) issues.push("起订量必须大于0");
  return issues;
}

function emptyNormalized(): ProductImportNormalized {
  return {
    sku: "", name_zh: "", name_en: "", brand: "", model: "", part_type: "", quality: "", color: "",
    packaging: "", description_zh: "", description_en: "", aliases: [], unit: "PCS", minimum_order_quantity: 1,
    procurement_cny: null, sale_usd: null,
    packaging_cny: null, other_cost_cny: null,
  };
}

function cellAddress(row: number, column: number) {
  return XLSX.utils.encode_cell({ r: row, c: column });
}

function parseTabularSheet(sheetName: string, rows: unknown[][], headerIndex: number, columns: Record<string, number>) {
  const output: ProductImportCandidate[] = [];
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!row.some((value) => text(value))) continue;
    const normalized = emptyNormalized();
    for (const key of Object.keys(columns) as Array<keyof typeof columns>) {
      const column = columns[key];
      if (column < 0) continue;
      const value = row[column];
      if (key === "procurement_cny" || key === "packaging_cny" || key === "other_cost_cny" || key === "sale_usd") normalized[key] = number(value);
      else if (key === "minimum_order_quantity") normalized.minimum_order_quantity = number(value) || 1;
      else if (key === "unit") normalized.unit = text(value).toUpperCase() || "PCS";
      else if (key in normalized && key !== "aliases") (normalized[key as keyof Omit<ProductImportNormalized, "aliases" | "minimum_order_quantity" | "procurement_cny" | "packaging_cny" | "other_cost_cny" | "sale_usd">] as string) = text(value);
    }
    if (!normalized.name_zh) normalized.name_zh = [normalized.part_type, normalized.brand, normalized.model, normalized.quality, normalized.color].filter(Boolean).join(" ");
    const issues = validate(normalized);
    output.push({
      source_sheet: sheetName,
      source_row: rowIndex + 1,
      source_cell: columns.procurement_cny >= 0 ? cellAddress(rowIndex, columns.procurement_cny) : columns.sale_usd >= 0 ? cellAddress(rowIndex, columns.sale_usd) : cellAddress(rowIndex, 0),
      source_values: row,
      normalized_data: normalized,
      status: issues.length ? "REVIEW" : "VALID",
      issues,
    });
  }
  return output;
}

function parseMatrixSheet(sheetName: string, rows: unknown[][]) {
  const output: ProductImportCandidate[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    for (let column = 0; column < row.length; column += 1) {
      const price = number(row[column]);
      if (price === null || price === 0 || price > 100000 || (price > 30000 && price < 60000)) continue;
      const left = row.slice(0, column).map(text).filter(Boolean).slice(-3);
      if (!left.length) continue;
      const above: string[] = [];
      for (let scan = Math.max(0, rowIndex - 4); scan < rowIndex; scan += 1) {
        const label = text(rows[scan]?.[column]);
        if (label) above.push(label);
      }
      const normalized = emptyNormalized();
      normalized.name_zh = [...left, ...above.slice(-2)].join(" ");
      normalized.model = left[left.length - 1] || "";
      normalized.part_type = sheetName;
      normalized.quality = above.slice(-1)[0] || "";
      normalized.procurement_cny = price;
      const issues = validate(normalized);
      issues.push("矩阵报价已识别，但必须补充唯一SKU并核对型号、品质及价格含义");
      output.push({
        source_sheet: sheetName,
        source_row: rowIndex + 1,
        source_cell: cellAddress(rowIndex, column),
        source_values: row,
        normalized_data: normalized,
        status: "REVIEW",
        issues: [...new Set(issues)],
      });
    }
  }
  return output;
}

export function parseProductWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: false, cellDates: true, dense: false });
  const candidates: ProductImportCandidate[] = [];
  const sheets: Array<{ name: string; source_rows: number; candidates: number; mode: "TABULAR" | "MATRIX" | "EMPTY" }> = [];
  let sourceRowCount = 0;
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, raw: true });
    const nonEmptyRows = rows.filter((row) => row.some((value) => text(value))).length;
    sourceRowCount += nonEmptyRows;
    let bestHeader = -1;
    let bestColumns: Record<string, number> = {};
    let bestScore = 0;
    for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
      const headers = rows[index] || [];
      const columns: Record<string, number> = {};
      for (const [key, names] of Object.entries(aliases)) columns[key] = findColumn(headers, names);
      const score = ["sku", "name_zh", "model", "brand", "procurement_cny", "packaging_cny", "other_cost_cny", "sale_usd"].filter((key) => columns[key] >= 0).length;
      if (score > bestScore) { bestScore = score; bestHeader = index; bestColumns = columns; }
    }
    const parsed = bestScore >= 3 && (bestColumns.procurement_cny >= 0 || bestColumns.packaging_cny >= 0 || bestColumns.other_cost_cny >= 0 || bestColumns.sale_usd >= 0)
      ? parseTabularSheet(sheetName, rows, bestHeader, bestColumns)
      : parseMatrixSheet(sheetName, rows);
    candidates.push(...parsed);
    sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, mode: parsed.length ? (bestScore >= 3 ? "TABULAR" : "MATRIX") : "EMPTY" });
  }
  return { sheet_count: workbook.SheetNames.length, source_row_count: sourceRowCount, candidates, sheets };
}

export function validateNormalizedProduct(input: unknown): { normalized: ProductImportNormalized; issues: string[] } {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const normalized = emptyNormalized();
  normalized.sku = text(value.sku).toUpperCase();
  normalized.name_zh = text(value.name_zh);
  normalized.name_en = text(value.name_en);
  normalized.brand = text(value.brand);
  normalized.model = text(value.model);
  normalized.part_type = text(value.part_type);
  normalized.quality = text(value.quality);
  normalized.color = text(value.color);
  normalized.packaging = text(value.packaging);
  normalized.description_zh = text(value.description_zh);
  normalized.description_en = text(value.description_en);
  normalized.aliases = Array.isArray(value.aliases) ? value.aliases.map(text).filter(Boolean) : text(value.aliases).split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  normalized.unit = text(value.unit).toUpperCase() || "PCS";
  normalized.minimum_order_quantity = number(value.minimum_order_quantity) || 1;
  normalized.procurement_cny = number(value.procurement_cny);
  normalized.packaging_cny = number(value.packaging_cny);
  normalized.other_cost_cny = number(value.other_cost_cny);
  normalized.sale_usd = number(value.sale_usd);
  return { normalized, issues: validate(normalized) };
}
