import { createAdminClient } from "@/lib/supabase/admin";
import type { requireUser } from "@/lib/auth/current-user";

type UserSupabase = Awaited<ReturnType<typeof requireUser>>["supabase"];
type Failure = { id: string; ok: false; error: string };

/** Soft-delete after checking the current user's customer visibility and role. */
export async function softDeleteCustomers({
  supabase,
  userId,
  ids,
}: {
  supabase: UserSupabase;
  userId: string;
  ids: string[];
}) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (!uniqueIds.length) return { successIds: [] as string[], failures: [] as Failure[] };

  const [{ data: profile, error: profileError }, { data: visible, error: visibleError }] = await Promise.all([
    supabase.from("users").select("role").eq("id", userId).maybeSingle(),
    supabase.from("customers").select("id,owner_id,created_by").in("id", uniqueIds).is("deleted_at", null),
  ]);
  if (profileError) throw profileError;
  if (visibleError) throw visibleError;

  const elevated = profile?.role === "ADMIN" || profile?.role === "MANAGER";
  const visibleById = new Map((visible || []).map((customer) => [customer.id, customer]));
  const allowedIds = uniqueIds.filter((id) => {
    const customer = visibleById.get(id);
    return Boolean(customer && (elevated || customer.owner_id === userId || customer.created_by === userId));
  });
  const failures: Failure[] = uniqueIds
    .filter((id) => !allowedIds.includes(id))
    .map((id) => ({ id, ok: false, error: "客户不存在、已删除或您没有删除权限" }));
  if (!allowedIds.length) return { successIds: [] as string[], failures };

  // Permission is checked above with the caller session. Use the server-only
  // client for the final soft-delete so an RLS edge case cannot block setting
  // deleted_at. This never performs a physical DELETE.
  const admin = createAdminClient();
  const { data: deleted, error: deleteError } = await admin
    .from("customers")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", allowedIds)
    .is("deleted_at", null)
    .select("id");
  if (deleteError) throw deleteError;

  const successIds = (deleted || []).map((customer) => customer.id);
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
