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
}: {
  supabase: UserSupabase;
  userId: string;
  ids: string[];
  allowAll?: boolean;
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
  const allowedIds = uniqueIds.filter((id) => {
    const customer = visibleById.get(id);
    return Boolean(customer && (allowAll || (!["QUOTE", "DEAL"].includes(customer.status) && customer.owner_id === userId)));
  });
  const failures: Failure[] = uniqueIds
    .filter((id) => !allowedIds.includes(id))
    .map((id) => ({ id, ok: false, error: ["QUOTE", "DEAL"].includes(visibleById.get(id)?.status || "") ? "报价中和成交客户仅系统管理员可删除" : "客户不存在、已删除或您没有删除权限" }));
  if (!allowedIds.length) return { successIds: [] as string[], failures };

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
      content: { permanent_delete: true, irreversible: true },
    })));
    if (auditError) console.error("CUSTOMER_DELETE_AUDIT_ERROR", auditError.message);
  }
  return { successIds, failures };
}

// Backward-compatible export for older imports. Its behavior is intentionally
// permanent; new code should use permanentlyDeleteCustomers.
export const softDeleteCustomers = permanentlyDeleteCustomers;
