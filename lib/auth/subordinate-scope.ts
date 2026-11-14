import { createAdminClient } from "@/lib/supabase/admin";
import { descendantIds, wouldCreateManagerCycle } from "@/lib/auth/subordinate-tree";

export async function managerAssignmentCreatesCycle(userId: string, managerId: string) {
  return (await managerAssignmentsCreatingCycles([userId], managerId)).length > 0;
}

export async function managerAssignmentsCreatingCycles(userIds: string[], managerId: string) {
  const admin = createAdminClient();
  const users: { id: string; manager_id: string | null }[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.from("users")
      .select("id,manager_id").order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    users.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return userIds.filter((userId) => wouldCreateManagerCycle(userId, managerId, users));
}

export async function activeDescendantIds(supervisorId: string) {
  const admin = createAdminClient();
  const users: { id: string; manager_id: string | null; status: string }[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.from("users")
      // Inactive accounts remain hierarchy nodes. Traversing through them is
      // necessary so an active grandchild does not disappear from the scope.
      .select("id,manager_id,status")
      .order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    users.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  const visibleIds = descendantIds(supervisorId, users);
  const activeUsers = new Set(users.filter((user) => user.status === "ACTIVE").map((user) => user.id));
  return visibleIds.filter((id) => id === supervisorId || activeUsers.has(id));
}
