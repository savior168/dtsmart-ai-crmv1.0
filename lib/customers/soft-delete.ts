import { createAdminClient } from "@/lib/supabase/admin";
import type { requireUser } from "@/lib/auth/current-user";

type UserSupabase = Awaited<ReturnType<typeof requireUser>>["supabase"];
type Failure = { id: string; ok: false; error: string };

/** Permanently delete customers after checking ownership and protected stages. */
export async function permanentlyDeleteCustomers({
  supabase: _supabase,
  userId,
  ids,
  allowAll = false,
  reason,
}: {
  supabase: UserSupabase;
  userId: string;
  ids: string[];
  allowAll?: boolean;
  reason?: string;
}) {
  void _supabase;
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (!uniqueIds.length) return { successIds: [] as string[], failures: [] as Failure[] };

  // 读取和写入都通过服务端管理客户端完成，避免大批量操作被 RLS
  // 的可见行分页或策略差异截断；授权仍由这里按当前用户严格判定。
  const admin = createAdminClient();
  const visible: Array<{ id: string; owner_id: string | null; status: string }> = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 200) {
    const page = await admin.from("customers")
      .select("id,owner_id,status")
      .in("id", uniqueIds.slice(offset, offset + 200))
      .is("deleted_at", null);
    if (page.error) throw page.error;
    visible.push(...(page.data || []));
  }

  const visibleById = new Map((visible || []).map((customer) => [customer.id, customer]));
  const [quoteLinks, orderLinks] = await Promise.all([
    admin.from("quotes").select("customer_id").in("customer_id", uniqueIds),
    admin.from("sales_orders").select("customer_id").in("customer_id", uniqueIds),
  ]);
  if (quoteLinks.error && !/does not exist|schema cache/i.test(quoteLinks.error.message)) throw quoteLinks.error;
  if (orderLinks.error && !/does not exist|schema cache/i.test(orderLinks.error.message)) throw orderLinks.error;
  const linkedIds = new Set([...(quoteLinks.data || []), ...(orderLinks.data || [])].map((item) => item.customer_id));
  const allowedIds = uniqueIds.filter((id) => {
    const customer = visibleById.get(id);
    const nonAdminDeletableStage = customer?.status === "CLAIMED" || customer?.status === "UNCLAIMED";
    return Boolean(customer && !linkedIds.has(id) && (allowAll || (customer.owner_id === userId && nonAdminDeletableStage)));
  });
  const failures: Failure[] = uniqueIds
    .filter((id) => !allowedIds.includes(id))
    .map((id) => {
      const customer = visibleById.get(id);
      const error = linkedIds.has(id)
        ? "客户已有报价或订单记录，为保证业务凭证完整不可物理删除；请通过客户阶段继续流转"
        : !customer
          ? "客户不存在、已删除或您没有删除权限"
          : !allowAll && ["FOLLOWING", "QUOTE", "DEAL"].includes(customer.status)
            ? "意向、报价中及已成交客户不可由非系统管理员永久删除；如需清理意向客户，请先填写原因将阶段退回潜在客户"
            : !allowAll && customer.owner_id !== userId
              ? "只能永久删除归属自己的潜在客户"
              : "客户当前阶段不可永久删除";
      return { id, ok: false as const, error };
    });
  if (!allowedIds.length) return { successIds: [] as string[], failures };

  // AI acquisition candidates keep historical task provenance after a
  // customer is removed. A candidate can point both at the customer and at an
  // AI screening item which itself is deleted through the customer's cascade.
  // PostgreSQL can otherwise process the two SET NULL cascade paths in an
  // order that leaves the candidate temporarily referencing an already
  // deleted task item (23503). Detach both paths explicitly before deleting
  // the customer so the operation is deterministic.
  const screeningItemIds: string[] = [];
  for (let offset = 0; offset < allowedIds.length; offset += 200) {
    const page = await admin.from("ai_screening_task_items")
      .select("id")
      .in("customer_id", allowedIds.slice(offset, offset + 200));
    if (page.error && !/does not exist|schema cache/i.test(page.error.message)) throw page.error;
    screeningItemIds.push(...(page.data || []).map((item) => item.id));
  }
  for (let offset = 0; offset < screeningItemIds.length; offset += 200) {
    const detached = await admin.from("ai_acquisition_candidates")
      .update({ screening_task_item_id: null })
      .in("screening_task_item_id", screeningItemIds.slice(offset, offset + 200));
    if (detached.error && !/does not exist|schema cache/i.test(detached.error.message)) throw detached.error;
  }
  for (let offset = 0; offset < allowedIds.length; offset += 200) {
    const batch = allowedIds.slice(offset, offset + 200);
    const stagingDetached = await admin.from("ai_acquisition_candidates")
      .update({ staging_customer_id: null })
      .in("staging_customer_id", batch);
    if (stagingDetached.error && !/does not exist|schema cache/i.test(stagingDetached.error.message)) throw stagingDetached.error;
    const importedDetached = await admin.from("ai_acquisition_candidates")
      .update({ imported_customer_id: null })
      .in("imported_customer_id", batch);
    if (importedDetached.error && !/does not exist|schema cache/i.test(importedDetached.error.message)) throw importedDetached.error;
  }

  // Legacy compatibility tables created before ON DELETE CASCADE must be
  // detached first. Newer related records are removed by their FK cascades.
  const compatibilityErrors: string[] = [];
  for (let offset = 0; offset < allowedIds.length; offset += 200) {
    const batch = allowedIds.slice(offset, offset + 200);
    const conflictResult = await admin.from("customer_conflicts").delete().in("customer_id", batch);
    if (conflictResult.error && !/does not exist|schema cache/i.test(conflictResult.error.message)) compatibilityErrors.push(conflictResult.error.message);
    const importResult = await admin.from("import_rows").update({ customer_id: null }).in("customer_id", batch);
    if (importResult.error && !/does not exist|schema cache/i.test(importResult.error.message)) compatibilityErrors.push(importResult.error.message);
  }
  if (compatibilityErrors.length) throw new Error(`清理客户关联数据失败：${compatibilityErrors[0]}`);

  // Permission is checked above. The service-role client performs a physical
  // DELETE so the customer cannot be recovered from the customer table.
  const successIds: string[] = [];
  for (let offset = 0; offset < allowedIds.length; offset += 200) {
    const { data: deleted, error: deleteError } = await admin
      .from("customers")
      .delete()
      .in("id", allowedIds.slice(offset, offset + 200))
      .select("id");
    if (deleteError) throw deleteError;
    successIds.push(...(deleted || []).map((customer) => customer.id));
  }
  const successSet = new Set(successIds);
  allowedIds
    .filter((id) => !successSet.has(id))
    .forEach((id) => failures.push({ id, ok: false, error: "删除未生效，请刷新后重试" }));

  if (successIds.length) {
    const { error: auditError } = await admin.from("audit_logs").insert(successIds.map((id) => ({
      user_id: userId,
      action: "CUSTOMER_DELETE",
      target_type: "customer",
      target_id: id,
      content: { permanent_delete: true, irreversible: true, reason: reason?.trim() || null },
    })));
    if (auditError) console.error("CUSTOMER_DELETE_AUDIT_ERROR", auditError.message);
  }
  return { successIds, failures };
}

// Backward-compatible export for older imports. Its behavior is intentionally
// permanent; new code should use permanentlyDeleteCustomers.
export const softDeleteCustomers = permanentlyDeleteCustomers;
