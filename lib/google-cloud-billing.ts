import { createSign } from "crypto";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
export type GooglePlacesSkuKey = "TEXT_SEARCH_IDS_ONLY" | "PLACE_DETAILS_PRO" | "PLACE_DETAILS_ENTERPRISE" | "PLACE_DETAILS_ATMOSPHERE";
export type GooglePlacesSkuUsage = {
  key: GooglePlacesSkuKey;
  label: string;
  skuIds: string[];
  usageCount: number;
  freeLimit: number | null;
  confirmedRemaining: number | null;
  grossCostUsd: number;
  creditsUsd: number;
  netCostUsd: number;
  latestUsageAt: string | null;
};

const normalizedUsd = (value: number) => {
  const rounded = Number(value.toFixed(6));
  return Math.abs(rounded) < 0.0000005 ? 0 : rounded;
};
const GOOGLE_BILLING_CACHE_MS = 5 * 60 * 1000;
let googleBillingCache: { value: GoogleBillingStatus; expiresAt: number } | null = null;
let googleBillingRequest: Promise<GoogleBillingStatus> | null = null;
let googleNextRefreshAt = 0;
export type GoogleBillingStatus =
  | { state: "NOT_CONFIGURED"; message: string }
  | { state: "CONNECTED"; message: string; totalUsd: number; creditUsd: number; latestUsageAt: string | null; usageRows: number; periodStart: string; periodEnd: string; pricingRegion: "GLOBAL" | "INDIA"; skuUsage: GooglePlacesSkuUsage[] }
  | { state: "NO_DATA"; message: string }
  | { state: "ERROR"; message: string };

const SKU_DEFINITIONS: Array<{
  key: GooglePlacesSkuKey;
  label: string;
  globalIds: string[];
  indiaIds: string[];
  globalFreeLimit: number | null;
  indiaFreeLimit: number | null;
}> = [
  { key: "TEXT_SEARCH_IDS_ONLY", label: "Text Search IDs Only", globalIds: ["635D-A9DD-C520"], indiaIds: ["9C44-5A2D-4E06"], globalFreeLimit: null, indiaFreeLimit: null },
  { key: "PLACE_DETAILS_PRO", label: "Place Details Pro", globalIds: ["4ED6-464A-2AFC"], indiaIds: ["1F70-206B-61DF"], globalFreeLimit: 5_000, indiaFreeLimit: 35_000 },
  { key: "PLACE_DETAILS_ENTERPRISE", label: "Place Details Enterprise", globalIds: ["2D9A-3DE0-3766"], indiaIds: ["448A-2967-E6BF"], globalFreeLimit: 1_000, indiaFreeLimit: 7_000 },
  { key: "PLACE_DETAILS_ATMOSPHERE", label: "Enterprise + Atmosphere", globalIds: ["EB23-5ECC-F753"], indiaIds: ["586E-FEBE-4FD2"], globalFreeLimit: 1_000, indiaFreeLimit: 7_000 },
];

const base64url = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw || !process.env.GOOGLE_CLOUD_PROJECT_ID || !process.env.GOOGLE_CLOUD_BILLING_DATASET) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    return parsed.client_email && parsed.private_key ? parsed : null;
  } catch { return null; }
}

function billingTableReference(project: string, dataset: string) {
  const configured = process.env.GOOGLE_CLOUD_BILLING_TABLE?.trim();
  if (!configured) return `${project}.${dataset}.gcp_billing_export_resource_v1_*`;
  // The setting accepts either a table ID inside the selected dataset or a
  // complete BigQuery reference. It remains server-only and is never exposed.
  const reference = configured.replace(/^`|`$/g, "");
  return reference.includes(".") ? reference : `${project}.${dataset}.${reference}`;
}

export function normalizeGoogleBillingTimestamp(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  // BigQuery REST serializes TIMESTAMP values as Unix seconds (often with a
  // fractional part), not necessarily as an ISO date string.
  const seconds = Number(text);
  const date = Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function accessToken(account: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/bigquery.readonly",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`); signer.end();
  const assertion = `${header}.${payload}.${signer.sign(account.private_key).toString("base64url")}`;
  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description || "无法取得 Google Cloud 读取令牌");
  return body.access_token;
}

async function readGoogleMapsActualBilling(): Promise<GoogleBillingStatus> {
  const account = serviceAccount();
  if (!account) return { state: "NOT_CONFIGURED", message: "尚未配置 Google Cloud 账单读取凭据" };
  try {
    const token = await accessToken(account);
    const project = process.env.GOOGLE_CLOUD_PROJECT_ID!;
    const dataset = process.env.GOOGLE_CLOUD_BILLING_DATASET!;
    const table = billingTableReference(project, dataset);
    const allSkuIds = SKU_DEFINITIONS.flatMap((item) => [...item.globalIds, ...item.indiaIds]);
    const query = `
      WITH month_bounds AS (
        SELECT
          TIMESTAMP(DATETIME(DATE_TRUNC(CURRENT_DATE("America/Los_Angeles"), MONTH)), "America/Los_Angeles") AS period_start,
          TIMESTAMP(DATETIME(DATE_ADD(DATE_TRUNC(CURRENT_DATE("America/Los_Angeles"), MONTH), INTERVAL 1 MONTH)), "America/Los_Angeles") AS period_end
      ), usage_by_sku AS (
        SELECT
          sku.id AS sku_id,
          ANY_VALUE(sku.description) AS sku_name,
          ANY_VALUE(usage.unit) AS usage_unit,
          ROUND(SUM(usage.amount), 6) AS usage_amount,
          ROUND(SUM(cost), 6) AS gross_cost_usd,
          ROUND(SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 6) AS credits_usd,
          ROUND(SUM(cost + IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 6) AS net_cost_usd,
          MAX(usage_end_time) AS latest_usage_at,
          COUNT(*) AS usage_rows
        FROM \`${table}\`, month_bounds
        WHERE usage_start_time >= period_start AND usage_start_time < period_end AND sku.id IN UNNEST(@sku_ids)
        GROUP BY sku_id
      )
      SELECT
        usage_by_sku.sku_id, usage_by_sku.sku_name, usage_by_sku.usage_unit,
        usage_by_sku.usage_amount, usage_by_sku.gross_cost_usd, usage_by_sku.credits_usd,
        usage_by_sku.net_cost_usd, usage_by_sku.latest_usage_at, usage_by_sku.usage_rows,
        month_bounds.period_start, month_bounds.period_end
      FROM month_bounds LEFT JOIN usage_by_sku ON TRUE
      ORDER BY sku_name`;
    const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}/queries`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        useLegacySql: false,
        timeoutMs: 20000,
        parameterMode: "NAMED",
        queryParameters: [{ name: "sku_ids", parameterType: { type: "ARRAY", arrayType: { type: "STRING" } }, parameterValue: { arrayValues: allSkuIds.map((value) => ({ value })) } }],
      }),
    });
    const body = await response.json() as { error?: { message?: string }; jobComplete?: boolean; rows?: Array<{ f?: Array<{ v?: string | null }> }> };
    if (!response.ok) {
      const message = body.error?.message || "Google BigQuery 查询失败";
      if (/not found|does not exist|no matching signature|does not match any table/i.test(message)) return { state: "NO_DATA", message: "账单导出已配置；Google 尚未生成可读取的详细费用表，通常需要等待首次导出完成后再刷新" };
      throw new Error(message);
    }
    if (body.jobComplete === false) return { state: "ERROR", message: "Google Cloud 账单查询仍在处理，请稍后刷新" };
    const rows = (body.rows || []).map((row) => {
      const fields = row.f || [];
      return {
        skuId: String(fields[0]?.v || ""),
        usageAmount: Number(fields[3]?.v || 0),
        grossCostUsd: Number(fields[4]?.v || 0),
        creditsUsd: Number(fields[5]?.v || 0),
        netCostUsd: Number(fields[6]?.v || 0),
        latestUsageAt: normalizeGoogleBillingTimestamp(fields[7]?.v),
        usageRows: Number(fields[8]?.v || 0),
        periodStart: normalizeGoogleBillingTimestamp(fields[9]?.v),
        periodEnd: normalizeGoogleBillingTimestamp(fields[10]?.v),
      };
    });
    const pricingRegion = rows.some((row) => SKU_DEFINITIONS.some((item) => item.indiaIds.includes(row.skuId))) ? "INDIA" : "GLOBAL";
    const skuUsage = SKU_DEFINITIONS.map((definition): GooglePlacesSkuUsage => {
      const ids = pricingRegion === "INDIA" ? definition.indiaIds : definition.globalIds;
      const matching = rows.filter((row) => ids.includes(row.skuId));
      const usageCount = Math.max(0, Math.round(matching.reduce((total, row) => total + row.usageAmount, 0)));
      const freeLimit = pricingRegion === "INDIA" ? definition.indiaFreeLimit : definition.globalFreeLimit;
      return {
        key: definition.key,
        label: definition.label,
        skuIds: matching.map((row) => row.skuId),
        usageCount,
        freeLimit,
        confirmedRemaining: freeLimit === null ? null : Math.max(0, freeLimit - usageCount),
        grossCostUsd: normalizedUsd(matching.reduce((total, row) => total + row.grossCostUsd, 0)),
        creditsUsd: normalizedUsd(matching.reduce((total, row) => total + row.creditsUsd, 0)),
        netCostUsd: normalizedUsd(matching.reduce((total, row) => total + row.netCostUsd, 0)),
        latestUsageAt: matching.map((row) => row.latestUsageAt).filter((value): value is string => Boolean(value)).sort().at(-1) || null,
      };
    });
    const usageRows = rows.reduce((total, row) => total + row.usageRows, 0);
    const latestUsageAt = rows.map((row) => row.latestUsageAt).filter((value): value is string => Boolean(value)).sort().at(-1) || null;
    const periodStart = rows.map((row) => row.periodStart).find((value): value is string => Boolean(value)) || new Date().toISOString();
    const periodEnd = rows.map((row) => row.periodEnd).find((value): value is string => Boolean(value)) || new Date().toISOString();
    // BigQuery net cost can be slightly negative when credits or rounding
    // exceed gross cost. A payable amount must never be displayed as negative;
    // retain the credit separately so the platform ledger remains auditable.
    const rawNetUsd = normalizedUsd(rows.reduce((total, row) => total + row.netCostUsd, 0));
    const totalUsd = Math.max(0, rawNetUsd);
    const creditUsd = Math.max(0, -rawNetUsd);
    return {
      state: "CONNECTED",
      message: usageRows ? "已连接 Google Cloud BigQuery；以下为当前结算账号本月已确认的 SKU 用量" : "已连接 Google Cloud；本月尚未同步这四项 Places SKU 用量",
      totalUsd,
      creditUsd,
      latestUsageAt,
      usageRows,
      periodStart,
      periodEnd,
      pricingRegion,
      skuUsage,
    };
  } catch (error) {
    return { state: "ERROR", message: error instanceof Error ? error.message : "Google Cloud 账单连接失败" };
  }
}

export async function getGoogleMapsActualBilling(options: { force?: boolean } = {}): Promise<GoogleBillingStatus> {
  const now = Date.now();
  if (googleBillingRequest) return googleBillingRequest;
  if (options.force && googleBillingCache && now < googleNextRefreshAt) return googleBillingCache.value;
  if (!options.force && googleBillingCache && googleBillingCache.expiresAt > now) return googleBillingCache.value;
  const stale = googleBillingCache?.value;
  googleNextRefreshAt = now + 60_000;
  googleBillingRequest = readGoogleMapsActualBilling()
    .then((value) => {
      if (value.state === "ERROR" && stale) {
        googleBillingCache = { value: stale, expiresAt: Date.now() + 60_000 };
        return stale;
      }
      googleBillingCache = { value, expiresAt: Date.now() + GOOGLE_BILLING_CACHE_MS };
      return value;
    })
    .finally(() => { googleBillingRequest = null; });
  return googleBillingRequest;
}
