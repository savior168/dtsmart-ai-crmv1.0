import type { CurrentAccount } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export type AiOwnerOption = { id: string; name: string | null; email: string; role: string };

export async function canReadAiOwner(account: CurrentAccount, ownerId: string | null | undefined) {
  if (!ownerId) return false;
  if (ownerId === account.id || account.role === "ADMIN") return true;
  if (account.role !== "SUPERVISOR") return false;
  const directReport = await createAdminClient().from("users").select("id").eq("id", ownerId).eq("manager_id", account.id).eq("status", "ACTIVE").maybeSingle();
  if (directReport.error) throw directReport.error;
  return Boolean(directReport.data);
}

/**
 * AI screening is the one cross-user workflow where a supervisor may submit
 * a task for a direct report. Keep this scope separate from ordinary list
 * views, which intentionally default supervisors to their own records.
 */
export async function resolveAiOwnerScope(account: CurrentAccount, requestedOwnerId?: string | null) {
  const requested = String(requestedOwnerId || "").trim();
  const admin = createAdminClient();
  if (account.role === "ADMIN") {
    const users = await admin.from("users").select("id,name,email,role").eq("status", "ACTIVE").in("role", ["ADMIN", "SUPERVISOR", "SALES"]).order("name");
    if (users.error) throw users.error;
    const options = (users.data || []) as AiOwnerOption[];
    if (!requested || requested === "all") return { ownerIds: null as string[] | null, options, selectedOwnerId: "all", canSelectOwner: true, scopeLabel: "系统全部待筛选客户", allScopeLabel: "系统全部待筛选客户" };
    if (!options.some((item) => item.id === requested)) throw new Error("FORBIDDEN");
    return { ownerIds: [requested], options, selectedOwnerId: requested, canSelectOwner: true, scopeLabel: "指定用户待筛选客户", allScopeLabel: "系统全部待筛选客户" };
  }

  if (account.role === "SUPERVISOR") {
    const users = await admin.from("users").select("id,name,email,role").eq("status", "ACTIVE").or(`id.eq.${account.id},manager_id.eq.${account.id}`).in("role", ["SUPERVISOR", "SALES"]).order("name");
    if (users.error) throw users.error;
    const options = (users.data || []) as AiOwnerOption[];
    if (!requested || requested === "all") return { ownerIds: options.map((item) => item.id), options, selectedOwnerId: "all", canSelectOwner: true, scopeLabel: "我与直属下属的待筛选客户", allScopeLabel: "我与直属下属" };
    if (!options.some((item) => item.id === requested)) throw new Error("FORBIDDEN");
    return { ownerIds: [requested], options, selectedOwnerId: requested, canSelectOwner: true, scopeLabel: "指定用户待筛选客户", allScopeLabel: "我与直属下属" };
  }

  return { ownerIds: [account.id], options: [], selectedOwnerId: account.id, canSelectOwner: false, scopeLabel: "我的待筛选客户", allScopeLabel: "我的待筛选客户" };
}
