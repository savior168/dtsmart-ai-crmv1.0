import { NextRequest, NextResponse } from "next/server";
import { requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("customers.view");
    const ownerId = await requestedOwnerId(request, account, "customers.data_all");
    if (ownerId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)) {
      return NextResponse.json({ error: "无效的归属人" }, { status: 400 });
    }
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = 20;
    const admin = createAdminClient();
    let query = admin.from("customer_claims")
      .select("id,customer_id,user_id,source_owner_id,owner_name,released_at,release_reason,created_at", { count: "exact" })
      .eq("action", "RELEASE");
    if (ownerId) query = query.or(`source_owner_id.eq.${ownerId},and(source_owner_id.is.null,user_id.eq.${ownerId})`);
    const result = await query.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    const customerIds = [...new Set((result.data || []).map((item) => item.customer_id).filter(Boolean))];
    const ownerIds = [...new Set((result.data || []).map((item) => item.source_owner_id || item.user_id).filter(Boolean))];
    const [customers, owners] = await Promise.all([
      customerIds.length ? admin.from("customers").select("id,company_name,country,owner_id,pool_status,deleted_at").in("id", customerIds) : Promise.resolve({ data: [], error: null }),
      ownerIds.length ? admin.from("users").select("id,name,email").in("id", ownerIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (customers.error) throw customers.error;
    if (owners.error) throw owners.error;
    const customerById = new Map((customers.data || []).map((item) => [item.id, item]));
    const ownerById = new Map((owners.data || []).map((item) => [item.id, item]));
    return NextResponse.json({
      data: (result.data || []).map((item) => {
        const customer = customerById.get(item.customer_id);
        const owner = ownerById.get(item.source_owner_id || item.user_id);
        return {
          id: item.id,
          customer_name: customer?.company_name || "已删除客户",
          country: customer?.country || null,
          previous_owner: owner?.name || owner?.email || item.owner_name || "未知归属人",
          released_at: item.released_at || item.created_at,
          release_reason: item.release_reason || null,
          current_state: !customer || customer.deleted_at ? "已删除" : customer.owner_id ? "现已重新认领" : customer.pool_status === "AVAILABLE" ? "已回公海" : "未归属",
        };
      }),
      count: result.count || 0,
      page,
      page_size: pageSize,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "释放记录加载失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
