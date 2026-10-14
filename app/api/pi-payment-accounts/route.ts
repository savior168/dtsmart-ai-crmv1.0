import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function GET() {
  try {
    const { supabase, account } = await requirePermission("orders.view");
    let query = supabase.from("pi_payment_accounts").select("id,label,currency,instructions,active,created_at,updated_at").order("created_at", { ascending: false });
    if (account.role !== "ADMIN") query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ data: data || [], can_manage: account.role === "ADMIN" });
  } catch (error) {
    const message = sqlErrorMessage(error, "收款账户加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("pi.accounts.manage");
    if (account.role !== "ADMIN") throw new Error("FORBIDDEN");
    const body = await request.json() as Record<string, unknown>;
    const label = String(body.label || "").trim();
    const currency = String(body.currency || "").trim().toUpperCase();
    const instructions = String(body.instructions || "").trim();
    if (!label || label.length > 120 || !/^[A-Z]{3}$/.test(currency) || !instructions || instructions.length > 2000) {
      throw new Error("请填写账户名称、三位币种代码及完整收款信息");
    }
    const { data, error } = await supabase.from("pi_payment_accounts")
      .insert({ label, currency, instructions }).select("id,label,currency,instructions,active").single();
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = sqlErrorMessage(error, "收款账户保存失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("pi.accounts.manage");
    if (account.role !== "ADMIN") throw new Error("FORBIDDEN");
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("账户编号不正确");
    const active = body.active;
    const label = String(body.label || "").trim();
    const currency = String(body.currency || "").trim().toUpperCase();
    const instructions = String(body.instructions || "").trim();
    if (typeof active !== "boolean" || !label || label.length > 120 || !/^[A-Z]{3}$/.test(currency) || !instructions || instructions.length > 2000) throw new Error("请填写有效的账户名称、币种、收款信息和状态");
    const { data, error } = await supabase.from("pi_payment_accounts")
      .update({ label, currency, instructions, active, updated_at: new Date().toISOString() }).eq("id", id)
      .select("id,label,currency,instructions,active").single();
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    const message = sqlErrorMessage(error, "收款账户状态更新失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
