import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";

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
    const admin = createAdminClient();
    const items = await admin.from("stock_order_items").select("id,stock_order_id")
      .in("stock_order_id", rows.map((row) => row.stock_order_id)).gt("shipped_quantity", 0);
    if (items.error) throw items.error;
    const itemIds = (items.data || []).map((item) => item.id);
    const allocations = itemIds.length ? await admin.from("supplier_receipt_allocations")
      .select("stock_order_item_id,delivery_note_id").in("stock_order_item_id", itemIds)
      .gt("quantity", 0).is("correction_of", null) : { data: [], error: null };
    if (allocations.error) throw allocations.error;
    const noteIds = [...new Set((allocations.data || []).map((allocation) => allocation.delivery_note_id))];
    const [notes, photos] = await Promise.all([
      noteIds.length ? admin.from("supplier_delivery_notes").select("id,note_number,number_pending").in("id", noteIds) : Promise.resolve({ data: [], error: null }),
      noteIds.length ? admin.from("attachments").select("supplier_delivery_note_id").in("supplier_delivery_note_id", noteIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (notes.error) throw notes.error;
    if (photos.error) throw photos.error;
    const orderByItem = new Map((items.data || []).map((item) => [item.id, item.stock_order_id]));
    const photographed = new Set((photos.data || []).map((photo) => photo.supplier_delivery_note_id));
    const missingNotesByOrder = new Map<string, Set<string>>();
    const pendingNumbersByOrder = new Map<string, Set<string>>();
    const pendingPhotosByOrder = new Map<string, Set<string>>();
    const notesById = new Map((notes.data || []).map((note) => [note.id, note]));
    for (const allocation of allocations.data || []) {
      const orderId = orderByItem.get(allocation.stock_order_item_id);
      const note = notesById.get(allocation.delivery_note_id);
      if (!orderId || !note) continue;
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
    for (const item of items.data || []) {
      if (!allocatedItemIds.has(item.id)) unlinkedByOrder.set(item.stock_order_id, (unlinkedByOrder.get(item.stock_order_id) || 0) + 1);
    }
    return NextResponse.json({ data: rows.map((row) => ({ ...row,
      missing_photo_note_numbers: [...(missingNotesByOrder.get(row.stock_order_id) || [])].sort(),
      pending_note_number_count: pendingNumbersByOrder.get(row.stock_order_id)?.size || 0,
      pending_note_photo_count: pendingPhotosByOrder.get(row.stock_order_id)?.size || 0,
      unlinked_shipped_item_count: unlinkedByOrder.get(row.stock_order_id) || 0,
    })), count: Number(rows[0]?.total_count || 0), page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = sqlErrorMessage(error, "待补送货单清单加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
