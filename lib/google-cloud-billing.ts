import { createSign } from "crypto";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
export type GoogleBillingStatus =
  | { state: "NOT_CONFIGURED"; message: string }
  | { state: "CONNECTED"; message: string; totalUsd: number; latestUsageAt: string | null; usageRows: number }
  | { state: "NO_DATA"; message: string }
  | { state: "ERROR"; message: string };

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

export async function getGoogleMapsActualBilling(): Promise<GoogleBillingStatus> {
  const account = serviceAccount();
  if (!account) return { state: "NOT_CONFIGURED", message: "尚未配置 Google Cloud 账单读取凭据" };
  try {
    const token = await accessToken(account);
    const project = process.env.GOOGLE_CLOUD_PROJECT_ID!;
    const dataset = process.env.GOOGLE_CLOUD_BILLING_DATASET!;
    const table = billingTableReference(project, dataset);
    const query = `SELECT ROUND(SUM(cost + IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 6) AS total_usd, MAX(usage_end_time) AS latest_usage_at, COUNT(*) AS usage_rows FROM \`${table}\` WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY) AND REGEXP_CONTAINS(LOWER(service.description), r'google maps|maps platform|places')`;
    const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}/queries`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, useLegacySql: false, timeoutMs: 10000 }),
    });
    const body = await response.json() as { error?: { message?: string }; rows?: Array<{ f?: Array<{ v?: string | null }> }> };
    if (!response.ok) {
      const message = body.error?.message || "Google BigQuery 查询失败";
      if (/not found|does not exist|no matching signature|does not match any table/i.test(message)) return { state: "NO_DATA", message: "账单导出已配置；Google 尚未生成可读取的详细费用表，通常需要等待首次导出完成后再刷新" };
      throw new Error(message);
    }
    const fields = body.rows?.[0]?.f || [];
    const total = Number(fields[0]?.v || 0);
    const latest = normalizeGoogleBillingTimestamp(fields[1]?.v);
    const count = Number(fields[2]?.v || 0);
    if (!count) return { state: "NO_DATA", message: "已连接 Google Cloud；近 90 天暂无 Google Maps/Places 实际账单明细" };
    return { state: "CONNECTED", message: "已连接 Google Cloud BigQuery，金额为实际结算明细汇总", totalUsd: total, latestUsageAt: latest, usageRows: count };
  } catch (error) {
    return { state: "ERROR", message: error instanceof Error ? error.message : "Google Cloud 账单连接失败" };
  }
}
