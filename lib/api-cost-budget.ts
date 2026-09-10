import { createAdminClient } from "@/lib/supabase/admin";

export type CostProvider = "GOOGLE_PLACES" | "OPENAI";
export type CostBudgetContext = { userId?: string | null; customerId?: string | null; taskId?: string | null; operation?: string | null };
export type CostBudgetReservation = { allowed: boolean; reservationId?: string; period?: "DAY" | "WEEK" | "MONTH"; usedUsd?: number; limitUsd?: number };

export async function reserveApiCostBudget(provider: CostProvider, amountUsd: number, context: CostBudgetContext = {}): Promise<CostBudgetReservation> {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) throw new Error("INVALID_API_COST_RESERVATION");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reserve_api_cost_budget", {
    p_provider: provider,
    p_amount_usd: amountUsd,
    p_user_id: context.userId || null,
    p_customer_id: context.customerId || null,
    p_task_id: context.taskId || null,
    p_operation: context.operation || null,
  });
  if (error) throw error;
  const result = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return {
    allowed: result.allowed === true,
    reservationId: typeof result.reservation_id === "string" ? result.reservation_id : undefined,
    period: ["DAY", "WEEK", "MONTH"].includes(String(result.period)) ? result.period as CostBudgetReservation["period"] : undefined,
    usedUsd: Number(result.used_usd || 0),
    limitUsd: result.limit_usd == null ? undefined : Number(result.limit_usd),
  };
}

export async function releaseApiCostBudget(reservationId?: string | null) {
  if (!reservationId) return;
  const { error } = await createAdminClient().rpc("release_api_cost_budget", { p_reservation_id: reservationId });
  if (error) throw error;
}

export function budgetExceededMessage(provider: CostProvider, reservation: CostBudgetReservation) {
  const period = reservation.period === "DAY" ? "每日" : reservation.period === "WEEK" ? "每周" : "每月";
  return `${provider}_COST_BUDGET_EXCEEDED:${period}费用上限已达到`;
}
