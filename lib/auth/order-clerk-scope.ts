import { createAdminClient } from "@/lib/supabase/admin";

export async function assignedSalesIds(clerkId: string): Promise<string[]> {
  const { data, error } = await createAdminClient().from("order_clerk_sales_assignments")
    .select("sales_user_id").eq("clerk_user_id", clerkId);
  if (error) throw error;
  return (data || []).map((row) => row.sales_user_id);
}

export async function requireAssignedSales(clerkId: string, salesUserId: string): Promise<void> {
  const { data, error } = await createAdminClient().from("order_clerk_sales_assignments")
    .select("sales_user_id").eq("clerk_user_id", clerkId).eq("sales_user_id", salesUserId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("FORBIDDEN");
}
