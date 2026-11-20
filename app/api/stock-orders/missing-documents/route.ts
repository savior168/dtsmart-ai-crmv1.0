import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadStockProgressItems } from "@/lib/stock-progress-query";
import { summarizeStockProgress } from "@/lib/stock-progress";

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("stock.view");
    if (!["WAREHOUSE", "ADMIN"].includes(account.role)
      || !hasPermission(account, "supplier.documents.view")) throw new Error("FORBIDDEN");
    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 2000) throw new Error("分页参数无效");
    const { data, error } = await supabase.rpc("list_missing_shipped_pi_documents", {
      p_limit: 50, p_offset: (page - 1) * 50,
    });
    if (error) throw error;
    const rows: Array<{ stock_order_id: string; order_number: string; missing_number_count: number; missing_image_count: number; total_count: number }> = data || [];
    if (!rows.length) return NextResponse.json({ data: rows, count: 0, page });
    // The queue RPC is security-definer. Only emit detail links for stock rows
    // the caller can actually read through the same RLS path as the detail API.
    const visible = await supabase.from("stock_orders").select("id,status")
      .in("id", rows.map((row) => row.stock_order_id));
    if (visible.error) throw visible.error;
    const visibleIds = new Set((visible.data || []).map((row) => row.id));
    const scopedRows = rows.filter((row) => visibleIds.has(row.stock_order_id));
    if (!scopedRows.length) return NextResponse.json({ data: [], count: 0, page });
    const statusById = new Map((visible.data || []).map((row) => [row.id, row.status]));
    const progressItems = await loadStockProgressItems(supabase, scopedRows.map((row) => row.stock_order_id));
    const admin = createAdminClient();
    const [items, stockOrders] = await Promise.all([
      admin.from("stock_order_items").select("id,stock_order_id,received_quantity,shipped_quantity")
        .in("stock_order_id", scopedRows.map((row) => row.stock_order_id)).is("pi_amendment_cancelled_at", null),
      admin.from("stock_orders").select("id,stock_number")
        .in("id", scopedRows.map((row) => row.stock_order_id)),
    ]);
    if (items.error) throw items.error;
    if (stockOrders.error) throw stockOrders.error;
    const stockNumberById = new Map((stockOrders.data || []).map((order) => [order.id, order.stock_number]));
    const receiptItems = (items.data || []).filter((item) => item.received_quantity > 0 || item.shipped_quantity > 0);
    const itemIds = receiptItems.map((item) => item.id);
    const allocations = itemIds.length ? await admin.from("supplier_receipt_allocations")
      .select("stock_order_item_id,delivery_note_id").in("stock_order_item_id", itemIds)
      .gt("quantity", 0).is("correction_of", null) : { data: [], error: null };
    if (allocations.error) throw allocations.error;
    const noteIds = [...new Set((allocations.data || []).map((allocation) => allocation.delivery_note_id))];
    const [notes, photos] = await Promise.all([
      noteIds.length ? admin.from("supplier_delivery_notes").select("id,note_number,number_pending").in("id", noteIds) : Promise.resolve({ data: [], error: null }),
      noteIds.length ? admin.from("attachments").select("supplier_delivery_note_id").in("supplier_delivery_note_id", noteIds).is("supplier_photo_superseded_at", null) : Promise.resolve({ data: [], error: null }),
    ]);
    if (notes.error) throw notes.error;
    if (photos.error) throw photos.error;
    const orderByItem = new Map(receiptItems.map((item) => [item.id, item.stock_order_id]));
    const photographed = new Set((photos.data || []).map((photo) => photo.supplier_delivery_note_id));
    const missingNotesByOrder = new Map<string, Set<string>>();
    const noteNumbersByOrder = new Map<string, Set<string>>();
    const pendingNumbersByOrder = new Map<string, Set<string>>();
    const pendingPhotosByOrder = new Map<string, Set<string>>();
    const notesById = new Map((notes.data || []).map((note) => [note.id, note]));
    for (const allocation of allocations.data || []) {
      const orderId = orderByItem.get(allocation.stock_order_item_id);
      const note = notesById.get(allocation.delivery_note_id);
      if (!orderId || !note) continue;
      if (!note.number_pending && note.note_number) {
        if (!noteNumbersByOrder.has(orderId)) noteNumbersByOrder.set(orderId, new Set());
        noteNumbersByOrder.get(orderId)!.add(note.note_number);
      }
      if (note.number_pending) {
        if (!pendingNumbersByOrder.has(orderId)) pendingNumbersByOrder.set(orderId, new Set());
        pendingNumbersByOrder.get(orderId)!.add(note.id);
        if (!photographed.has(note.id)) {
          if (!pendingPhotosByOrder.has(orderId)) pendingPhotosByOrder.set(orderId, new Set());
          pendingPhotosByOrder.get(orderId)!.add(note.id);
        }
        continue;
      }
      if (photographed.has(note.id)) continue;
      if (!missingNotesByOrder.has(orderId)) missingNotesByOrder.set(orderId, new Set());
      missingNotesByOrder.get(orderId)!.add(note.note_number);
    }
    const allocatedItemIds = new Set((allocations.data || []).map((allocation) => allocation.stock_order_item_id));
    const unlinkedByOrder = new Map<string, number>();
    for (const item of receiptItems) {
      if (!allocatedItemIds.has(item.id)) unlinkedByOrder.set(item.stock_order_id, (unlinkedByOrder.get(item.stock_order_id) || 0) + 1);
    }
    return NextResponse.json({ data: scopedRows.map((row) => ({ ...row,
      progress: summarizeStockProgress(statusById.get(row.stock_order_id) || "WAITING", progressItems.get(row.stock_order_id) || []),
      stock_number: stockNumberById.get(row.stock_order_id) || null,
      missing_photo_note_numbers: [...(missingNotesByOrder.get(row.stock_order_id) || [])].sort(),
      delivery_note_numbers: [...(noteNumbersByOrder.get(row.stock_order_id) || [])].sort(),
      pending_note_number_count: pendingNumbersByOrder.get(row.stock_order_id)?.size || 0,
      pending_note_photo_count: pendingPhotosByOrder.get(row.stock_order_id)?.size || 0,
      unlinked_shipped_item_count: unlinkedByOrder.get(row.stock_order_id) || 0,
    })), count: Number(rows[0]?.total_count || 0), page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = sqlErrorMessage(error, "待补送货单清单加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
