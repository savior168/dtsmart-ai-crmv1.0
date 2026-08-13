import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("UNAUTHORIZED");
  return { supabase, user };
}

export async function writeAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  content: Record<string, unknown>,
) {
  const { error } = await supabase.from("audit_logs").insert({
    user_id: userId,
    action,
    target_type: targetType,
    target_id: targetId,
    content,
  });
  if (error) throw error;
}
