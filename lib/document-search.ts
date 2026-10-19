import { createAdminClient } from "@/lib/supabase/admin";

const MAX_MATCHES = 200;

/** Customer profile matches are resolved before the visibility-scoped document query. */
export async function matchingCustomerIds(term: string): Promise<string[]> {
  if (!term) return [];
  const admin = createAdminClient();
  const { data, error } = await admin.from("customers").select("id")
    .or(["company_name", "contact_name", "phone", "email"]
      .map((column) => `${column}.ilike.%${term}%`).join(","))
    .range(0, MAX_MATCHES);
  if (error) throw error;
  if ((data || []).length > MAX_MATCHES) throw new Error("匹配的客户过多，请输入更具体的搜索内容");
  return (data || []).map(({ id }) => id);
}

export async function matchingOrderIds(customerIds: string[]): Promise<string[]> {
  if (!customerIds.length) return [];
  const admin = createAdminClient();
  const { data, error } = await admin.from("sales_orders").select("id")
    .in("customer_id", customerIds).range(0, MAX_MATCHES);
  if (error) throw error;
  if ((data || []).length > MAX_MATCHES) throw new Error("匹配的单据过多，请输入更具体的搜索内容");
  return (data || []).map(({ id }) => id);
}

export function normalizeDocumentSearch(value: string | null): string {
  const term = (value || "").trim().replace(/[%_*(),\\"]/g, "");
  if (term.length > 120) throw new Error("搜索内容不能超过120个字符");
  return term;
}

export function documentSearchFilter(
  term: string,
  columns: readonly string[],
  idColumn: string,
  ids: string[],
): string {
  const direct = columns.map((column) => `${column}.ilike.%${term}%`);
  if (ids.length) direct.push(`${idColumn}.in.(${ids.join(",")})`);
  return direct.join(",");
}
