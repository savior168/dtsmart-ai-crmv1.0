import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSupplierRoleAllowed } from "@/lib/auth/supplier-role-boundary";
import { checkStatusRequiresDocuments, isSupplierNoteCheckStatus } from "@/lib/suppliers/note-check-status";

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("supplier.reconciliation.view");
    assertSupplierRoleAllowed(account.role);
    const canViewDocuments = hasPermission(account, "supplier.documents.view");
    const params = request.nextUrl.searchParams;
    const from = params.get("from") || "";
    const to = params.get("to") || "";
    const supplierId = params.get("supplier_id") || null;
    const search = (params.get("search") || "").trim();
    const checkStatus = params.get("check_status") || "";
    const amountFocus = params.get("amount_focus") || "";
    const page = Number(params.get("page") || 1);
    const pageSize = Number(params.get("page_size") || 50);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)
      || from > to || !Number.isSafeInteger(page) || page < 1 || page > 100000
      || ![10, 20, 50, 100].includes(pageSize)
      || supplierId && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(supplierId)
      || search.length > 80
      || checkStatus && !isSupplierNoteCheckStatus(checkStatus)
      || amountFocus && !["PAID", "UNPAID"].includes(amountFocus)
      || params.has("format")) {
      throw new Error("请选择有效日期范围、供应商和搜索词");
    }
    if (checkStatus && isSupplierNoteCheckStatus(checkStatus) && checkStatusRequiresDocuments(checkStatus) && !canViewDocuments) {
      throw new Error("无纸单查看权限，不能按此核对状态筛选");
    }
    const { data, error } = await supabase.rpc(search ? "supplier_reconciliation_report_search_checked" : "supplier_reconciliation_report_checked", {
      p_date_from: from, p_date_to: to, p_supplier_id: supplierId,
      p_limit: pageSize, p_offset: (page - 1) * pageSize,
      p_check_status: checkStatus || null,
      p_amount_focus: amountFocus || null,
      ...(search ? { p_search: search } : {}),
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
      .in("supplier_delivery_note_id", notes.map((note) => note.id)).is("supplier_photo_superseded_at", null).order("created_at") : { data: [] as Array<{ id: string; supplier_delivery_note_id: string | null; filename: string; mime_type: string; size_bytes: number; created_at: string }>, error: null };
    if (attachmentResult.error) throw attachmentResult.error;
    const paymentFlags = notes.length ? await admin.from("supplier_payments")
      .select("id,documents_pending_at_payment").in("delivery_note_id", notes.map((note) => note.id))
      : { data: [], error: null };
    if (paymentFlags.error) throw paymentFlags.error;
    const pendingAtPayment = new Map((paymentFlags.data || []).map((payment) => [payment.id, payment.documents_pending_at_payment]));
    const accountAllocations = notes.length && ["FINANCE", "ADMIN"].includes(account.role) ? await admin.from("supplier_account_payment_allocations")
      .select("id,delivery_note_id,account_payment_id,amount_cny")
      .in("delivery_note_id", notes.map((note) => note.id)).is("reversed_at", null)
      : { data: [], error: null };
    if (accountAllocations.error) throw accountAllocations.error;
    const accountPaymentIds = [...new Set((accountAllocations.data || []).map((allocation) => allocation.account_payment_id))];
    const accountPayments = accountPaymentIds.length ? await admin.from("supplier_account_payments")
      .select("id,paid_on,payment_method,payment_reference").in("id", accountPaymentIds)
      : { data: [], error: null };
    if (accountPayments.error) throw accountPayments.error;
    const accountPaymentById = new Map((accountPayments.data || []).map((payment) => [payment.id, payment]));
    const accountPaymentsByNote = new Map<string, Array<{ id: string; amount_cny: number; paid_on: string; method: string; reference: string; source: string }>>();
    for (const allocation of accountAllocations.data || []) {
      const payment = accountPaymentById.get(allocation.account_payment_id);
      if (!payment) throw new Error("供应商总账付款分配缺少付款流水，请联系财务核对");
      const list = accountPaymentsByNote.get(allocation.delivery_note_id) || [];
      list.push({ id: allocation.id, amount_cny: Number(allocation.amount_cny), paid_on: payment.paid_on,
        method: payment.payment_method, reference: payment.payment_reference, source: "ACCOUNT" });
      accountPaymentsByNote.set(allocation.delivery_note_id, list);
    }
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
      payments: [...((note as { payments?: Array<{ id: string }> }).payments || []).map((payment) => ({
        ...payment, documents_pending_at_payment: pendingAtPayment.get(payment.id) ?? null,
      })), ...(accountPaymentsByNote.get(note.id) || [])].sort((a, b) =>
        String((a as { paid_on?: string }).paid_on || "").localeCompare(String((b as { paid_on?: string }).paid_on || ""))),
    })) });
  } catch (error) {
    const message = sqlErrorMessage(error, "供应商对账加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
