import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { renderSupplierReconciliationCsv, type ReconciliationNote } from "@/lib/suppliers/reconciliation-csv";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requirePermission("supplier.reconciliation.view");
    const params = request.nextUrl.searchParams;
    const from = params.get("from") || "";
    const to = params.get("to") || "";
    const supplierId = params.get("supplier_id") || null;
    const format = params.get("format") || "json";
    const page = Number(params.get("page") || 1);
    const pageSize = Number(params.get("page_size") || 50);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)
      || from > to || !Number.isSafeInteger(page) || page < 1 || page > 100000
      || ![10, 20, 50, 100].includes(pageSize)
      || supplierId && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(supplierId)
      || !["json", "csv"].includes(format)) {
      throw new Error("请选择有效日期范围及供应商");
    }
    if (format === "csv") {
      const exportNotes: ReconciliationNote[] = [];
      let total = 0;
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await supabase.rpc("supplier_reconciliation_report", {
          p_date_from: from, p_date_to: to, p_supplier_id: supplierId,
          p_limit: 100, p_offset: offset,
        });
        if (error) throw error;
        total = Number(data?.summary?.note_count || 0);
        if (total > 5000) return NextResponse.json({ error: "匹配送货单超过 5000 张，请缩小日期或指定供应商后导出" }, { status: 413 });
        const notes = Array.isArray(data?.notes) ? data.notes : [];
        exportNotes.push(...notes);
        if (offset + notes.length >= total || !notes.length) break;
      }
      const csv = renderSupplierReconciliationCsv(exportNotes);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="supplier-reconciliation-${from}-${to}.csv"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const { data, error } = await supabase.rpc("supplier_reconciliation_report", {
      p_date_from: from, p_date_to: to, p_supplier_id: supplierId,
      p_limit: pageSize, p_offset: (page - 1) * pageSize,
    });
    if (error) throw error;
    const notes = Array.isArray(data?.notes) ? data.notes as Array<{ id: string }> : [];
    const attachmentResult = notes.length ? await createAdminClient().from("attachments")
      .select("id,supplier_delivery_note_id,filename,mime_type,size_bytes,created_at")
      .in("supplier_delivery_note_id", notes.map((note) => note.id)).order("created_at") : { data: [] as Array<{ id: string; supplier_delivery_note_id: string | null; filename: string; mime_type: string; size_bytes: number; created_at: string }>, error: null };
    if (attachmentResult.error) throw attachmentResult.error;
    const attachmentsByNote = new Map<string, NonNullable<typeof attachmentResult.data>>();
    for (const attachment of attachmentResult.data || []) {
      const list = attachmentsByNote.get(attachment.supplier_delivery_note_id!) || [];
      list.push(attachment);
      attachmentsByNote.set(attachment.supplier_delivery_note_id!, list);
    }
    return NextResponse.json({ ...data, notes: notes.map((note) => ({
      ...note, attachments: attachmentsByNote.get(note.id) || [],
    })) });
  } catch (error) {
    const message = sqlErrorMessage(error, "供应商对账加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
