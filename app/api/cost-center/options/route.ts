import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { costLedgerRange } from "@/lib/cost-center";
import { createAdminClient } from "@/lib/supabase/admin";

const cleanSearch = (value: string | null) => (value || "").replace(/[%_,()"'\\]/g, "").trim().slice(0, 80);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const selectedIds = (request: NextRequest, key: string) => [...new Set(request.nextUrl.searchParams.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter((value) => uuidPattern.test(value)))].slice(0, 50);

async function ledgerIds(request: NextRequest, type: "task" | "customer") {
  const params = request.nextUrl.searchParams;
  const range = costLedgerRange(params.get("from"), params.get("to"));
  const provider = params.get("provider")?.trim() || "";
  const operation = cleanSearch(params.get("operation"));
  const userId = params.get("user_id")?.trim() || "";
  const taskIds = selectedIds(request, "task_id");
  const customerIds = selectedIds(request, "customer_id");
  const admin = createAdminClient();
  const ids = new Set<string>();

  for (let offset = 0; ; offset += 1000) {
    let query = admin.from("api_cost_ledger")
      .select(type === "task" ? "task_id" : "customer_id")
      .gte("occurred_at", range.from).lt("occurred_at", range.to)
      .not(type === "task" ? "task_id" : "customer_id", "is", null)
      .range(offset, offset + 999);
    if (provider) query = query.eq("provider", provider);
    if (operation) query = query.or(`operation.ilike.%${operation}%,model_or_sku.ilike.%${operation}%`);
    if (userId && uuidPattern.test(userId)) query = query.eq("user_id", userId);
    // A task picker is narrowed by the selected customers; a customer picker is
    // narrowed by selected tasks. Never apply the picker’s own selection here.
    if (type === "task" && customerIds.length) query = query.in("customer_id", customerIds);
    if (type === "customer" && taskIds.length) query = query.in("task_id", taskIds);
    const result = await query;
    if (result.error) throw result.error;
    const rows = (result.data || []) as Array<{ task_id?: string | null; customer_id?: string | null }>;
    for (const row of rows) {
      const id = String((type === "task" ? row.task_id : row.customer_id) || "");
      if (uuidPattern.test(id)) ids.add(id);
    }
    if (rows.length < 1000) break;
  }
  return { ids: [...ids], selected: selectedIds(request, "selected_id"), search: cleanSearch(params.get("q")), admin };
}

export async function GET(request: NextRequest) {
  try {
    await requirePermission("costs.view");
    const type = request.nextUrl.searchParams.get("type");
    if (type === "task") {
      const { ids, selected: selectedTaskIds, search, admin } = await ledgerIds(request, "task");
      if (!ids.length && !selectedTaskIds.length) return NextResponse.json({ data: [] });
      let query = admin.from("ai_screening_tasks").select("id,name,task_number").in("id", ids.length ? ids : selectedTaskIds).order("created_at", { ascending: false }).limit(50);
      if (search) query = query.or(`name.ilike.%${search}%,task_number.ilike.%${search}%`);
      const [matched, selected] = await Promise.all([query, selectedTaskIds.length ? admin.from("ai_screening_tasks").select("id,name,task_number").in("id", selectedTaskIds) : Promise.resolve({ data: [], error: null })]);
      if (matched.error) throw matched.error;
      if (selected.error) throw selected.error;
      const rows = [...(selected.data || []), ...(matched.data || [])];
      return NextResponse.json({ data: [...new Map(rows.map((row) => [row.id, { id: row.id, label: row.name, description: row.task_number }])).values()] });
    }
    if (type === "customer") {
      const { ids, selected: selectedCustomerIds, search, admin } = await ledgerIds(request, "customer");
      if (!ids.length && !selectedCustomerIds.length) return NextResponse.json({ data: [] });
      let query = admin.from("customers").select("id,company_name,country,phone,email").is("deleted_at", null).in("id", ids.length ? ids : selectedCustomerIds).order("company_name").limit(50);
      if (search) query = query.or(`company_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      const [matched, selected] = await Promise.all([query, selectedCustomerIds.length ? admin.from("customers").select("id,company_name,country,phone,email").in("id", selectedCustomerIds) : Promise.resolve({ data: [], error: null })]);
      if (matched.error) throw matched.error;
      if (selected.error) throw selected.error;
      const rows = [...(selected.data || []), ...(matched.data || [])];
      return NextResponse.json({ data: [...new Map(rows.map((row) => [row.id, { id: row.id, label: row.company_name, description: [row.country, row.phone || row.email].filter(Boolean).join(" · ") }])).values()] });
    }
    return NextResponse.json({ error: "筛选类型不正确" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "筛选选项加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
