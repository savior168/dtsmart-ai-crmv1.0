export const PRODUCT_FAMILIES = ["SCREEN", "BATTERY", "COVER", "SMALL_PART", "OTHER"] as const;
export type ProductFamily = (typeof PRODUCT_FAMILIES)[number];

export type SpecificationField = { key: string; label: string; hint?: string };

export type FamilyLimitedField = "manufacturer_brand" | "display_technology" | "color";

export function isProductFieldApplicable(field: FamilyLimitedField, family: ProductFamily) {
  if (field === "color") return family === "SCREEN" || family === "COVER";
  if (field === "manufacturer_brand") return family === "SCREEN" || family === "BATTERY";
  return family === "SCREEN";
}

export function validateProductFamilyFields(
  body: Partial<Record<FamilyLimitedField, unknown>>,
  family: ProductFamily,
  existing?: Partial<Record<FamilyLimitedField, unknown>>,
) {
  const labels: Record<FamilyLimitedField, string> = {
    manufacturer_brand: "生产厂牌",
    display_technology: "显示技术",
    color: "颜色",
  };
  for (const field of ["manufacturer_brand", "display_technology", "color"] as const) {
    const value = String(body[field] ?? "").trim();
    if (value && !isProductFieldApplicable(field, family) && value !== String(existing?.[field] ?? "").trim()) {
      return `当前商品分类不适用“${labels[field]}”，请核对分类与商品资料`;
    }
  }
  return "";
}

export const PRODUCT_SPECIFICATION_FIELDS: Record<ProductFamily, readonly SpecificationField[]> = {
  SCREEN: [
    { key: "assembly", label: "交付形态", hint: "单片屏、带框屏等；不同售价须分开建档" },
    { key: "panel_subtype", label: "显示技术细分", hint: "如硬 OLED、软 OLED；不凭价格推断" },
    { key: "size_grade", label: "尺寸规格", hint: "原尺寸、大尺寸、中尺寸、小尺寸" },
    { key: "fingerprint_support", label: "指纹功能", hint: "仅填写来源明确支持的功能" },
    { key: "glass_grade", label: "玻璃或盖板版本" },
    { key: "ic_transfer_support", label: "搬 IC 能力", hint: "可搬 IC 表示屏幕支持该操作，不代表已经搬好或包含加工费" },
  ],
  BATTERY: [
    { key: "capacity_mah", label: "标称容量（mAh）" },
    { key: "cell_material", label: "电芯材料" },
    { key: "health_grade", label: "拆机电池健康度", hint: "如来源注明 90% 以上" },
    { key: "diagnostic_support", label: "跑诊断支持情况" },
    { key: "certification", label: "认证信息", hint: "仅记录可核验证书或原表声明" },
  ],
  COVER: [
    { key: "assembly_scope", label: "装配范围", hint: "后盖玻璃、后盖总成、中框+后盖等" },
    { key: "frame_structure", label: "一体或分体" },
    { key: "included_parts", label: "随附配件", hint: "磁吸、排线、喇叭等以来源为准" },
    { key: "market_version", label: "区域版本", hint: "如欧版、美版；仅在来源区分时填写" },
    { key: "color_source", label: "颜色供货依据", hint: "供应商目录、报价或人工确认；官方机身颜色不是供货证明" },
  ],
  SMALL_PART: [
    { key: "component_position", label: "配件位置", hint: "如听筒、尾插、开机排等" },
    { key: "connector_variant", label: "接口或排线版本" },
    { key: "included_parts", label: "组合内含配件" },
  ],
  OTHER: [],
};

export function isProductFamily(value: unknown): value is ProductFamily {
  return typeof value === "string" && PRODUCT_FAMILIES.some((family) => family === value);
}

export function normalizeProductSpecifications(value: unknown, family: ProductFamily) {
  if (value === undefined || value === null) return { specifications: {}, error: "" };
  if (typeof value !== "object" || Array.isArray(value)) return { specifications: {}, error: "商品规格格式不正确" };
  const allowed = new Set(PRODUCT_SPECIFICATION_FIELDS[family].map((field) => field.key));
  const specifications: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowed.has(key)) return { specifications: {}, error: `当前商品分类不支持规格“${key}”` };
    if (typeof raw !== "string") return { specifications: {}, error: `规格“${key}”必须为文字` };
    const normalized = raw.trim();
    if (normalized.length > 300) return { specifications: {}, error: `规格“${key}”不能超过300字` };
    if (normalized) specifications[key] = normalized;
  }
  return { specifications, error: "" };
}

export function summarizeProductSpecifications(value: Record<string, string> | null | undefined, family: ProductFamily) {
  if (!value) return "";
  return PRODUCT_SPECIFICATION_FIELDS[family]
    .filter((field) => field.key !== "color_source" && value[field.key])
    .map((field) => `${field.label}：${value[field.key]}`)
    .join(" · ");
}

export function summarizeProductSpecificationsSnapshot(value: Record<string, string> | null | undefined) {
  if (!value) return "";
  const labels = new Map(Object.values(PRODUCT_SPECIFICATION_FIELDS).flat().map((field) => [field.key, field.label]));
  return Object.entries(value)
    .filter(([key, entry]) => key !== "color_source" && typeof entry === "string" && entry.trim())
    .map(([key, entry]) => `${labels.get(key) || key}：${entry}`)
    .join(" · ");
}

