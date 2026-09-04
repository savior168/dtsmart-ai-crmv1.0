export type OpenAiBillingStatus =
  | { state: "NOT_CONFIGURED"; message: string }
  | { state: "CONNECTED"; message: string; totalUsd: number; latestUsageAt: string | null; lineItems: Array<{ name: string; amountUsd: number }> }
  | { state: "NO_DATA"; message: string }
  | { state: "ERROR"; message: string };

type CostsResponse = { data?: Array<{ end_time?: number; results?: Array<{ amount?: { value?: number; currency?: string }; line_item?: string | null }> }>; error?: { message?: string } };

export async function getOpenAiActualBilling(): Promise<OpenAiBillingStatus> {
  const key = process.env.OPENAI_ADMIN_API_KEY?.trim();
  if (!key) return { state: "NOT_CONFIGURED", message: "尚未配置 OpenAI 管理员密钥，无法读取组织实际费用" };
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 90 * 24 * 60 * 60;
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set("start_time", String(start)); url.searchParams.set("end_time", String(end));
    url.searchParams.set("bucket_width", "1d"); url.searchParams.set("limit", "90"); url.searchParams.set("group_by", "line_item");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
    const body = await response.json() as CostsResponse;
    if (!response.ok) throw new Error(body.error?.message || "OpenAI Costs API 查询失败");
    const amounts = new Map<string, number>(); let latest: number | null = null;
    for (const bucket of body.data || []) {
      if (bucket.end_time) latest = Math.max(latest || 0, bucket.end_time);
      for (const item of bucket.results || []) {
        if ((item.amount?.currency || "usd").toLowerCase() !== "usd") continue;
        const name = item.line_item || "未分类项目";
        amounts.set(name, (amounts.get(name) || 0) + Number(item.amount?.value || 0));
      }
    }
    const lineItems = [...amounts.entries()].map(([name, amountUsd]) => ({ name, amountUsd })).sort((a, b) => b.amountUsd - a.amountUsd);
    const totalUsd = lineItems.reduce((total, item) => total + item.amountUsd, 0);
    if (!lineItems.length) return { state: "NO_DATA", message: "已连接 OpenAI；近 90 天暂无组织费用明细" };
    return { state: "CONNECTED", message: "已连接 OpenAI Costs API，金额可与组织账单对账", totalUsd, latestUsageAt: latest ? new Date(latest * 1000).toISOString() : null, lineItems };
  } catch (error) { return { state: "ERROR", message: error instanceof Error ? error.message : "OpenAI 实际费用连接失败" }; }
}
