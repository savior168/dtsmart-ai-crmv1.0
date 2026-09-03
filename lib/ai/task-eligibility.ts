import { createAdminClient } from "@/lib/supabase/admin";

export const RESERVED_TASK_STATUSES = ["QUEUED", "RUNNING", "PAUSING", "PAUSED"] as const;
export const RESERVED_ITEM_STATUSES = ["PENDING", "RUNNING"] as const;

/**
 * Customers reserved by an unfinished task must not be added to another task.
 * Keep this query shared by the task-center KPI and the create-task list so
 * both screens always use the same eligibility definition.
 */
export async function getReservedAiCustomerIds(userId?: string | null) {
  const admin = createAdminClient();
  const reserved = new Set<string>();

  for (let offset = 0; ; offset += 1000) {
    let query = admin
      .from("ai_screening_task_items")
      .select("customer_id,task:ai_screening_tasks!inner(user_id,status)")
      .in("task.status", [...RESERVED_TASK_STATUSES])
      .in("status", [...RESERVED_ITEM_STATUSES])
      .range(offset, offset + 999);
    if (userId) query = query.eq("task.user_id", userId);
    const result = await query;
    if (result.error) throw result.error;
    for (const item of result.data || []) reserved.add(item.customer_id);
    if (!result.data || result.data.length < 1000) break;
  }

  return reserved;
}
