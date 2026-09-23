import * as XLSX from "xlsx";


export type ProductImportNormalized = {
  sku: string;
  supplier_identifier: string;
  category_id: string;
  specifications: Record<string, string>;
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

const aliases: Partial<Record<keyof ProductImportNormalized, string[]>> = {
  sku: ["sku", "货号", "产品编码", "商品编码", "型号编码"],
  supplier_identifier: ["供应商编号", "供应商代码"],
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
  if (typeof value !== "number") {
    const raw = text(value).replace(/^[￥¥$]\s*/, "");
    if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return null;
    value = Number(raw.replace(/,/g, ""));
  }
  const parsed = value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function validate(normalized: ProductImportNormalized) {
  const issues: string[] = [];
  if (!normalized.name_zh) issues.push("缺少商品名称");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized.category_id)) issues.push("请先选择商品分类并核对专有规格");
  if (normalized.procurement_cny === null && normalized.packaging_cny === null && normalized.other_cost_cny === null && normalized.sale_usd === null) issues.push("缺少可识别的人民币成本或美元销售参考价");
  if (normalized.procurement_cny !== null && normalized.procurement_cny < 0) issues.push("人民币采购价不能为负数");
  if (normalized.sale_usd !== null && normalized.sale_usd < 0) issues.push("美元销售参考价不能为负数");
  if (!Number.isFinite(normalized.minimum_order_quantity) || normalized.minimum_order_quantity <= 0) issues.push("起订量必须大于0");
  return issues;
}

function emptyNormalized(): ProductImportNormalized {
  return {
    sku: "", supplier_identifier: "", category_id: "", specifications: {}, name_zh: "", name_en: "", brand: "", model: "", part_type: "", quality: "", color: "",
    packaging: "", description_zh: "", description_en: "", aliases: [], unit: "PCS", minimum_order_quantity: 1,
    procurement_cny: null, sale_usd: null,
    packaging_cny: null, other_cost_cny: null,
  };
}

function sheetSupplierIdentifier(rows: unknown[][]) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 8); rowIndex += 1) {
    const row = rows[rowIndex] || [];
    for (let column = 0; column < row.length - 1; column += 1) {
      if (!/^(代码|供应商编号|供应商代码)$/.test(text(row[column]))) continue;
      const identifier = text(row[column + 1]);
      if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(identifier)) return { identifier, rowIndex };
    }
  }
  return { identifier: "", rowIndex: -1 };
}

function cellAddress(row: number, column: number) {
  return XLSX.utils.encode_cell({ r: row, c: column });
}

function parseTabularSheet(sheetName: string, rows: unknown[][], headerIndex: number, columns: Record<string, number>, supplierIdentifier: string) {
  const output: ProductImportCandidate[] = [];
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!row.some((value) => text(value))) continue;
    const normalized = emptyNormalized();
    const fieldIssues: string[] = [];
    for (const key of Object.keys(columns) as Array<keyof typeof columns>) {
      const column = columns[key];
      if (column < 0) continue;
      const value = row[column];
      if (key === "procurement_cny" || key === "packaging_cny" || key === "other_cost_cny" || key === "sale_usd") {
        normalized[key] = number(value);
        if (text(value) && normalized[key] === null) fieldIssues.push(`${key}价格无效，请核对原单元格`);
      }
      else if (key === "minimum_order_quantity") {
        normalized.minimum_order_quantity = text(value) ? (number(value) ?? 0) : 1;
        if (text(value) && normalized.minimum_order_quantity <= 0) fieldIssues.push("起订量无效，请核对原单元格");
      }
      else if (key === "unit") normalized.unit = text(value).toUpperCase() || "PCS";
      else if (key in normalized && key !== "aliases") (normalized[key as keyof Omit<ProductImportNormalized, "aliases" | "minimum_order_quantity" | "procurement_cny" | "packaging_cny" | "other_cost_cny" | "sale_usd">] as string) = text(value);
    }
    if (!normalized.supplier_identifier) normalized.supplier_identifier = supplierIdentifier;
    if (!normalized.name_zh) normalized.name_zh = [normalized.part_type, normalized.brand, normalized.model, normalized.quality, normalized.color].filter(Boolean).join(" ");
    const issues = [...new Set([...validate(normalized), ...fieldIssues,
      "来源明细须由采购人员逐行确认商品规格、币种及价格后才能发布"])];
    output.push({
      source_sheet: sheetName,
      source_row: rowIndex + 1,
      source_cell: columns.procurement_cny >= 0 ? cellAddress(rowIndex, columns.procurement_cny) : columns.sale_usd >= 0 ? cellAddress(rowIndex, columns.sale_usd) : cellAddress(rowIndex, 0),
      source_values: row,
      normalized_data: normalized,
      status: "REVIEW",
      issues,
    });
  }
  return output;
}

function parseMatrixSheet(sheetName: string, rows: unknown[][], metadataRow: number) {
  const output: ProductImportCandidate[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (rowIndex === metadataRow) continue;
    const row = rows[rowIndex] || [];
    for (let column = 0; column < row.length; column += 1) {
      const price = number(row[column]);
      if (price === null || price === 0 || price > 100000 || (price > 30000 && price < 60000)) continue;
      const left = row.slice(0, column).map(text).filter(Boolean);
      if (!left.length) continue;
      const normalized = emptyNormalized();
      // A neighboring cell may be another price, a subtotal, a supplier ID,
      // or a different product. Supplier IDs may also vary by column within
      // the same matrix, so a sheet-level ID is not safe to prefill here.
      // The numeric cell is only a lead, not a proven price. Keep its exact
      // address and raw row for review; do not prefill a monetary field.
      const issues = validate(normalized);
      issues.push("仅定位到数字单元格；尚未证明它是该商品的采购价。请对照原表标题、机型、版本和供应商后补全，不能直接发布");
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

function parseMatrixTextClues(sheetName: string, rows: unknown[][], columns: number[], firstRow: number, existing: ProductImportCandidate[]) {
  const output: ProductImportCandidate[] = [];
  const known = new Set(existing.map((row) => row.source_cell));
  for (let rowIndex = firstRow; rowIndex < rows.length; rowIndex += 1) {
    for (const column of columns) {
      const raw = text(rows[rowIndex]?.[column]);
      const address = cellAddress(rowIndex, column);
      if (!raw || !/[0-9]/.test(raw) || known.has(address)) continue;
      const normalized = emptyNormalized();
      normalized.description_zh = raw;
      output.push({
        source_sheet: sheetName, source_row: rowIndex + 1, source_cell: address,
        source_values: rows[rowIndex] || [], normalized_data: normalized,
        status: "REVIEW",
        issues: ["矩阵原文仅为待拆解线索；型号、品质、币种和每项价格尚未一一配对，不能直接发布"],
      });
      known.add(address);
    }
  }
  return output;
}

function parseRjScreenClues(rows: unknown[][]): ProductImportCandidate[] {
  const output: ProductImportCandidate[] = [];
  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
    const raw = text(rows[rowIndex]?.[2]);
    if (!/^R\s*J\s*[（(]\s*瑞桔\s*[)）]/i.test(raw)) continue;
    const normalized = emptyNormalized();
    normalized.part_type = "屏幕";
    normalized.description_zh = raw;
    // In this supplier's C-column, “可搬/搬 IC” describes capability. It is
    // not evidence of completed chip transfer or an extra service charge.
    if (/可搬|搬\s*i\s*c|🉑搬/i.test(raw)) normalized.specifications.ic_transfer_support = "支持";
    // Only a single terminal price token is safe to preserve as a proposed
    // purchase amount. All other layouts, including multiple prices, remain
    // unpriced review clues. The source model is never auto-normalized here.
    const priced = raw.match(/(?:[:：,，;；]|\s)(\d+(?:\.\d+)?)$/);
    if (priced) normalized.procurement_cny = number(priced[1]);
    output.push({
      source_sheet: "iPhone品牌屏幕",
      source_row: rowIndex + 1,
      source_cell: cellAddress(rowIndex, 2),
      source_values: rows[rowIndex] || [],
      normalized_data: normalized,
      status: "REVIEW",
      issues: [...new Set([...validate(normalized), "RJ屏幕原文中的机型、显示技术、包装及是否缺货须核对；可搬IC不是已搬IC，不能自动发布"])],
    });
  }
  return output;
}

function parseOfficialIPhoneScreenBattery(rows: unknown[][], supplierIdentifier: string): ProductImportCandidate[] {
  const output: ProductImportCandidate[] = [];
  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
    for (const column of [5, 6]) {
      const raw = text(rows[rowIndex]?.[column]);
      if (!raw) continue;
      const match = raw.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*元?$/);
      if (!match || !match[1].trim()) continue;
      const normalized = emptyNormalized();
      normalized.supplier_identifier = supplierIdentifier;
      normalized.name_zh = match[1].trim();
      normalized.brand = "Apple";
      normalized.part_type = column === 5 ? "屏幕" : "电池";
      normalized.minimum_order_quantity = 0;
      normalized.procurement_cny = Number(match[2]);
      if (/产品价格含包装，官方原白盒包装/.test(text(rows[0]?.[4]))) {
        normalized.packaging = "官方原白盒（来源报价已含）";
        normalized.packaging_cny = 0;
      }
      output.push({ source_sheet: "官方屏幕-电池", source_row: rowIndex + 1, source_cell: cellAddress(rowIndex, column), source_values: rows[rowIndex] || [], normalized_data: normalized, status: "REVIEW", issues: [...validate(normalized), "请核对原文机型、官方件属性及包装含义，不得自动推断颜色或其他规格"] });
    }
  }
  return output;
}

function unparsedOfficialCells(rows: unknown[][], parsed: ProductImportCandidate[]) {
  const found = new Set(parsed.map((candidate) => candidate.source_cell));
  const unparsed: string[] = [];
  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
    for (const column of [5, 6]) {
      if (text(rows[rowIndex]?.[column]) && !found.has(cellAddress(rowIndex, column))) unparsed.push(cellAddress(rowIndex, column));
    }
  }
  return unparsed;
}

function parseSamsungDismantledScreens(rows: unknown[][], supplierIdentifier: string): ProductImportCandidate[] {
  const output: ProductImportCandidate[] = [];
  for (let rowIndex = 4; rowIndex < rows.length; rowIndex += 1) {
    const rawPrice = rows[rowIndex]?.[6];
    const model = text(rows[rowIndex]?.[7]);
    if (!model || !text(rawPrice)) continue;
    const price = number(rawPrice);
    if (price === null || price === 0) continue;
    const normalized = emptyNormalized();
    normalized.supplier_identifier = supplierIdentifier;
    normalized.name_zh = `Samsung ${model} 拆机屏幕`;
    normalized.brand = "Samsung";
    normalized.model = model;
    normalized.part_type = "屏幕";
    normalized.quality = "拆机";
    normalized.minimum_order_quantity = 0;
    normalized.procurement_cny = price;
    if (/三星拆机屏幕\s*包装\+1\.5/.test(text(rows[2]?.[6]))) normalized.packaging_cny = 1.5;
    output.push({ source_sheet: "LCD-SM S系列拆机", source_row: rowIndex + 1, source_cell: cellAddress(rowIndex, 6), source_values: rows[rowIndex] || [], normalized_data: normalized, status: "REVIEW", issues: [...validate(normalized), "请核对拆机品相、带框状态及包装费；未明确的信息保持空白"] });
  }
  return output;
}

function unparsedSamsungScreenRows(rows: unknown[][], parsed: ProductImportCandidate[]) {
  const found = new Set(parsed.map((candidate) => candidate.source_row));
  const unparsed: string[] = [];
  for (let rowIndex = 4; rowIndex < rows.length; rowIndex += 1) {
    if ((text(rows[rowIndex]?.[6]) || text(rows[rowIndex]?.[7])) && !found.has(rowIndex + 1)) unparsed.push(cellAddress(rowIndex, text(rows[rowIndex]?.[6]) ? 6 : 7));
  }
  return unparsed;
}

function parseIPhoneFactoryBatteryBlock(rows: unknown[][]): ProductImportCandidate[] {
  const output: ProductImportCandidate[] = [];
  // In this source, A5:P5 repeats 型号/单价 for eight different battery or
  // cell lines. The supplier explicitly states MOQ 50 per model in B1.
  const headers = rows[4] || [];
  const variants = rows[3] || [];
  const hasFiftyPieceMoq = /每个型号\s*50\s*个起订/.test(text(rows[0]?.[1]));
  for (let modelColumn = 0; modelColumn <= 14; modelColumn += 2) {
    if (text(headers[modelColumn]) !== "型号" || text(headers[modelColumn + 1]) !== "单价") continue;
    const lineLabel = text(variants[modelColumn]);
    if (!lineLabel) continue;
    for (let rowIndex = 5; rowIndex <= 38 && rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const model = text(row[modelColumn]);
      const price = number(row[modelColumn + 1]);
      if (!model || model === "/" || price === null || price <= 0 || price > 10000) continue;
      const normalized = emptyNormalized();
      normalized.name_zh = `iPhone ${model} ${lineLabel}`;
      normalized.brand = "Apple";
      normalized.model = model;
      normalized.part_type = lineLabel.includes("电芯") ? "电芯" : "电池";
      normalized.quality = lineLabel;
      normalized.minimum_order_quantity = hasFiftyPieceMoq ? 50 : 0;
      normalized.procurement_cny = price;
      if (normalized.part_type === "电池" && /普通电池包装盒\+1\.5/.test(text(rows[0]?.[17])) && /诊断电池包装盒\+2\.5/.test(text(rows[0]?.[22]))) {
        // Packaging is optional in this sheet, so preserve the offered fee
        // without silently adding it to every customer's base cost.
        normalized.packaging = lineLabel.includes("诊断") ? "可选诊断电池盒 +2.5 CNY" : "可选普通电池盒 +1.5 CNY";
      }
      output.push({
        source_sheet: "iPhone电池单价", source_row: rowIndex + 1,
        source_cell: cellAddress(rowIndex, modelColumn + 1), source_values: row,
        normalized_data: normalized, status: "REVIEW",
        issues: [...validate(normalized), "请核对电池与电芯、包装费用、供应商身份及可交付型号"],
      });
    }
  }
  return output;
}

function parseIPhoneDiagnosticBatteries(rows: unknown[][]) {
  const output: ProductImportCandidate[] = [];
  const unparsed: string[] = [];
  const add = (rowIndex: number, modelColumn: number, priceColumn: number, label: string, capacityColumn: number, moq: number | null) => {
    const row = rows[rowIndex] || [];
    const model = text(row[modelColumn]);
    const rawPrice = text(row[priceColumn]);
    if (!model || model === "/") return;
    if (!rawPrice || rawPrice === "/") {
      // A missing price has no real source cell. Anchor review to the model
      // cell instead; a literal '/' is itself a real price-cell value.
      if (rawPrice === "/" || (modelColumn === 9 && rowIndex >= 47 && rowIndex <= 62)) unparsed.push(cellAddress(rowIndex, rawPrice ? priceColumn : modelColumn));
      return;
    }
    const price = number(row[priceColumn]);
    if (price === null || price <= 0 || price > 10000) {
      unparsed.push(cellAddress(rowIndex, priceColumn));
      return;
    }
    const normalized = emptyNormalized();
    normalized.name_zh = `iPhone ${model} 电池 ${label}`;
    normalized.brand = "Apple";
    normalized.model = model;
    normalized.part_type = "电池";
    normalized.quality = label;
    normalized.procurement_cny = price;
    normalized.minimum_order_quantity = moq ?? 0;
    const capacity = text(row[capacityColumn]);
    if (capacity && capacity !== "/" && /^\d+(?:mAh)?$/i.test(capacity)) normalized.specifications = { capacity_mah: capacity.replace(/mAh$/i, "") };
    const issues = [...validate(normalized), "请核对电池容量、跑诊断状态、供应商身份及售后条件；不得将不同报价区混为同一品质"];
    if (moq === null) issues.push("该报价区写明可散拿，但未给出明确起订量，请人工确认");
    if (rowIndex === 100 && priceColumn === 9) issues.push("高容价低于同型号标准容量价，疑似原表异常，请向供应商核对");
    output.push({ source_sheet: "iPhone电池单价", source_row: rowIndex + 1, source_cell: cellAddress(rowIndex, priceColumn), source_values: row, normalized_data: normalized, status: "REVIEW", issues });
  };
  if (text(rows[46]?.[0]) === "Model" && text(rows[46]?.[4]) === "RMB PRICE" && text(rows[46]?.[9]) === "Model") {
    const moq = /每个型号\s*50\s*个起订/.test(text(rows[45]?.[15])) ? 50 : null;
    for (let rowIndex = 47; rowIndex <= 72 && rowIndex < rows.length; rowIndex += 1) {
      add(rowIndex, 0, 4, "跑诊断显示二手·标容", 2, moq);
      add(rowIndex, 0, 7, "跑诊断显示二手·高容", 5, moq);
      add(rowIndex, 9, 13, "跑诊断显示正品", 11, moq);
    }
  } else unparsed.push("A47");
  if (text(rows[75]?.[4]).includes("型号") && text(rows[75]?.[6]).includes("价格") && text(rows[75]?.[9]).includes("价格")) {
    const moq = /每个型号\s*10\s*个起订/.test(text(rows[74]?.[15])) ? 10 : null;
    for (let rowIndex = 76; rowIndex <= 116 && rowIndex < rows.length; rowIndex += 1) {
      if (rowIndex >= 77 && rowIndex <= 91) add(rowIndex, 0, 2, "市场高容量·跑诊断显示二手", 1, null);
      add(rowIndex, 4, 6, "市场纯钴电芯·标准容量", 5, moq);
      add(rowIndex, 7, 9, "市场纯钴电芯·高容量", 8, moq);
    }
  } else unparsed.push("E76");
  return { parsed: output, unparsed };
}

function unparsedIPhoneBatteryRows(rows: unknown[][]) {
  const output: string[] = [];
  for (let rowIndex = 39; rowIndex < rows.length; rowIndex += 1) {
    // These fixed source sections are explanatory notes, section titles, and
    // column headers; their text is not an unpriced saleable battery.
    if ((rowIndex >= 39 && rowIndex <= 46) || (rowIndex >= 73 && rowIndex <= 75) || rowIndex === 117) continue;
    if ((rowIndex >= 47 && rowIndex <= 72) || (rowIndex >= 76 && rowIndex <= 116)) continue;
    const first = (rows[rowIndex] || []).findIndex((value) => text(value));
    if (first >= 0) output.push(cellAddress(rowIndex, first));
  }
  return output;
}

function parseMacbookBatteries(rows: unknown[][], supplierIdentifier: string) {
  const output: ProductImportCandidate[] = [];
  const unparsed: string[] = [];
  const variants: Array<{ column: number; label: string; specifications: Record<string, string> }> = [
    { column: 7, label: "国产第三方全新（三元材质）", specifications: { cell_material: "三元材质" } },
    { column: 9, label: "原装拆机（容量90%以上）", specifications: { health_grade: "90%以上" } },
    { column: 10, label: "原装拆机（容量95%以上）", specifications: { health_grade: "95%以上" } },
  ];
  if (!text(rows[2]?.[6]).includes("电池型号") || !text(rows[2]?.[7]).includes("全新批发价") || !text(rows[2]?.[9]).includes("原装拆机")) {
    return { parsed: output, unparsed: ["G3"] };
  }
  for (let rowIndex = 3; rowIndex <= 35 && rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const model = text(row[6]);
    if (!model) continue;
    for (const variant of variants) {
      const raw = text(row[variant.column]);
      if (!raw || raw === "/") continue;
      const price = number(row[variant.column]);
      if (price === null || price <= 0 || price > 10000) {
        unparsed.push(cellAddress(rowIndex, variant.column));
        continue;
      }
      const normalized = emptyNormalized();
      normalized.supplier_identifier = supplierIdentifier;
      normalized.name_zh = `MacBook ${model} 电池 ${variant.label}`;
      normalized.brand = "Apple";
      normalized.model = model;
      normalized.part_type = "电池";
      normalized.quality = variant.label;
      normalized.specifications = variant.specifications;
      normalized.minimum_order_quantity = 0;
      normalized.procurement_cny = price;
      if (/产品带包装/.test(text(rows[0]?.[6]))) {
        normalized.packaging = "来源报价已带包装";
        normalized.packaging_cny = 0;
      }
      output.push({
        source_sheet: "Battery-Macbook", source_row: rowIndex + 1,
        source_cell: cellAddress(rowIndex, variant.column), source_values: row,
        normalized_data: normalized, status: "REVIEW",
        issues: [...validate(normalized), "请核对电池型号与适配机型、品质/容量及MOQ；来源英文描述可能与型号不一致，未自动带入"],
      });
    }
  }
  return { parsed: output, unparsed };
}

function parseMacbookScreens(rows: unknown[][], supplierIdentifier: string) {
  const parsed: ProductImportCandidate[] = [];
  const unparsed: string[] = [];
  const header = rows[1] || [];
  if (text(header[5]) !== "产品型号" || text(header[6]) !== "产品质量" || text(header[9]) !== "最新单价" || text(header[10]) !== "京东方液晶（发货快）") {
    return { parsed, unparsed: ["F2"] };
  }
  // Only the first quoted assembly block has a stable model/quality/price
  // mapping. K is an alternative offer with mixed descriptions, not a
  // blanket surcharge or the same product's second price.
  for (let rowIndex = 2; rowIndex <= 26 && rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const model = text(row[5]);
    const quality = text(row[6]);
    const price = number(row[9]);
    if (text(row[10])) unparsed.push(cellAddress(rowIndex, 10));
    if (!model && !quality && !text(row[9])) continue;
    if (!model || !quality || price === null || price <= 0 || price > 10000) {
      unparsed.push(cellAddress(rowIndex, 9));
      continue;
    }
    const normalized = emptyNormalized();
    normalized.supplier_identifier = supplierIdentifier;
    normalized.name_zh = `MacBook ${model} 屏幕 ${quality}`;
    normalized.brand = "Apple";
    normalized.model = model;
    normalized.part_type = "屏幕";
    normalized.quality = quality;
    normalized.description_zh = [text(row[4]), text(row[7]), text(row[8]), text(row[11]), text(row[12])].filter(Boolean).join("；");
    normalized.minimum_order_quantity = 0;
    normalized.procurement_cny = price;
    if (/包装免费/.test(text(rows[0]?.[5]))) {
      normalized.packaging = "单个包装或飞机盒（来源标注免费）";
      normalized.packaging_cny = 0;
    }
    parsed.push({
      source_sheet: "LCD-Macbook", source_row: rowIndex + 1,
      source_cell: cellAddress(rowIndex, 9), source_values: row,
      normalized_data: normalized, status: "REVIEW",
      issues: [...validate(normalized), "请按原表核对兼容型号、颜色、屏幕组成和起订量；K列是另一种报价，不得与J列混价或自动拆成颜色SKU"],
    });
  }
  // The remainder contains LCD-only prices, parts and compatibility notes
  // with different layouts. Surface every nonempty row for manual coverage.
  for (let rowIndex = 27; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const column = row.findIndex((value, index) => index >= 4 && text(value));
    if (column >= 0) unparsed.push(cellAddress(rowIndex, column));
  }
  return { parsed, unparsed };
}

function parseRearCovers(sheetName: "iPhone拆机后盖" | "三星拆机后盖", rows: unknown[][], supplierIdentifier: string) {
  const parsed: ProductImportCandidate[] = [];
  const unparsed: string[] = [];
  const isIPhone = sheetName === "iPhone拆机后盖";
  const sections = isIPhone
    ? [
      { column: 8, first: 2, last: 11, scope: "后盖玻璃带NFC", region: "" },
      { column: 10, first: 2, last: 29, scope: "后盖壳/中框", region: "欧版" },
      { column: 11, first: 2, last: 29, scope: "后盖壳/中框", region: "美版" },
      { column: 13, first: 2, last: 22, scope: "后盖单壳/中框不带配件", region: "欧版/国行" },
      { column: 14, first: 2, last: 22, scope: "后盖单壳/中框不带配件", region: "美版" },
    ]
    : [
      { column: 9, first: 2, last: 26, scope: "后盖玻璃（S系列）", region: "" },
      { column: 11, first: 2, last: 26, scope: "后盖玻璃（折叠系列）", region: "" },
    ];
  const headerMatches = isIPhone
    ? text(rows[0]?.[8]) === "后盖玻璃带NFC" && text(rows[0]?.[10]) === "后盖壳/中框" && text(rows[0]?.[13]) === "后盖单壳/中框不带配件"
    : text(rows[0]?.[9]) === "三星后盖玻璃 -S系列" && text(rows[0]?.[11]) === "三星后盖玻璃 -折叠系列";
  for (const section of sections) {
    for (let rowIndex = section.first; rowIndex <= section.last && rowIndex < rows.length; rowIndex += 1) {
      const raw = text(rows[rowIndex]?.[section.column]);
      if (!raw) continue;
      const address = cellAddress(rowIndex, section.column);
      if (!headerMatches) { unparsed.push(address); continue; }
      // Only an entire cell containing one source model and one price is safe
      // to structure. Colors, sums and multi-model cells stay unresolved.
      const match = isIPhone
        ? /^(1[1-7](?:plus|pro|pm|p|mini|air|e)?)\s*(\d{1,4}(?:\.\d+)?)$/i.exec(raw)
        : /^((?:s|n|f)\d{1,2}(?:fe|u|puls|plus|\+)?(?:\s*5g)?)\s+(\d{1,4}(?:\.\d+)?)$/i.exec(raw);
      const price = match ? number(match[2]) : null;
      if (!match || price === null || price <= 0) { unparsed.push(address); continue; }
      const model = match[1].trim();
      const normalized = emptyNormalized();
      normalized.supplier_identifier = supplierIdentifier;
      normalized.name_zh = `${isIPhone ? "iPhone" : "Samsung"} ${model} ${section.scope}${section.region ? `（${section.region}）` : ""}`;
      normalized.brand = isIPhone ? "Apple" : "Samsung";
      normalized.model = model;
      normalized.part_type = "后盖";
      normalized.specifications = { assembly_scope: section.scope, ...(section.region ? { market_version: section.region } : {}) };
      normalized.procurement_cny = price;
      normalized.minimum_order_quantity = 0;
      if (isIPhone && /统一静电袋\+白盒单个包装，包装\+1rmb/i.test(text(rows[0]?.[15]))) {
        normalized.packaging = "静电袋+白盒";
        normalized.packaging_cny = 1;
      }
      parsed.push({
        source_sheet: sheetName, source_row: rowIndex + 1, source_cell: address,
        source_values: rows[rowIndex] || [], normalized_data: normalized, status: "REVIEW",
        issues: [...validate(normalized), "请核对来源型号、适用颜色、拆机品质及起订量；单价仅对应当前源单元格"],
      });
    }
  }
  if (!headerMatches) unparsed.unshift(isIPhone ? "I1" : "J1");
  return { parsed, unparsed };
}

function parseOriginalIPhoneScreens(rows: unknown[][]) {
  const parsed: ProductImportCandidate[] = [];
  const unparsed: string[] = [];
  const headerMatches = /统一白盒包装\+2rmb/i.test(text(rows[0]?.[3]))
    && text(rows[1]?.[13]) === "备注"
    && /原FOG跑诊断价格/.test(text(rows[1]?.[14]));
  // E/H/L contain mixed free-text offers: several models, finishes and
  // accessory surcharges in one cell. Keep all of them in the coverage list.
  for (const column of [4, 7, 11]) {
    for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
      if (text(rows[rowIndex]?.[column])) unparsed.push(cellAddress(rowIndex, column));
    }
  }
  for (let rowIndex = 2; rowIndex <= 15 && rowIndex < rows.length; rowIndex += 1) {
    const model = text(rows[rowIndex]?.[13]);
    const rawPrice = text(rows[rowIndex]?.[14]);
    if (!model && !rawPrice) continue;
    const address = cellAddress(rowIndex, 14);
    const price = number(rows[rowIndex]?.[14]);
    if (!headerMatches || !/^(?:1[2-7](?:MINI|PRO|PM|AIR)?)$/i.test(model)
      || price === null || price <= 0 || /缺货/.test(text(rows[rowIndex]?.[15]))) {
      unparsed.push(address);
      continue;
    }
    const normalized = emptyNormalized();
    normalized.name_zh = `iPhone ${model} 屏幕 原FOG跑诊断`;
    normalized.brand = "Apple";
    normalized.model = model;
    normalized.part_type = "屏幕";
    normalized.quality = "原FOG跑诊断（来源表报价标签）";
    normalized.procurement_cny = price;
    normalized.packaging = "白盒（泡棉）";
    normalized.packaging_cny = 2;
    normalized.description_zh = text(rows[rowIndex]?.[15]);
    normalized.minimum_order_quantity = 0;
    parsed.push({
      source_sheet: "LCD-原装iPhone", source_row: rowIndex + 1, source_cell: address,
      source_values: rows[rowIndex] || [], normalized_data: normalized, status: "REVIEW",
      issues: [...validate(normalized), "请核对原FOG品质、诊断支持、P2供应商归属及起订量；来源价仅对应当前源单元格"],
    });
  }
  if (!headerMatches) unparsed.unshift("O2");
  return { parsed, unparsed };
}

function parseSamsungABacklitScreens(rows: unknown[][], supplierIdentifier: string) {
  const parsed: ProductImportCandidate[] = [];
  const unparsed: string[] = [];
  const header = rows[2] || [];
  if (["产品类型", "产品品牌", "产品系列", "型号", "产品质量", "产品描述（通用型号）", "成本单价"].some((label, offset) => text(header[5 + offset]) !== label)) {
    return { parsed, unparsed: ["F3"] };
  }
  for (let rowIndex = 3; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (![5, 6, 7, 8, 9, 10, 11].some((column) => text(row[column]))) continue;
    const model = text(row[8]);
    const quality = text(row[9]);
    const price = number(row[11]);
    if (text(row[5]) !== "LCD" || text(row[6]) !== "For SM" || !model || !quality || price === null || price <= 0) {
      unparsed.push(cellAddress(rowIndex, 8));
      continue;
    }
    const normalized = emptyNormalized();
    normalized.supplier_identifier = supplierIdentifier;
    normalized.name_zh = `Samsung ${model} 背光屏 ${quality}`;
    normalized.brand = "Samsung";
    normalized.model = model;
    normalized.part_type = "屏幕";
    normalized.quality = quality;
    normalized.description_zh = `${text(row[7])} ${text(row[10])}`.trim();
    normalized.specifications = { panel_subtype: "LCD背光" };
    normalized.minimum_order_quantity = 0;
    normalized.procurement_cny = price;
    if (/统一蓝色彩盒包装\+1/.test(text(rows[0]?.[5]))) {
      normalized.packaging = "统一蓝色彩盒";
      normalized.packaging_cny = 1;
    }
    parsed.push({
      source_sheet: "LCD-SM A系列背光屏", source_row: rowIndex + 1,
      source_cell: cellAddress(rowIndex, 11), source_values: row,
      normalized_data: normalized, status: "REVIEW",
      issues: [...validate(normalized), "请核对通用机型、盖板/排线版本及包装方式；来源 ORG 是品质标签，不等于已证实原厂正品"],
    });
  }
  return { parsed, unparsed };
}

function parseIPhoneSmallParts(rows: unknown[][], supplierIdentifier: string) {
  const parsed: ProductImportCandidate[] = [];
  const unparsed: string[] = [];
  const header = rows[2] || [];
  if (text(header[0]) !== "型号" || !text(header[1]).includes("尾插") || !text(header[15]).includes("大像头")) {
    return { parsed, unparsed: ["A3"] };
  }
  for (let rowIndex = 3; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const model = text(row[0]);
    if (!model) {
      if (row.slice(1, 16).some((value) => text(value))) unparsed.push(cellAddress(rowIndex, 0));
      continue;
    }
    for (let column = 1; column <= 15; column += 1) {
      const raw = text(row[column]);
      if (!raw || raw === "/") continue;
      const price = number(row[column]);
      // 原/仿双价格、组合价和“带闪”等附属条件不能压成单价。
      if (price === null || price <= 0 || price > 10000) {
        unparsed.push(cellAddress(rowIndex, column));
        continue;
      }
      const partLabel = text(header[column]);
      const normalized = emptyNormalized();
      normalized.supplier_identifier = supplierIdentifier;
      normalized.name_zh = `iPhone ${model} ${partLabel}`;
      normalized.brand = "Apple";
      normalized.model = model;
      normalized.part_type = partLabel;
      normalized.minimum_order_quantity = 0;
      // This sheet has no explicit currency header. Preserve the number only
      // in the raw source cell until the purchaser confirms its unit/currency.
      parsed.push({ source_sheet: "Spare parts-iphone ", source_row: rowIndex + 1,
        source_cell: cellAddress(rowIndex, column), source_values: row,
        normalized_data: normalized, status: "REVIEW",
        issues: [...validate(normalized), "源表未注明该列货币/计价单位和起订量；请核对原单元格数字后填写价格、品质及可交付规格"],
      });
    }
  }
  return { parsed, unparsed };
}

function parseSamsungAOledScreens(rows: unknown[][], supplierIdentifier: string) {
  const parsed: ProductImportCandidate[] = [];
  const unparsed: string[] = [];
  const header = rows[3] || [];
  if (text(header[5]) !== "型号/MOLED" || text(header[11]) !== "柔性MOLED/型号") return { parsed, unparsed: ["F4"] };
  for (let rowIndex = 4; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    for (const block of [{ model: 5, size: 4, variant: 6, prices: [7, 8] }, { model: 11, size: 10, variant: 12, prices: [13, 14] }]) {
      const model = text(row[block.model]);
      if (!model) continue;
      for (const column of block.prices) {
        const raw = text(row[column]);
        if (!raw || raw === "缺货") continue;
        const match = raw.match(/^(单片|带框)\s*(\d+(?:\.\d+)?)$/);
        if (!match) {
          unparsed.push(cellAddress(rowIndex, column));
          continue;
        }
        const normalized = emptyNormalized();
        normalized.supplier_identifier = supplierIdentifier;
        normalized.name_zh = `Samsung ${model} MOLED屏幕 ${match[1]}`;
        normalized.brand = "Samsung";
        normalized.model = model;
        normalized.part_type = "屏幕";
        normalized.minimum_order_quantity = 0;
        normalized.procurement_cny = Number(match[2]);
        if (/统一service pack包装\+1rmb/i.test(text(rows[0]?.[4]))) normalized.packaging_cny = 1;
        normalized.specifications = { panel_subtype: "MOLED", assembly: match[1] === "带框" ? "带框" : "单片" };
        const variant = text(row[block.variant]);
        if (variant === "全新") normalized.quality = "国产第三方全新";
        else if (variant) normalized.specifications.size_grade = variant;
        const diagonal = number(row[block.size]);
        if (diagonal !== null) normalized.description_zh = `源表尺寸：${diagonal} 英寸`;
        parsed.push({ source_sheet: "LCD-SM A系列OLED", source_row: rowIndex + 1,
          source_cell: cellAddress(rowIndex, column), source_values: row,
          normalized_data: normalized, status: "REVIEW",
          issues: [...validate(normalized), "请核对兼容机型、屏幕尺寸版本、缺货状态及包装；原表同格混合报价未自动拆分", "源表特别提示 OLED 屏升级兼容与售后风险，报价前须人工确认并向客户说明"],
        });
      }
    }
  }
  return { parsed, unparsed };
}

function parseSamsungARefurbishedScreens(rows: unknown[][]) {
  const parsed: ProductImportCandidate[] = [];
  const unparsed: string[] = [];
  if (text(rows[3]?.[4]) !== "型号" || text(rows[3]?.[5]) !== "单片单价" || text(rows[3]?.[6]) !== "中框单价"
      || text(rows[56]?.[4]) !== "型号" || text(rows[56]?.[5]) !== "单价") return { parsed, unparsed: ["E4", "E57"] };
  const sections = [
    { start: 4, end: 51, supplier: text(rows[4]?.[8]) === "代码" ? text(rows[4]?.[9]) : "", packaging: /包装\+1\.5/.test(text(rows[2]?.[4])) ? 1.5 : null, backlit: false },
    { start: 57, end: rows.length - 1, supplier: text(rows[57]?.[8]) === "代码" ? text(rows[57]?.[9]) : "", packaging: /包装\+1\.5/.test(text(rows[55]?.[4])) ? 1.5 : null, backlit: true },
  ];
  for (const section of sections) {
    for (let rowIndex = section.start; rowIndex <= section.end && rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const model = text(row[4]);
      const rawPrice = text(row[5]);
      if (!model && !rawPrice) continue;
      const price = number(row[5]);
      if (!model || price === null || price <= 0 || price > 10000) {
        unparsed.push(cellAddress(rowIndex, 5));
        continue;
      }
      const normalized = emptyNormalized();
      normalized.supplier_identifier = section.supplier;
      normalized.name_zh = `Samsung ${model} 换面屏幕单片${section.backlit ? "（背光屏）" : ""}`;
      normalized.brand = "Samsung";
      normalized.model = model;
      normalized.part_type = "屏幕";
      normalized.quality = "换面";
      normalized.specifications = { assembly: "单片" };
      if (section.backlit) normalized.specifications.panel_subtype = "背光屏";
      normalized.minimum_order_quantity = 0;
      normalized.procurement_cny = price;
      normalized.packaging_cny = section.packaging;
      normalized.description_zh = text(row[7]);
      parsed.push({ source_sheet: "LCD-SM A系列换面", source_row: rowIndex + 1,
        source_cell: cellAddress(rowIndex, 5), source_values: row,
        normalized_data: normalized, status: "REVIEW",
        issues: [...validate(normalized), "请核对机型版本、品质及售后；中框单价是独立加价项，未擅自推算带框成品价"],
      });
      if (text(row[6])) unparsed.push(cellAddress(rowIndex, 6));
    }
  }
  return { parsed, unparsed };
}

function parseIPadDisplayAssemblies(rows: unknown[][]) {
  const parsed: ProductImportCandidate[] = [];
  const unparsed: string[] = [];
  const lcdHeaders = ["全新", "拆机", "换盖板", "换背光", "原FOG", "OLED", "仿", "后压"];
  if (lcdHeaders.some((label, index) => text(rows[2]?.[index + 3]) !== label)
      || text(rows[29]?.[3]) !== "压金边" || text(rows[29]?.[6]) !== "铜膜") {
    return { parsed, unparsed: ["D3", "D30"] };
  }
  for (let rowIndex = 3; rowIndex <= 26 && rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const model = text(row[1]);
    if (!model || text(row[2]) !== "LCD") continue;
    for (let column = 3; column <= 10; column += 1) {
      const raw = text(row[column]);
      if (!raw) continue;
      const colorPrice = raw.match(/^(黑|白|蓝|红|金|银|紫|绿)[：:]\s*(\d+(?:\.\d+)?)$/);
      const price = colorPrice ? Number(colorPrice[2]) : number(row[column]);
      if (price === null || price <= 0 || price > 10000) {
        unparsed.push(cellAddress(rowIndex, column));
        continue;
      }
      const label = lcdHeaders[column - 3];
      const normalized = emptyNormalized();
      normalized.name_zh = `iPad ${model} 液晶总成 ${label}${colorPrice ? ` ${colorPrice[1]}` : ""}`;
      normalized.brand = "Apple";
      normalized.model = model;
      normalized.part_type = "屏幕";
      normalized.quality = label === "全新" ? "国产第三方全新" : label;
      if (colorPrice) normalized.color = colorPrice[1];
      normalized.specifications = { panel_subtype: label === "OLED" ? "OLED" : "LCD" };
      normalized.minimum_order_quantity = 0;
      normalized.procurement_cny = price;
      if (/统一白盒包装\+5rmb/.test(text(rows[1]?.[1]))) normalized.packaging_cny = 5;
      parsed.push({ source_sheet: "iPad触摸总成+液晶总成", source_row: rowIndex + 1,
        source_cell: cellAddress(rowIndex, column), source_values: row,
        normalized_data: normalized, status: "REVIEW",
        issues: [...validate(normalized), "请核对机型、品质、装配范围和供应商身份；源表未逐件明确颜色与起订量"],
      });
    }
  }
  for (let rowIndex = 30; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const model = text(row[1]);
    if (!model || text(row[2]) !== "触摸") continue;
    const rawPrice = text(row[3]);
    if (rawPrice) {
      const price = number(row[3]);
      if (price === null || price <= 0 || price > 10000) unparsed.push(cellAddress(rowIndex, 3));
      else {
        const normalized = emptyNormalized();
        normalized.name_zh = `iPad ${model} 触摸总成 压金边`;
        normalized.brand = "Apple";
        normalized.model = model;
        normalized.part_type = "触摸总成";
        normalized.quality = "压金边";
        normalized.minimum_order_quantity = 0;
        normalized.procurement_cny = price;
        if (/统一黄色气泡袋\+1rmb/.test(text(rows[28]?.[1]))) normalized.packaging_cny = 1;
        parsed.push({ source_sheet: "iPad触摸总成+液晶总成", source_row: rowIndex + 1,
          source_cell: cellAddress(rowIndex, 3), source_values: row,
          normalized_data: normalized, status: "REVIEW",
          issues: [...validate(normalized), "请核对触摸总成具体工艺、供应商和起订量；按键/OCA/铜膜加项未合并为成品价"],
        });
      }
    }
    for (const column of [4, 6, 7, 8]) if (text(row[column])) unparsed.push(cellAddress(rowIndex, column));
  }
  return { parsed, unparsed };
}

function parseJcDiagnosticProducts(rows: unknown[][]) {
  const parsed: ProductImportCandidate[] = [];
  const unparsed: string[] = [];
  if (text(rows[6]?.[5]) !== "型号" || !text(rows[6]?.[6]).includes("高容量")
      || text(rows[6]?.[9]) !== "型号" || !text(rows[6]?.[10]).includes("硬")
      || text(rows[27]?.[9]) !== "型号" || !text(rows[27]?.[10]).includes("柔")
      || text(rows[51]?.[9]) !== "型号") return { parsed, unparsed: ["F7", "J7", "J28", "J52"] };
  const add = (rowIndex: number, modelColumn: number, priceColumn: number, partType: "电池" | "屏幕", variant: string) => {
    const row = rows[rowIndex] || [];
    const model = text(row[modelColumn]);
    const rawPrice = text(row[priceColumn]);
    if (!model || !rawPrice) return;
    const price = number(row[priceColumn]);
    if (price === null || price <= 0 || price > 10000) {
      unparsed.push(cellAddress(rowIndex, priceColumn));
      return;
    }
    const normalized = emptyNormalized();
    normalized.name_zh = `iPhone ${model} JCID跑诊断${partType} ${variant}`;
    normalized.brand = "Apple";
    normalized.model = model;
    normalized.part_type = partType;
    normalized.quality = partType === "电池" ? `JCID跑诊断·${variant}` : "JCID跑诊断";
    normalized.minimum_order_quantity = 0;
    normalized.procurement_cny = price;
    const includedBox = partType === "电池" ? text(rows[3]?.[5]) : text(rows[rowIndex < 24 ? 3 : rowIndex < 48 ? 24 : 48]?.[9]);
    if (/带JC盒子/.test(includedBox)) {
      normalized.packaging = "JC盒子（来源报价已带）";
      normalized.packaging_cny = 0;
    }
    normalized.specifications = partType === "电池" ? { diagnostic_support: "JCID跑诊断" } : { panel_subtype: variant };
    parsed.push({ source_sheet: "JC跑诊断产品", source_row: rowIndex + 1,
      source_cell: cellAddress(rowIndex, priceColumn), source_values: row,
      normalized_data: normalized, status: "REVIEW",
      issues: [...validate(normalized), "请核对 JCID 型号、跑诊断能力、供应商身份和起订量；源表仅写带 JC 盒子，未拆分盒价"],
    });
  };
  for (let rowIndex = 7; rowIndex <= 21 && rowIndex < rows.length; rowIndex += 1) {
    add(rowIndex, 5, 6, "电池", "高容量");
    add(rowIndex, 5, 7, "电池", "标容量");
  }
  for (let rowIndex = 7; rowIndex <= 23 && rowIndex < rows.length; rowIndex += 1) add(rowIndex, 9, 10, "屏幕", "硬OLED");
  for (let rowIndex = 28; rowIndex <= 44 && rowIndex < rows.length; rowIndex += 1) add(rowIndex, 9, 10, "屏幕", "柔OLED");
  for (let rowIndex = 52; rowIndex < rows.length; rowIndex += 1) add(rowIndex, 9, 10, "屏幕", "INCELL");
  return { parsed, unparsed };
}

export function parseProductWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: false, cellDates: true, dense: false });
  const candidates: ProductImportCandidate[] = [];
  const sheets: Array<{ name: string; source_rows: number; candidates: number; unparsed_cells?: number; unparsed_addresses?: string[]; mode: "TABULAR" | "MATRIX" | "SOURCE_REVIEW" | "EMPTY" | "REFERENCE" }> = [];
  let sourceRowCount = 0;
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    // SheetJS otherwise starts arrays at the worksheet's !ref origin (which
    // may be D3), while our provenance and column rules use real A1 addresses.
    const sourceRange = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
    if (sourceRange.e.r >= 10000 || sourceRange.e.c >= 200) {
      throw new Error(`工作表“${sheetName}”有效范围超过 10000 行或 200 列，请先核对异常格式与来源文件`);
    }
    sourceRange.s = { r: 0, c: 0 };
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, raw: true, range: XLSX.utils.encode_range(sourceRange) });
    const nonEmptyRows = rows.filter((row) => row.some((value) => text(value))).length;
    const supplierMetadata = sheetSupplierIdentifier(rows);
    sourceRowCount += nonEmptyRows;
    // This known source sheet contains instructions, not saleable product rows.
    // Do not silently discard a generic "说明" sheet from another supplier.
    if (sheetName.trim() === "注意事项"
      || (sheetName.trim() === "填写说明" && text(rows[0]?.[0]) === "填写说明"
        && /系统SKU由数据库自动生成/.test(text(rows[1]?.[1])))) {
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: 0, mode: "REFERENCE" });
      continue;
    }
    if (sheetName === "官方屏幕-电池" || sheetName === "LCD-SM S系列拆机") {
      const parsed = sheetName === "官方屏幕-电池"
        ? parseOfficialIPhoneScreenBattery(rows, supplierMetadata.identifier)
        : parseSamsungDismantledScreens(rows, supplierMetadata.identifier);
      const unparsed = sheetName === "官方屏幕-电池" ? unparsedOfficialCells(rows, parsed) : unparsedSamsungScreenRows(rows, parsed);
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "iPhone电池单价") {
      const diagnostic = parseIPhoneDiagnosticBatteries(rows);
      const parsed = [...parseIPhoneFactoryBatteryBlock(rows), ...diagnostic.parsed];
      const unparsed = [...unparsedIPhoneBatteryRows(rows), ...diagnostic.unparsed];
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "Battery-Macbook") {
      const { parsed, unparsed } = parseMacbookBatteries(rows, supplierMetadata.identifier);
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "LCD-Macbook") {
      const { parsed, unparsed } = parseMacbookScreens(rows, supplierMetadata.identifier);
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "LCD-SM A系列背光屏") {
      const { parsed, unparsed } = parseSamsungABacklitScreens(rows, supplierMetadata.identifier);
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "Spare parts-iphone ") {
      const { parsed, unparsed } = parseIPhoneSmallParts(rows, supplierMetadata.identifier);
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "LCD-SM A系列OLED") {
      const { parsed, unparsed } = parseSamsungAOledScreens(rows, supplierMetadata.identifier);
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "LCD-SM A系列换面") {
      const { parsed, unparsed } = parseSamsungARefurbishedScreens(rows);
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "iPad触摸总成+液晶总成") {
      const { parsed, unparsed } = parseIPadDisplayAssemblies(rows);
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "JC跑诊断产品") {
      const { parsed, unparsed } = parseJcDiagnosticProducts(rows);
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "iPhone拆机后盖" || sheetName === "三星拆机后盖") {
      const { parsed, unparsed } = parseRearCovers(sheetName, rows, supplierMetadata.identifier);
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "LCD-原装iPhone") {
      const { parsed, unparsed } = parseOriginalIPhoneScreens(rows);
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, unparsed_cells: unparsed.length, unparsed_addresses: unparsed, mode: parsed.length ? "SOURCE_REVIEW" : "EMPTY" });
      continue;
    }
    if (sheetName === "iPhone品牌屏幕") {
      const parsed = [...parseMatrixSheet(sheetName, rows, supplierMetadata.rowIndex), ...parseRjScreenClues(rows)];
      // The supplier mixes price prose with product variants across many
      // non-adjacent columns. Keep every short, numbered source statement for
      // review; do not mistake its first number for a procurement amount.
      const width = Math.max(2, ...rows.map((row) => row.length));
      parsed.push(...parseMatrixTextClues(sheetName, rows, Array.from({ length: width - 2 }, (_, index) => index + 2), 2, parsed));
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, mode: "MATRIX" });
      continue;
    }
    if (sheetName === "LCD-SM  S系列+折叠系列" || sheetName === "国产后盖") {
      const parsed = parseMatrixSheet(sheetName, rows, supplierMetadata.rowIndex);
      const quoteColumns = sheetName === "国产后盖" ? [3, 4, 5, 6, 7, 8] : [7, 9, 14, 15, 16, 17, 18];
      parsed.push(...parseMatrixTextClues(sheetName, rows, quoteColumns, sheetName === "国产后盖" ? 3 : 4, parsed));
      candidates.push(...parsed);
      sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, mode: "MATRIX" });
      continue;
    }
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
      ? parseTabularSheet(sheetName, rows, bestHeader, bestColumns, supplierMetadata.identifier)
      : parseMatrixSheet(sheetName, rows, supplierMetadata.rowIndex);
    candidates.push(...parsed);
    sheets.push({ name: sheetName, source_rows: nonEmptyRows, candidates: parsed.length, mode: parsed.length ? (bestScore >= 3 ? "TABULAR" : "MATRIX") : "EMPTY" });
  }
  // An unparsed address must be reviewable, not only buried in a sheet-level
  // warning. Keep its exact source cell and entire raw row; never infer a
  // product, a monetary value, or a zero packaging charge from that text.
  const known = new Set(candidates.map((row) => `${row.source_sheet}\u0000${row.source_cell}`));
  for (const sheet of sheets) {
    const worksheet = workbook.Sheets[sheet.name];
    if (!worksheet || !sheet.unparsed_addresses?.length) continue;
    const sourceRange = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
    sourceRange.s = { r: 0, c: 0 };
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, raw: true, range: XLSX.utils.encode_range(sourceRange) });
    for (const address of new Set(sheet.unparsed_addresses)) {
      const key = `${sheet.name}\u0000${address}`;
      if (known.has(key)) continue;
      const cell = XLSX.utils.decode_cell(address);
      const raw = text(rows[cell.r]?.[cell.c]);
      if (!raw) throw new Error(`工作表“${sheet.name}”的未解析地址 ${address} 无原文，禁止生成失真复核行`);
      const normalized = emptyNormalized();
      normalized.description_zh = raw;
      candidates.push({
        source_sheet: sheet.name, source_row: cell.r + 1, source_cell: address,
        source_values: rows[cell.r] || [], normalized_data: normalized,
        status: "REVIEW", issues: ["原单元格尚未安全拆解；请核对商品、型号、规格、币种和每个价格，不得直接发布"],
      });
      known.add(key);
      sheet.candidates += 1;
    }
  }
  return { sheet_count: workbook.SheetNames.length, source_row_count: sourceRowCount, candidates, sheets };
}

export function validateNormalizedProduct(input: unknown): { normalized: ProductImportNormalized; issues: string[] } {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const specificationIssues: string[] = [];
  const priceIssues: string[] = [];
  if (value.specifications !== undefined && (typeof value.specifications !== "object" || value.specifications === null || Array.isArray(value.specifications))) specificationIssues.push("商品规格格式不正确");
  if (value.specifications && typeof value.specifications === "object" && !Array.isArray(value.specifications) && Object.values(value.specifications).some((entry) => typeof entry !== "string")) specificationIssues.push("商品规格值必须为文字");
  const normalized = emptyNormalized();
  normalized.sku = text(value.sku).toUpperCase();
  normalized.supplier_identifier = text(value.supplier_identifier);
  normalized.category_id = text(value.category_id);
  normalized.specifications = value.specifications && typeof value.specifications === "object" && !Array.isArray(value.specifications)
    ? Object.fromEntries(Object.entries(value.specifications).map(([key, entry]) => [key, text(entry)])) : {};
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
  normalized.minimum_order_quantity = text(value.minimum_order_quantity) ? (number(value.minimum_order_quantity) ?? 0) : 1;
  normalized.procurement_cny = number(value.procurement_cny);
  normalized.packaging_cny = number(value.packaging_cny);
  normalized.other_cost_cny = number(value.other_cost_cny);
  normalized.sale_usd = number(value.sale_usd);
  for (const [field, label] of [
    ["procurement_cny", "人民币采购价"], ["packaging_cny", "人民币包装费"],
    ["other_cost_cny", "人民币其他成本"], ["sale_usd", "美元销售参考价"],
  ] as const) {
    if (text(value[field]) && normalized[field] === null) priceIssues.push(`${label}格式无效，不能将原值静默清空`);
  }
  return { normalized, issues: [...validate(normalized), ...specificationIssues, ...priceIssues] };
}
