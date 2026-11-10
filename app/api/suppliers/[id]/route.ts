import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSupplierInput } from "@/lib/suppliers/input";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, context: Context) {
  try {
    const { account } = await requirePermission("suppliers.view");
    const { id } = await context.params;
    const codeOnly = account.role === "WAREHOUSE" && !hasPermission(account, "suppliers.manage");
    const columns = codeOnly ? "id,system_code" : "*";
    let query = createAdminClient().from("suppliers").select(columns).eq("id", id);
    if (codeOnly) query = query.eq("is_active", true);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "供应商不存在" }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "供应商详情加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { account } = await requirePermission("suppliers.manage");
    const { id } = await context.params;
    const body = await request.json();
    const admin = createAdminClient();
    const old = await admin.from("suppliers").select("id,system_code,legacy_code,settlement_cycle,is_active").eq("id", id).maybeSingle();
    if (old.error) throw old.error;
    if (!old.data) return NextResponse.json({ error: "供应商不存在" }, { status: 404 });
    const input = parseSupplierInput(body, old.data.is_active);
    const linked = await admin.from("supplier_delivery_notes").select("id", { count: "exact", head: true }).eq("supplier_id", id);
    if (linked.error) throw linked.error;
    const changingCode = Boolean(input.system_code && input.system_code !== old.data.system_code);
    const changingLegacyCode = input.legacy_code !== old.data.legacy_code;
    if (linked.count && (changingCode || changingLegacyCode)) {
      throw new Error("该供应商已有送货单，供应商代码不可修改；商务条件可调整，历史送货单保留原记录");
    }
    const changingSystemCode = changingCode || (input.settlement_cycle === "CASH"
      && old.data.settlement_cycle !== "CASH" && !old.data.system_code);
    let systemCode = old.data.system_code;
    if (changingSystemCode) {
      if (input.settlement_cycle === "CASH" && !input.system_code) {
        const generated = await admin.rpc("next_supplier_cash_code");
        if (generated.error) throw generated.error;
        systemCode = String(generated.data);
      } else systemCode = input.system_code!;
    }
    const { data, error } = await admin.from("suppliers").update({
      ...input, system_code: systemCode,
      updated_by: account.id, updated_at: new Date().toISOString(),
    }).eq("id", id).select("*").single();
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "修改供应商失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const { account } = await requirePermission("suppliers.manage");
    const { id } = await context.params;
    if (request.nextUrl.searchParams.get("permanent") === "true") {
      const { data, error } = await createAdminClient().rpc("delete_unlinked_supplier", { p_supplier_id: id });
      if (error) {
        if (error.code === "P0001" || error.code === "23503") {
          return NextResponse.json({ error: "该供应商已有业务关联，请停用档案，不能删除" }, { status: 409 });
        }
        throw error;
      }
      if (!data) return NextResponse.json({ error: "供应商不存在" }, { status: 404 });
      return NextResponse.json({ deleted: true });
    }
    // Referenced suppliers are retained for historical reconciliation; the
    // delete action is an explicit soft deactivation, never a cascading delete.
    const { data, error } = await createAdminClient().from("suppliers")
      .update({ is_active: false, updated_by: account.id, updated_at: new Date().toISOString() })
      .eq("id", id).select("id,system_code,is_active").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "供应商不存在" }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "停用供应商失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
