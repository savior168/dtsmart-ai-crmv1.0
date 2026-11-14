import type { CurrentAccount } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { activeDescendantIds } from "@/lib/auth/subordinate-scope";

export type AiOwnerOption = { id: string; name: string | null; email: string; role: string };

export async function canReadAiOwner(account: CurrentAccount, ownerId: string | null | undefined) {
  if (!ownerId) return false;
  if (ownerId === account.id || account.role === "ADMIN") return true;
  if (account.role !== "SUPERVISOR" || !account.supervisor_can_view_subordinates) return false;
  return (await activeDescendantIds(account.id)).includes(ownerId);
}

/**
 * AI screening is the one cross-user workflow where a supervisor may submit
 * a task for a subordinate. Keep this scope separate from ordinary list
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

  if (account.role === "SUPERVISOR" && account.supervisor_can_view_subordinates) {
    const ownerIds = await activeDescendantIds(account.id);
    const users = await admin.from("users").select("id,name,email,role").eq("status", "ACTIVE").in("id", ownerIds).in("role", ["SUPERVISOR", "SALES"]).order("name");
    if (users.error) throw users.error;
    const options = (users.data || []) as AiOwnerOption[];
    if (!requested || requested === "all") return { ownerIds: options.map((item) => item.id), options, selectedOwnerId: "all", canSelectOwner: true, scopeLabel: "我与下属的待筛选客户", allScopeLabel: "我与下属" };
    if (!options.some((item) => item.id === requested)) throw new Error("FORBIDDEN");
    return { ownerIds: [requested], options, selectedOwnerId: requested, canSelectOwner: true, scopeLabel: "指定用户待筛选客户", allScopeLabel: "我与下属" };
  }

  return { ownerIds: [account.id], options: [], selectedOwnerId: account.id, canSelectOwner: false, scopeLabel: "我的待筛选客户", allScopeLabel: "我的待筛选客户" };
}
