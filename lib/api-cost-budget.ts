import { createAdminClient } from "@/lib/supabase/admin";

export type CostProvider = "GOOGLE_PLACES" | "OPENAI";
export type CostBudgetContext = { userId?: string | null; customerId?: string | null; taskId?: string | null; operation?: string | null };
export type CostBudgetPeriod = "DAY" | "WEEK" | "MONTH" | "TASK" | "CUSTOMER" | "FREE_MODE" | "PROVIDER_DISABLED";
export type CostBudgetReservation = { allowed: boolean; reservationId?: string; period?: CostBudgetPeriod; usedUsd?: number; limitUsd?: number };

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
    period: ["DAY", "WEEK", "MONTH", "TASK", "CUSTOMER", "FREE_MODE", "PROVIDER_DISABLED"].includes(String(result.period)) ? result.period as CostBudgetPeriod : undefined,
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
  const reason: Record<CostBudgetPeriod, string> = {
    DAY: "每日费用上限已达到",
    WEEK: "每周费用上限已达到",
    MONTH: "每月费用上限已达到",
    TASK: "本任务费用上限已达到",
    CUSTOMER: "本客户付费调用次数已达到上限",
    FREE_MODE: "本任务采用免费分析模式",
    PROVIDER_DISABLED: "该付费渠道已由管理员停用",
  };
  return `${provider}_COST_BUDGET_EXCEEDED:${reason[reservation.period || "MONTH"]}`;
}
