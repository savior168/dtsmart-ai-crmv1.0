import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("customers.renew.review");
    if (!["SUPERVISOR", "ADMIN"].includes(account.role)) throw new Error("FORBIDDEN");
    if (account.role === "SUPERVISOR" && !account.supervisor_can_view_subordinates) throw new Error("FORBIDDEN");
    const admin = createAdminClient();
    const status = request.nextUrl.searchParams.get("status") || "PENDING";
    let query = admin.from("customer_protection_renewal_requests").select(
      "id,customer_id,owner_id,renewal_number,reason,next_plan,evidence_attachment_id,status,review_note,created_at,reviewed_at,customer:customers(company_name,country,industry),owner:users!customer_protection_renewal_requests_owner_id_fkey(name,email,manager_id)",
    ).eq("status", status).order("created_at", { ascending: false });
    if (account.role === "SUPERVISOR") query = query.eq("owner.manager_id", account.id);
    const result = await query;
    if (result.error) throw result.error;
    const data = account.role === "SUPERVISOR"
      ? (result.data || []).filter((item) => {
          const owner = Array.isArray(item.owner) ? item.owner[0] : item.owner;
          return owner?.manager_id === account.id;
        })
      : result.data || [];
    return NextResponse.json({ data, count: data.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "续期申请加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("customers.renew.review");
    if (account.role === "SUPERVISOR" && !account.supervisor_can_view_subordinates) throw new Error("FORBIDDEN");
    const body = await request.json();
    const result = await supabase.rpc("review_customer_protection_renewal", {
      p_request_id: String(body.request_id || ""),
      p_decision: String(body.decision || ""),
      p_review_note: String(body.review_note || ""),
    });
    if (result.error) throw result.error;
    return NextResponse.json({ success: true, data: result.data, message: body.decision === "APPROVED" ? "续期申请已通过" : "续期申请已驳回" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "续期审核失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
