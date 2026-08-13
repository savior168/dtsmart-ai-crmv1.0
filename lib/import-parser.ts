export type ImportRow = Record<string, string | number | null>;

type SheetRows = { name: string; rows: string[][] };

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\"") {
      if (quoted && text[i + 1] === "\"") { cell += "\""; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((value) => String(value || "").trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((value) => String(value || "").trim())) rows.push(row);
  return rows;
}

function u16(view: DataView, offset: number) { return view.getUint16(offset, true); }
function u32(view: DataView, offset: number) { return view.getUint32(offset, true); }

async function unzip(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("无效的 XLSX 文件");

  const count = u16(view, eocd + 10), central = u32(view, eocd + 16);
  let pos = central;
  const files = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (u32(view, pos) !== 0x02014b50) break;
    const method = u16(view, pos + 10), size = u32(view, pos + 20);
    const nameLen = u16(view, pos + 28), extraLen = u16(view, pos + 30), commentLen = u16(view, pos + 32);
    const local = u32(view, pos + 42);
    const name = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nameLen));
    const localName = u16(view, local + 26), localExtra = u16(view, local + 28);
    const start = local + 30 + localName + localExtra;
    let raw = bytes.slice(start, start + size);
    if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (method === 0 || method === 8) files.set(name, new TextDecoder().decode(raw));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function parseXml(xml: string) {
  return new DOMParser().parseFromString(xml, "text/xml");
}

function xmlText(xml: string) {
  const doc = parseXml(`<root>${xml}</root>`);
  return Array.from(doc.querySelectorAll("t")).map((node) => node.textContent || "").join("");
}

function colIndex(ref: string) {
  let n = 0;
  for (const c of ref.match(/[A-Z]+/)?.[0] || "") n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}

function decodeEntities(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#10;/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

function workbookSheets(files: Map<string, string>) {
  const workbook = parseXml(files.get("xl/workbook.xml") || "<workbook/>");
  const rels = parseXml(files.get("xl/_rels/workbook.xml.rels") || "<Relationships/>");
  const relMap = new Map<string, string>();
  rels.querySelectorAll("Relationship").forEach((rel) => {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (!id || !target) return;
    relMap.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\.\//, "")}`);
  });

  const result: Array<{ name: string; path: string }> = [];
  workbook.querySelectorAll("sheet").forEach((sheet) => {
    const name = sheet.getAttribute("name") || "Sheet";
    const rid = sheet.getAttribute("r:id");
    const path = rid ? relMap.get(rid) : undefined;
    if (path && files.has(path)) result.push({ name, path });
  });

  if (!result.length) {
    [...files.keys()]
      .filter((key) => /^xl\/worksheets\/sheet\d+\.xml$/.test(key))
      .sort()
      .forEach((path, index) => result.push({ name: `Sheet${index + 1}`, path }));
  }
  return result;
}

async function xlsxSheets(buffer: ArrayBuffer): Promise<SheetRows[]> {
  const files = await unzip(buffer);
  const sharedDoc = parseXml(files.get("xl/sharedStrings.xml") || "<sst/>");
  const shared = Array.from(sharedDoc.querySelectorAll("si")).map((node) => Array.from(node.querySelectorAll("t")).map((t) => t.textContent || "").join(""));
  return workbookSheets(files).map(({ name, path }) => {
    const doc = parseXml(files.get(path) || "<worksheet/>");
    const rows = Array.from(doc.querySelectorAll("sheetData > row")).map((row) => {
      const values: string[] = [];
      row.querySelectorAll("c").forEach((cell) => {
        const idx = colIndex(cell.getAttribute("r") || "");
        const type = cell.getAttribute("t");
        const raw = cell.querySelector("v")?.textContent || "";
        const inline = cell.querySelector("is")?.innerHTML || "";
        values[idx] = decodeEntities(type === "s" ? shared[Number(raw)] || "" : type === "inlineStr" ? xmlText(inline) : raw);
      });
      return values;
    }).filter((row) => row.some((value) => String(value || "").trim()));
    return { name, rows };
  });
}

function rowsToObjects(rows: string[][]) {
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => String(header || "").trim());
  if (!headers.some(Boolean)) return [];
  return rows.slice(1)
    .filter((row) => row.some((value) => String(value || "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header || `列${index + 1}`, row[index] ?? ""])));
}

function value(row: ImportRow, ...keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== "") return String(row[key]).trim();
  return "";
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function dedupeRows(rows: ImportRow[]) {
  const seen = new Set<string>();
  const unique: ImportRow[] = [];
  for (const row of rows) {
    const name = normalizeText(value(row, "名称", "公司名称", "商店名称"));
    const phone = normalizePhone([value(row, "区号"), value(row, "完整号码", "电话")].filter(Boolean).join(" "));
    const email = normalizeText(value(row, "邮箱"));
    const keys = [phone ? `name-phone:${name}|${phone}` : "", email ? `name-email:${name}|${email}` : ""].filter(Boolean);
    if (name && keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    unique.push(row);
  }
  return unique;
}

export async function parseImportFile(file: File): Promise<ImportRow[]> {
  const lower = file.name.toLowerCase();
  const rows = lower.endsWith(".csv")
    ? rowsToObjects(csvRows(await file.text()))
    : (await xlsxSheets(await file.arrayBuffer())).flatMap((sheet) => rowsToObjects(sheet.rows));
  return dedupeRows(rows);
}

export function mapImportRow(row: ImportRow) {
  const tags = [
    value(row, "标签"),
    value(row, "搜索关键词"),
    value(row, "商店类型"),
    value(row, "商店状态"),
  ].flatMap((item) => item.split(/[,，/]/)).map((item) => item.trim()).filter(Boolean);

  return {
    company_name: value(row, "名称", "公司名称", "商店名称") || value(row, "商店名称"),
    contact_name: value(row, "联系人"),
    country: value(row, "国家"),
    phone: [value(row, "区号"), value(row, "完整号码", "电话")].filter(Boolean).join(" "),
    email: value(row, "邮箱"),
    website: value(row, "商家官网网址", "官网"),
    google_url: value(row, "谷歌网址", "Google网址"),
    address: value(row, "商店地址", "地址"),
    category: value(row, "分类", "商店类型"),
    source: "EXCEL_IMPORT",
    tags,
    ai_score: Number(value(row, "商店分数", "AI评分")) || null,
    ai_level: "",
    status: "UNCLAIMED",
    import_meta: {
      store_name: value(row, "商店名称"),
      product_image: value(row, "商品图片"),
      created_at: value(row, "创建时间"),
    },
  };
}
