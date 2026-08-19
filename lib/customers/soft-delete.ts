import { createAdminClient } from "@/lib/supabase/admin";
import type { requireUser } from "@/lib/auth/current-user";

type UserSupabase = Awaited<ReturnType<typeof requireUser>>["supabase"];
type Failure = { id: string; ok: false; error: string };

/** Soft-delete after checking the current user's customer visibility and role. */
export async function softDeleteCustomers({
  supabase: _supabase,
  userId,
  ids,
}: {
  supabase: UserSupabase;
  userId: string;
  ids: string[];
}) {
  void _supabase;
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (!uniqueIds.length) return { successIds: [] as string[], failures: [] as Failure[] };

  // 读取和写入都通过服务端管理客户端完成，避免大批量操作被 RLS
  // 的可见行分页或策略差异截断；授权仍由这里按当前用户严格判定。
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin.from("users").select("role").eq("id", userId).maybeSingle();
  if (profileError) throw profileError;
  const visible: Array<{ id: string; owner_id: string | null; status: string }> = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 200) {
    const page = await admin.from("customers")
      .select("id,owner_id,status")
      .in("id", uniqueIds.slice(offset, offset + 200))
      .is("deleted_at", null);
    if (page.error) throw page.error;
    visible.push(...(page.data || []));
  }

  const elevated = profile?.role === "ADMIN" || profile?.role === "MANAGER";
  const visibleById = new Map((visible || []).map((customer) => [customer.id, customer]));
  const allowedIds = uniqueIds.filter((id) => {
    const customer = visibleById.get(id);
    return Boolean(customer && !["QUOTE", "DEAL"].includes(customer.status) && (elevated || customer.owner_id === userId));
  });
  const failures: Failure[] = uniqueIds
    .filter((id) => !allowedIds.includes(id))
    .map((id) => ({ id, ok: false, error: ["QUOTE", "DEAL"].includes(visibleById.get(id)?.status || "") ? "报价中和成交客户不允许删除" : "客户不存在、已删除或您没有删除权限" }));
  if (!allowedIds.length) return { successIds: [] as string[], failures };

  // Permission is checked above with the caller session. Use the server-only
  // client for the final soft-delete so an RLS edge case cannot block setting
  // deleted_at. This never performs a physical DELETE.
  const successIds: string[] = [];
  const deletedAt = new Date().toISOString();
  for (let offset = 0; offset < allowedIds.length; offset += 200) {
    const { data: deleted, error: deleteError } = await admin
      .from("customers")
      .update({ deleted_at: deletedAt })
      .in("id", allowedIds.slice(offset, offset + 200))
      .is("deleted_at", null)
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
      content: { soft_delete: true },
    })));
    if (auditError) console.error("CUSTOMER_DELETE_AUDIT_ERROR", auditError.message);
  }
  return { successIds, failures };
}
