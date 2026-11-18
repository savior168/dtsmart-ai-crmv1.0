import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSupplierRoleAllowed } from "@/lib/auth/supplier-role-boundary";

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("supplier.reconciliation.view");
    assertSupplierRoleAllowed(account.role);
    const canViewDocuments = hasPermission(account, "supplier.documents.view");
    const params = request.nextUrl.searchParams;
    const from = params.get("from") || "";
    const to = params.get("to") || "";
    const supplierId = params.get("supplier_id") || null;
    const page = Number(params.get("page") || 1);
    const pageSize = Number(params.get("page_size") || 50);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)
      || from > to || !Number.isSafeInteger(page) || page < 1 || page > 100000
      || ![10, 20, 50, 100].includes(pageSize)
      || supplierId && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(supplierId)
      || params.has("format")) {
      throw new Error("请选择有效日期范围及供应商");
    }
    const { data, error } = await supabase.rpc("supplier_reconciliation_report", {
      p_date_from: from, p_date_to: to, p_supplier_id: supplierId,
      p_limit: pageSize, p_offset: (page - 1) * pageSize,
    });
    if (error) throw error;
    const notes = Array.isArray(data?.notes) ? data.notes as Array<{ id: string }> : [];
    const admin = createAdminClient();
    const pendingResult = notes.length ? await admin.from("supplier_delivery_notes")
      .select("id,number_pending,updated_at").in("id", notes.map((note) => note.id)) : { data: [], error: null };
    if (pendingResult.error) throw pendingResult.error;
    const pendingById = new Map((pendingResult.data || []).map((row) => [row.id, row]));
    const attachmentResult = canViewDocuments && notes.length ? await admin.from("attachments")
      .select("id,supplier_delivery_note_id,filename,mime_type,size_bytes,created_at")
      .in("supplier_delivery_note_id", notes.map((note) => note.id)).order("created_at") : { data: [] as Array<{ id: string; supplier_delivery_note_id: string | null; filename: string; mime_type: string; size_bytes: number; created_at: string }>, error: null };
    if (attachmentResult.error) throw attachmentResult.error;
    const attachmentsByNote = new Map<string, NonNullable<typeof attachmentResult.data>>();
    for (const attachment of attachmentResult.data || []) {
      const list = attachmentsByNote.get(attachment.supplier_delivery_note_id!) || [];
      list.push(attachment);
      attachmentsByNote.set(attachment.supplier_delivery_note_id!, list);
    }
    const financeData = { ...data };
    delete financeData.legacy_unlinked;
    return NextResponse.json({ ...financeData, can_view_documents: canViewDocuments, notes: notes.map((note) => ({
      ...note, note_number: !canViewDocuments ? "无权限查看" : pendingById.get(note.id)?.number_pending ? "待补送货单号" : (note as { note_number?: string }).note_number,
      number_pending: Boolean(pendingById.get(note.id)?.number_pending),
      updated_at: pendingById.get(note.id)?.updated_at || (note as { updated_at?: string }).updated_at,
      attachments: attachmentsByNote.get(note.id) || [],
    })) });
  } catch (error) {
    const message = sqlErrorMessage(error, "供应商对账加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
