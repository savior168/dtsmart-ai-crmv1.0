import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;
export type SalesMetrics = { new_customers: number; claimed: number; released: number; followups: number; quotes: number; deals: number; conversion_rate: number; ai_valid: number };
export type SalesRankingRow = SalesMetrics & { user_id: string; name: string; email: string; customer_count: number };

export function defaultMonthRange() {
  const now = new Date();
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), to: now.toISOString() };
}

export async function loadSalesReport(supabase: Client, authUserId: string, from: string, to: string, requestedUserId?: string | null) {
  const { data: profile, error: profileError } = await supabase.from("users").select("id,name,email,role").eq("id", authUserId).single();
  if (profileError) throw profileError;
  const { data, error } = await supabase.rpc("sales_performance_report", { p_from: from, p_to: to });
  if (error) throw error;
  const canViewAll = profile.role === "ADMIN" || profile.role === "SUPERVISOR";
  const ranking = ((data || []) as Record<string, unknown>[]).map((row) => ({
    user_id: String(row.user_id), name: String(row.name || row.email), email: String(row.email),
    new_customers: Number(row.new_customers || 0), claimed: Number(row.claimed || 0), released: Number(row.released || 0),
    followups: Number(row.followups || 0), quotes: Number(row.quotes || 0), deals: Number(row.deals || 0),
    conversion_rate: Number(row.conversion_rate || 0), ai_valid: Number(row.ai_valid || 0), customer_count: Number(row.customer_count || 0),
  })).filter((row) => canViewAll ? (!requestedUserId || row.user_id === requestedUserId) : row.user_id === authUserId) as SalesRankingRow[];
  const totals = ranking.reduce<SalesMetrics>((sum, row) => ({ new_customers: sum.new_customers + row.new_customers, claimed: sum.claimed + row.claimed, released: sum.released + row.released, followups: sum.followups + row.followups, quotes: sum.quotes + row.quotes, deals: sum.deals + row.deals, conversion_rate: 0, ai_valid: sum.ai_valid + row.ai_valid }), { new_customers: 0, claimed: 0, released: 0, followups: 0, quotes: 0, deals: 0, conversion_rate: 0, ai_valid: 0 });
  const totalCustomers = ranking.reduce((sum, row) => sum + row.customer_count, 0);
  totals.conversion_rate = totalCustomers ? Number(((totals.deals / totalCustomers) * 100).toFixed(1)) : 0;
  return { profile, scope: canViewAll ? requestedUserId || "ALL" : authUserId, range: { from, to }, totals, ranking };
}
