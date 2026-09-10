import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

const cleanSearch = (value: string | null) => (value || "").replace(/[%_,()"'\\]/g, "").trim().slice(0, 80);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    await requirePermission("costs.view");
    const type = request.nextUrl.searchParams.get("type");
    const search = cleanSearch(request.nextUrl.searchParams.get("q"));
    const selectedIds = [...new Set(request.nextUrl.searchParams.getAll("selected_id").filter((id) => uuidPattern.test(id)))].slice(0, 50);
    const admin = createAdminClient();
    if (type === "task") {
      let query = admin.from("ai_screening_tasks").select("id,name,task_number").order("created_at", { ascending: false }).limit(50);
      if (search) query = query.or(`name.ilike.%${search}%,task_number.ilike.%${search}%`);
      const [matched, selected] = await Promise.all([query, selectedIds.length ? admin.from("ai_screening_tasks").select("id,name,task_number").in("id", selectedIds) : Promise.resolve({ data: [], error: null })]);
      if (matched.error) throw matched.error;
      if (selected.error) throw selected.error;
      const rows = [...(selected.data || []), ...(matched.data || [])];
      return NextResponse.json({ data: [...new Map(rows.map((row) => [row.id, { id: row.id, label: row.name, description: row.task_number }])).values()] });
    }
    if (type === "customer") {
      let query = admin.from("customers").select("id,company_name,country,phone,email").is("deleted_at", null).order("company_name").limit(50);
      if (search) query = query.or(`company_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      const [matched, selected] = await Promise.all([query, selectedIds.length ? admin.from("customers").select("id,company_name,country,phone,email").in("id", selectedIds) : Promise.resolve({ data: [], error: null })]);
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
