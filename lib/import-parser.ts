import { normalizeManualPhone } from "@/lib/contacts/manual-phone";
import { COUNTRY_OPTIONS, countryInfo } from "@/lib/countries";

export type ImportRow = Record<string, unknown>;

const importCountryCodes = new Set(COUNTRY_OPTIONS.map((option) => option.code));

export function normalizeImportCountry(raw: unknown) {
  const value = String(raw ?? "").trim();
  // Source spreadsheets sometimes append an explanatory region in a new line.
  const annotated = value.replace(/\s*[\r\n]+\s*[（(][\s\S]*$/, "").trim();
  return importCountryCodes.has(countryInfo(annotated).code) ? annotated : "";
}

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\"") {
      if (quoted && text[i + 1] === "\"") {
        cell += "\"";
        i++;
      } else {
        quoted = !quoted;
      }
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

function rowsToObjects(rows: string[][]) {
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => String(header || "").trim());
  if (!headers.some(Boolean)) return [];
  return rows.slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header || `列${index + 1}`, row[index] ?? ""])));
}

function value(row: ImportRow, ...keys: string[]) {
  const normalized = new Map(Object.entries(row).map(([key, item]) => [key.trim().toLowerCase(), item]));
  const semanticAliases: Record<string, string[]> = {
    name: ["名称", "公司名称", "商店名称", "店铺名称"],
    "company name": ["名称", "公司名称"],
    "store name": ["商店名称", "店铺名称"],
    country: ["国家", "国家/地区", "国家地区"],
    "country code": ["区号", "区号代码"],
    phone: ["完整号码", "完整电话", "电话"],
    "full phone": ["完整号码", "完整电话"],
    email: ["邮箱", "电子邮箱"],
    "e-mail": ["邮箱", "电子邮箱"],
    website: ["商家官网网址", "官网网址", "官网"],
    site: ["商家官网网址", "官网网址", "官网"],
    "google url": ["谷歌网址", "Google网址", "Google地图网址", "谷歌地图网址"],
    "google maps url": ["谷歌网址", "Google网址", "Google地图网址", "谷歌地图网址"],
    address: ["商店地址", "地址"],
    "store address": ["商店地址", "地址"],
    category: ["分类", "商店类型", "行业"],
    "store type": ["商店类型", "分类"],
    industry: ["行业", "行业关键词"],
    rating: ["商店分数", "商店评分", "评分"],
    "product image": ["商品图片", "图片网址", "商品图片网址"],
    image: ["商品图片", "图片网址", "商品图片网址"],
    tags: ["标签"],
    keyword: ["搜索关键词"],
    keywords: ["搜索关键词"],
    "store status": ["商店状态"],
    "created at": ["创建时间"],
    created_time: ["创建时间"],
  };
  const candidates = keys.flatMap((key) => [key, ...(semanticAliases[key.trim().toLowerCase()] || [])]);
  for (const key of candidates) {
    const direct = row[key];
    const loose = normalized.get(key.trim().toLowerCase());
    const found = direct ?? loose;
    if (found !== undefined && found !== null && String(found).trim() !== "") return String(found).trim();
  }
  return "";
}

export async function parseImportFile(file: File): Promise<ImportRow[]> {
  const lower = file.name.toLowerCase();
  const rows = lower.endsWith(".csv")
    ? rowsToObjects(csvRows(await file.text()))
    : await parseExcelWorkbook(await file.arrayBuffer());
  // 跨文件及单文件内的重复行统一在预览层标记，不能在解析阶段静默丢弃，
  // 否则重复数量和具体文件/行号都会不准确。
  return rows;
}

async function parseExcelWorkbook(buffer: ArrayBuffer): Promise<ImportRow[]> {
  // SheetJS simultaneously supports the OLE/BIFF structure used by legacy
  // .xls files and the ZIP/XML structure used by .xlsx. `raw: false` keeps
  // displayed phone numbers and identifiers instead of coercing them to
  // scientific notation.
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array", raw: false, cellDates: false });
  const dataSheets = workbook.SheetNames.includes("客户导入模板") ? ["客户导入模板"] : workbook.SheetNames.filter((name) => name !== "填写说明");
  return dataSheets.flatMap((name) => {
    const sheet = workbook.Sheets[name];
    if (sheet["!ref"]) {
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const header = String(sheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })]?.v ?? "");
        if (!/电话|whats\s*app|微信|wechat|phone/i.test(header)) continue;
        for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
          const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (cell?.t === "n" && typeof cell.v === "number" && Number.isSafeInteger(cell.v)) cell.w = String(cell.v);
        }
      }
    }
    return XLSX.utils.sheet_to_json<ImportRow>(sheet, {
      defval: "",
      raw: false,
      blankrows: false,
    });
  });
}

export function mapImportRow(row: ImportRow) {
  const boundedNumber = (raw: string, min: number, max: number) => {
    const match = String(raw || "").replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null;
  };
  const productImage = value(row, "商品图片", "图片网址", "image", "product image");
  const tags = [
    value(row, "标签", "tags"),
    value(row, "搜索关键词", "keyword", "keywords"),
    value(row, "商店类型", "store type"),
    value(row, "商店状态", "store status"),
  ].flatMap((item) => item.split(/[,，]/)).map((item) => item.trim()).filter(Boolean);

  const shippingRecipient = value(row, "收货人（客户）", "收货人(客户)", "客户收货人", "收货人", "shipping recipient");
  const shippingPhone = value(row, "收货电话（客户）", "收货电话(客户)", "客户收货电话", "客户收货联系电话", "收货电话", "shipping phone");
  const shippingAddress = value(row, "收货地址（客户）", "收货地址(客户)", "客户收货地址", "收货地址", "shipping address");
  const forwarderRecipient = value(row, "收货人（货代）", "收货人(货代)", "货代收货人", "货代收件人", "forwarder recipient");
  const forwarderPhone = value(row, "收货电话（货代）", "收货电话(货代)", "货代收货电话", "货代联系电话", "forwarder phone");
  const forwarderAddress = value(row, "收货地址（货代）", "收货地址(货代)", "货代收货地址", "货代地址", "forwarder address");
  const hasStructuredShippingColumns = Object.keys(row).some((key) => ["收货人（客户）", "收货人(客户)", "收货电话（客户）", "收货电话(客户)", "收货地址（客户）", "收货地址(客户)", "客户收货人", "客户收货电话", "客户收货联系电话", "收货人", "收货电话", "shipping recipient", "shipping phone"].includes(key.trim().toLowerCase()));
  const hasStructuredForwarderColumns = Object.keys(row).some((key) => ["收货人（货代）", "收货人(货代)", "收货电话（货代）", "收货电话(货代)", "收货地址（货代）", "收货地址(货代)", "货代收货人", "货代收件人", "货代收货电话", "货代联系电话", "forwarder recipient", "forwarder phone"].includes(key.trim().toLowerCase()));
  const shippingContactEntries = hasStructuredShippingColumns && [shippingRecipient, shippingPhone, shippingAddress].some(Boolean)
    ? [{ recipient: shippingRecipient, phone: shippingPhone, address: shippingAddress }]
    : undefined;
  const forwarderContactEntries = hasStructuredForwarderColumns && [forwarderRecipient, forwarderPhone, forwarderAddress].some(Boolean)
    ? [{ recipient: forwarderRecipient, phone: forwarderPhone, address: forwarderAddress }]
    : undefined;
  return {
    company_name: value(row, "公司名称*", "名称", "公司名称", "商店名称", "店铺名称", "name", "company name", "store name"),
    contact_name: value(row, "客户名称*", "客户名称", "联系人", "contact", "contact name"),
    country: normalizeImportCountry(value(row, "国家*", "国家", "country")),
    phone: value(row, "电话号码", "完整号码", "完整电话", "电话", "phone", "full phone"),
    whatsapp: value(row, "whatsapp号码", "WhatsApp", "whatsapp"),
    wechat: value(row, "wechat号码", "微信号码", "wechat"),
    email: value(row, "邮箱号", "邮箱", "email", "e-mail"),
    tax_number: value(row, "客户税号", "公司税号", "tax number"),
    manual_grade: value(row, "客户等级", "人工客户等级").toUpperCase(),
    import_stage: value(row, "客户阶段"),
    website: value(row, "客户官网", "商家官网网址", "官网网址", "官网", "website", "site"),
    google_url: value(row, "谷歌商家链接", "谷歌网址", "Google网址", "Google地图网址", "google url", "google maps url"),
    facebook_url: value(row, "FB主页链接", "Facebook主页链接", "facebook_url"),
    instagram_url: value(row, "INS主页链接", "Instagram主页链接", "instagram_url"),
    tiktok_url: value(row, "Tiktok主页链接", "TikTok主页链接", "tiktok_url"),
    linkedin_url: value(row, "Linked主页链接", "LinkedIn主页链接", "linkedin_url"),
    address: value(row, "公司地址", "商店地址", "地址", "address", "store address"),
    shipping_address: shippingAddress,
    ...(shippingContactEntries ? { shipping_contact_entries: shippingContactEntries } : {}),
    tally_requirements: value(row, "理货要求"),
    notes: value(row, "备注", "notes"),
    forwarder_address: forwarderAddress,
    ...(forwarderContactEntries ? { forwarder_contact_entries: forwarderContactEntries } : {}),
    other_address: value(row, "其他地址"),
    category: value(row, "分类", "商店类型", "category", "store type"),
    industry: value(row, "行业", "industry"),
    source: "EXCEL_IMPORT",
    tags,
    rating: boundedNumber(value(row, "商店分数", "评分", "rating"), 0, 5),
    ai_score: boundedNumber(value(row, "AI评分", "ai_score"), 0, 100),
    ai_level: "",
    status: "UNCLAIMED" as const,
    ai_screening_done: false,
    website_email: "",
    website_phone: "",
    import_meta: {
      raw_data: row,
      store_name: value(row, "商店名称", "店铺名称", "store name"),
      store_type: value(row, "商店类型", "店铺类型", "store type"),
      store_url: value(row, "商店网址", "店铺网址", "store url"),
      product_image: productImage,
      created_at: value(row, "创建时间", "created at", "created_time"),
    },
  };
}

export function importDeliveryContactError(row: ImportRow) {
  const shippingEntry = Array.isArray(row.shipping_contact_entries) ? row.shipping_contact_entries[0] as Record<string, unknown> | undefined : undefined;
  const forwarderEntry = Array.isArray(row.forwarder_contact_entries) ? row.forwarder_contact_entries[0] as Record<string, unknown> | undefined : undefined;
  const shipping = shippingEntry ? [shippingEntry.recipient, shippingEntry.phone, shippingEntry.address].map((part) => String(part || "").trim()) : [
    value(row, "收货人（客户）", "收货人(客户)", "客户收货人", "收货人", "shipping recipient"),
    value(row, "收货电话（客户）", "收货电话(客户)", "客户收货电话", "客户收货联系电话", "收货电话", "shipping phone"),
    value(row, "收货地址（客户）", "收货地址(客户)", "客户收货地址", "收货地址", "shipping address"),
  ];
  const forwarder = forwarderEntry ? [forwarderEntry.recipient, forwarderEntry.phone, forwarderEntry.address].map((part) => String(part || "").trim()) : [
    value(row, "收货人（货代）", "收货人(货代)", "货代收货人", "货代收件人", "forwarder recipient"),
    value(row, "收货电话（货代）", "收货电话(货代)", "货代收货电话", "货代联系电话", "forwarder phone"),
    value(row, "收货地址（货代）", "收货地址(货代)", "货代收货地址", "货代地址", "forwarder address"),
  ];
  for (const [label, contact] of [["客户收货信息", shipping], ["货代收货信息", forwarder]] as const) {
    if (contact[0].length > 200 || contact[2].length > 500) return `${label}的收货人或地址超出长度限制`;
    if (!contact[1]) continue;
    try {
      const phone = normalizeManualPhone(contact[1], `${label}联系电话`);
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15 || /^(\d)\1+$/.test(digits)) return `${label}联系电话须为有效的 7 至 15 位号码`;
    } catch {
      return `${label}联系电话格式不正确`;
    }
  }
  return "";
}

