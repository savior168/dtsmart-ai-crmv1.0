import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSupplierInput } from "@/lib/suppliers/input";

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("suppliers.view");
    const params = request.nextUrl.searchParams;
    const search = (params.get("q") || "").trim().slice(0, 80);
    const admin = createAdminClient();
    const codeOnly = account.role === "WAREHOUSE" && !hasPermission(account, "suppliers.manage");
    const columns = codeOnly ? "id,system_code,settlement_cycle,is_active" : "*";
    const page = Number(params.get("page") || "1");
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return NextResponse.json({ error: "分页参数无效" }, { status: 400 });
    const pageSize = 200;
    let query = admin.from("suppliers").select(columns, { count: "exact" }).order("system_code").range((page - 1) * pageSize, page * pageSize - 1);
    if (codeOnly || params.get("active") === "true") query = query.eq("is_active", true);
    if (search) {
      // The code is the warehouse-facing identity; never expose names through
      // this endpoint to a role restricted to code-only lookup.
      query = query.ilike("system_code", `%${search.replace(/[%_,]/g, "")}%`);
    }
    const { data, error, count } = await query;
    if (error) throw error;
    // The select list is chosen at runtime (code-only for warehouse users), so
    // supabase-js cannot infer the result shape. Both lists always include id.
    const rows = (data || []) as unknown as Array<Record<string, unknown> & { id: string }>;
    if (account.role === "ADMIN" && rows.length) {
      const ids = rows.map((row) => row.id);
      const contacts = await admin.from("supplier_private_contacts")
        .select("id,supplier_id,kind,value").in("supplier_id", ids).order("created_at");
      if (contacts.error) throw contacts.error;
      const bySupplier = new Map<string, Array<{ id: string; kind: string; value: string }>>();
      for (const contact of contacts.data || []) {
        const current = bySupplier.get(contact.supplier_id) || [];
        current.push({ id: contact.id, kind: contact.kind, value: contact.value });
        bySupplier.set(contact.supplier_id, current);
      }
      return NextResponse.json({ data: rows.map((row) => ({ ...row, private_contacts: bySupplier.get(row.id) || [] })), count: count || 0, page, page_size: pageSize });
    }
    return NextResponse.json({ data: rows, count: count || 0, page, page_size: pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : "供应商档案加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { account } = await requirePermission("suppliers.manage");
    const input = parseSupplierInput(await request.json());
    const admin = createAdminClient();
    let systemCode = input.system_code;
    if (input.settlement_cycle === "CASH" && !systemCode) {
      const generated = await admin.rpc("next_supplier_cash_code");
      if (generated.error) throw generated.error;
      systemCode = String(generated.data);
    }
    const { data, error } = await admin.from("suppliers").insert({
      ...input, system_code: systemCode, created_by: account.id, updated_by: account.id,
    }).select("*").single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: `供应商代码 ${systemCode} 已存在，请从供应商档案中选择；不要重复建档` }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "新增供应商失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
