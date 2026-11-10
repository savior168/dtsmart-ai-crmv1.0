import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

const fields = "id,type,category,title,content,metadata,href,entity_type,entity_id,read_at,dismissed_at,acknowledged_at,archived_at,action_status,deliver_at,created_at";

type NoticeRow = {
  id: string; type: string; content: string | null; metadata: Record<string, unknown> | null;
  entity_type: string | null; entity_id: string | null; created_at: string;
};

const stageLabel: Record<string, string> = {
  DRAFT: "待完善", WAITING: "待仓库接单", PREPARING: "采购中", RECEIVED: "已回货",
  SORTING: "理货中", READY_TO_SHIP: "待交货代", SHIPPED: "已交货代", SHORTAGE: "缺货异常", CANCELLED: "已取消",
};

function cleanName(name: unknown, fallback = "用户") {
  const value = String(name || "").replace(/[\r\n<>]/g, " ").trim();
  return value.slice(0, 80) || fallback;
}

async function enrichOperationNotices(rows: NoticeRow[]) {
  const targets = rows.filter(row => ["STOCK_ORDER_CREATED", "STOCK_STATUS_CHANGED", "PI_CHANGE_REQUESTED", "PI_CHANGE_APPLIED", "PI_CHANGE_REJECTED"].includes(row.type));
  if (!targets.length) return rows;
  try {
    const admin = createAdminClient();
    const stockIds = [...new Set(targets.filter(row => row.entity_type === "stock_order" && row.entity_id).map(row => row.entity_id!))];
    const orderIds = [...new Set(targets.filter(row => row.entity_type === "sales_order" && row.entity_id).map(row => row.entity_id!))];
    const [stocksResult, eventsResult] = await Promise.all([
      stockIds.length ? admin.from("stock_orders").select("id,sales_order_id,sales_user_id,warehouse_reference_number,order_number").in("id", stockIds) : Promise.resolve({ data: [], error: null }),
      stockIds.length ? admin.from("stock_order_events").select("stock_order_id,from_status,to_status,note,created_by,created_at").in("stock_order_id", stockIds).order("created_at", { ascending: false }).limit(2000) : Promise.resolve({ data: [], error: null }),
    ]);
    // A failed enrichment must never hide a notification or block the inbox.
    if (stocksResult.error || eventsResult.error) return rows;
    const stocks = stocksResult.data || [];
    const events = eventsResult.data || [];
    const salesOrderIds = [...new Set([...orderIds, ...stocks.map(row => row.sales_order_id)])];
    const directOrdersResult = salesOrderIds.length
      ? await admin.from("sales_orders").select("id,sales_user_id,prepared_by,warehouse_reference_number,order_number").in("id", salesOrderIds)
      : { data: [], error: null };
    if (directOrdersResult.error) return rows;
    const orders = directOrdersResult.data || [];
    const amendmentQuery = salesOrderIds.length
      ? await admin.from("pi_amendment_requests").select("id,sales_order_id,stock_order_id,requested_by,decided_by,status,reason,decision_note,created_at,decided_at").in("sales_order_id", salesOrderIds).order("created_at", { ascending: false }).limit(1000)
      : { data: [], error: null };
    if (amendmentQuery.error) return rows;
    const amendments = amendmentQuery.data || [];
    const userIds = new Set<string>();
    for (const event of events) userIds.add(event.created_by);
    for (const order of orders) {
      if (order.sales_user_id) userIds.add(order.sales_user_id);
      if (order.prepared_by) userIds.add(order.prepared_by);
    }
    for (const stock of stocks) if (stock.sales_user_id) userIds.add(stock.sales_user_id);
    for (const amendment of amendments) {
      userIds.add(amendment.requested_by);
      if (amendment.decided_by) userIds.add(amendment.decided_by);
    }
    const usersResult = userIds.size
      ? await admin.from("users").select("id,name,email,role").in("id", [...userIds])
      : { data: [], error: null };
    if (usersResult.error) return rows;
    const users = new Map((usersResult.data || []).map(user => [user.id, user]));
    const stockMap = new Map(stocks.map(stock => [stock.id, stock]));
    const orderMap = new Map(orders.map(order => [order.id, order]));
    const lookupEvent = (stockId: string, createdAt: string) => events.find(event => event.stock_order_id === stockId && Date.parse(event.created_at) <= Date.parse(createdAt) + 2000);
    const businessNumber = (stock: typeof stocks[number] | undefined, order: typeof orders[number] | undefined) => String(stock?.warehouse_reference_number || order?.warehouse_reference_number || stock?.order_number || order?.order_number || "未编号");
    return rows.map(row => {
      if (["PI_CHANGE_REQUESTED", "PI_CHANGE_APPLIED", "PI_CHANGE_REJECTED"].includes(row.type)) {
        const stock = row.entity_type === "stock_order" && row.entity_id ? stockMap.get(row.entity_id) : null;
        const order = row.entity_type === "sales_order" && row.entity_id ? orderMap.get(row.entity_id) : stock ? orderMap.get(stock.sales_order_id) : null;
        if (!order) return row;
        const number = businessNumber(stock || undefined, order);
        const related = amendments.filter(item => item.sales_order_id === order.id)
          .find(item => row.type === "PI_CHANGE_REQUESTED"
          ? Date.parse(item.created_at) <= Date.parse(row.created_at) + 2000
            : item.status === (row.type === "PI_CHANGE_APPLIED" ? "APPLIED" : "REJECTED") && item.decided_at && Date.parse(item.decided_at) <= Date.parse(row.created_at) + 2000);
        if (!related) return row;
        const actorId = row.type === "PI_CHANGE_REQUESTED" ? related.requested_by : related.decided_by;
        const actor = actorId ? users.get(actorId) : null;
        const who = actor ? cleanName(actor.name, actor.email) : "用户";
        const reason = String(row.type === "PI_CHANGE_REQUESTED" ? related.reason : related.decision_note || "").replace(/\s+/g, " ").trim();
        const action = row.type === "PI_CHANGE_REQUESTED" ? "发起了PI订单变更申请" : row.type === "PI_CHANGE_APPLIED" ? "确认并同步了PI订单变更" : "退回了PI订单变更申请";
        const prompt = row.type === "PI_CHANGE_REQUESTED" ? "请核对变更内容并确认。" : row.type === "PI_CHANGE_APPLIED" ? "变更已同步至备货单，请核对最新明细。" : "请根据退回意见处理。";
        const content = `${who}：${action}，订单号 ${number}${reason ? `；说明：${reason}` : ""}。${prompt}`.slice(0, 500);
        return { ...row, content, metadata: { ...(row.metadata || {}), order_number: number, ...(actor ? { actor_name: cleanName(actor.name, actor.email) } : {}) } };
      }
      if (!["STOCK_ORDER_CREATED", "STOCK_STATUS_CHANGED"].includes(row.type) || row.entity_type !== "stock_order" || !row.entity_id) return row;
      const stock = stockMap.get(row.entity_id);
      if (!stock) return row;
      const order = orderMap.get(stock.sales_order_id) || null;
      const number = businessNumber(stock, order || undefined);
      const event = lookupEvent(stock.id, row.created_at);
      const actor = event ? users.get(event.created_by) : null;
      const sales = users.get(stock.sales_user_id);
      const preparer = order?.prepared_by ? users.get(order.prepared_by) : null;
      let content = row.content || "";
      if (row.type === "STOCK_ORDER_CREATED" && actor) {
        if (preparer && preparer.id === actor.id && preparer.id !== stock.sales_user_id) {
          content = `${cleanName(actor.name, actor.email)}：为 ${cleanName(sales?.name, "用户")} 提交订单 ${number} 的备货单，请及时安排备货。`;
        } else {
          content = `${cleanName(actor.name, actor.email)}：提交订单 ${number} 的备货单，请及时安排备货。`;
        }
      } else if (row.type === "STOCK_STATUS_CHANGED" && actor && event) {
        const detail = String(event.note || "").replace(/\s+/g, " ").trim();
        const transition = event.from_status && event.to_status
          ? `备货状态由${stageLabel[event.from_status] || event.from_status}更新为${stageLabel[event.to_status] || event.to_status}` : "更新了备货信息";
        const actionPrompt = event.to_status === "SHORTAGE" ? "请尽快协调处理。"
          : event.to_status === "READY_TO_SHIP" ? "请核对并安排交货代。"
            : event.to_status === "SHIPPED" ? "请跟进客户并复核预估成本。" : "请及时查看并按需处理。";
        content = detail
          ? `${cleanName(actor.name, actor.email)}：对订单 ${number} 执行备货操作：${detail}。${actionPrompt}`.slice(0, 500)
          : `${cleanName(actor.name, actor.email)}：将订单 ${number} 的${transition}。${actionPrompt}`;
      }
      return { ...row, content, metadata: { ...(row.metadata || {}), order_number: number, ...(actor ? { actor_name: cleanName(actor.name, actor.email) } : {}), ...(sales?.name ? { salesperson_name: cleanName(sales.name) } : {}), ...(preparer?.name ? { preparer_name: cleanName(preparer.name) } : {}) } };
    });
  } catch {
    return rows;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user, account } = await requireUser({ allowPasswordChange: true });
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(500, Math.max(10, Number(params.get("page_size") || 20)));
    const status = params.get("status") || (params.get("unread") === "true" ? "unread" : "active");
    if (status !== "modal" && !hasPermission(account, "notifications.view")) throw new Error("FORBIDDEN");
    const now = new Date().toISOString();
    let query = supabase.from("system_notifications").select(fields, { count: "exact" })
      .eq("recipient_id", user.id).lte("deliver_at", now);
    if (status === "modal") query = query.eq("type", "SYSTEM_ANNOUNCEMENT")
      .in("metadata->>delivery_level", ["IMPORTANT", "CRITICAL"])
      .is("acknowledged_at", null).is("dismissed_at", null).is("archived_at", null)
      .order("action_status", { ascending: false }).order("deliver_at", { ascending: true });
    else if (status === "unread") query = query.is("read_at", null).is("archived_at", null);
    else if (status === "pending") query = query.eq("action_status", "PENDING").is("archived_at", null);
    else if (status === "archived") query = query.not("archived_at", "is", null);
    else if (status !== "all") query = query.is("archived_at", null);
    if (status !== "modal") query = query.order("deliver_at", { ascending: false });
    query = query.range((page - 1) * pageSize, page * pageSize - 1);
    const [rows, unreadResult, pendingResult] = await Promise.all([
      query,
      supabase.from("system_notifications").select("id", { count: "exact", head: true }).eq("recipient_id", user.id).lte("deliver_at", now).is("read_at", null).is("archived_at", null),
      supabase.from("system_notifications").select("id", { count: "exact", head: true }).eq("recipient_id", user.id).lte("deliver_at", now).eq("action_status", "PENDING").is("archived_at", null),
    ]);
    if (rows.error) throw rows.error;
    return NextResponse.json({ data: await enrichOperationNotices((rows.data || []) as NoticeRow[]), count: rows.count || 0, unread: unreadResult.count || 0, pending: pendingResult.count || 0, page, page_size: pageSize, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user, account } = await requireUser({ allowPasswordChange: true });
    const body = await request.json() as { id?: string; action?: "READ" | "READ_ALL" | "ARCHIVE" | "RESTORE" | "RESOLVE" | "DISMISS" | "ACKNOWLEDGE" };
    const action = body.action || (body.id ? "READ" : "READ_ALL");
    if (action !== "ACKNOWLEDGE" && action !== "DISMISS" && !hasPermission(account, "notifications.view")) throw new Error("FORBIDDEN");
    if (!["READ", "READ_ALL", "ARCHIVE", "RESTORE", "RESOLVE", "DISMISS", "ACKNOWLEDGE"].includes(action)) {
      return NextResponse.json({ error: "通知操作无效" }, { status: 400 });
    }
    const now = new Date().toISOString();
    if (action === "ACKNOWLEDGE") {
      if (!body.id) return NextResponse.json({ error: "缺少公告编号" }, { status: 400 });
      const { data, error } = await supabase.from("system_notifications")
        .update({ acknowledged_at: now, read_at: now, action_status: "RESOLVED" })
        .eq("id", body.id).eq("recipient_id", user.id).eq("type", "SYSTEM_ANNOUNCEMENT")
        .in("metadata->>delivery_level", ["IMPORTANT", "CRITICAL"]).is("acknowledged_at", null)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "公告不存在或已确认，请刷新后重试" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    let query = supabase.from("system_notifications").update(
      action === "DISMISS" ? { dismissed_at: now }
        : action === "ARCHIVE" ? { archived_at: now, read_at: now }
        : action === "RESTORE" ? { archived_at: null }
          : action === "RESOLVE" ? { action_status: "RESOLVED", read_at: now }
            : { read_at: now },
    ).eq("recipient_id", user.id);
    if (action === "READ_ALL") query = query.is("read_at", null).is("archived_at", null)
      .lte("deliver_at", now).or("type.neq.SYSTEM_ANNOUNCEMENT,metadata->>delivery_level.eq.NORMAL");
    else {
      if (!body.id) return NextResponse.json({ error: "缺少通知编号" }, { status: 400 });
      query = query.eq("id", body.id);
      if (action === "DISMISS" && !hasPermission(account, "notifications.view")) query = query.eq("type", "SYSTEM_ANNOUNCEMENT").eq("metadata->>delivery_level", "IMPORTANT");
    }
    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "通知更新失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
