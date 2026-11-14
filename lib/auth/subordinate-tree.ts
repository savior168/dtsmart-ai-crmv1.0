type ManagedUser = { id: string; manager_id: string | null };

export function descendantIds(supervisorId: string, users: ManagedUser[]) {
  const children = new Map<string, string[]>();
  for (const user of users) {
    if (!user.manager_id) continue;
    children.set(user.manager_id, [...(children.get(user.manager_id) || []), user.id]);
  }
  const visible = new Set([supervisorId]);
  const queue = [supervisorId];
  for (let index = 0; index < queue.length; index += 1) {
    for (const childId of children.get(queue[index]) || []) {
      if (visible.has(childId)) continue;
      visible.add(childId);
      queue.push(childId);
    }
  }
  return [...visible];
}

export function wouldCreateManagerCycle(userId: string, managerId: string, users: ManagedUser[]) {
  return descendantIds(userId, users).includes(managerId);
}
