import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { assertSupplierRoleAllowed } from "@/lib/auth/supplier-role-boundary";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const amount = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const signedAmount = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
const methods = ["CASH", "BANK", "ALIPAY", "WECHAT", "OTHER"];

function assertFinanceRole(role: string) {
  assertSupplierRoleAllowed(role);
  if (role !== "FINANCE" && role !== "ADMIN") throw new Error("FORBIDDEN");
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("supplier.reconciliation.view");
    assertFinanceRole(account.role);
    const supplierId = request.nextUrl.searchParams.get("supplier_id") || "";
    if (supplierId && !uuid.test(supplierId)) throw new Error("供应商无效");
    const noteSearch = (request.nextUrl.searchParams.get("note_search") || "").trim();
    if (noteSearch.length > 100) throw new Error("送货单搜索词过长");
    const paymentPage = Number(request.nextUrl.searchParams.get("payment_page") || "1");
    if (!Number.isSafeInteger(paymentPage) || paymentPage < 1 || paymentPage > 10000) throw new Error("付款页码无效");
    const { data: balances, error } = await supabase.rpc("supplier_account_balances", {
      p_supplier_id: null,
    });
    if (error) throw error;
    if (!supplierId) return NextResponse.json({ balances });
    const admin = createAdminClient();
    const [opening, adjustments, payments, notes] = await Promise.all([
      admin.from("supplier_account_openings").select("supplier_id,as_of_date,balance_cny,explanation,recorded_at").eq("supplier_id", supplierId).maybeSingle(),
      admin.from("supplier_account_adjustments").select("id,effective_on,amount_cny,explanation,recorded_at", { count: "exact" }).eq("supplier_id", supplierId).order("recorded_at", { ascending: false }).limit(100),
      admin.from("supplier_account_payments").select("id,amount_cny,paid_on,payment_method,payment_reference,explanation,recorded_at,reversed_at,reversal_reason", { count: "exact" }).eq("supplier_id", supplierId).order("paid_on", { ascending: false }).order("recorded_at", { ascending: false }).range((paymentPage - 1) * 50, paymentPage * 50 - 1),
      supabase.rpc("supplier_account_allocatable_notes", { p_supplier_id: supplierId, p_search: noteSearch }),
    ]);
    if (opening.error || adjustments.error || payments.error || notes.error) throw opening.error || adjustments.error || payments.error || notes.error;
    const paymentIds = (payments.data || []).map((payment) => payment.id);
    const allocations: Array<{ id: string; account_payment_id: string; delivery_note_id: string;
      amount_cny: number; recorded_at: string; reversed_at: string | null; reversal_reason: string | null }> = [];
    for (let offset = 0; paymentIds.length; offset += 1000) {
      const batch = await admin.from("supplier_account_payment_allocations")
        .select("id,account_payment_id,delivery_note_id,amount_cny,recorded_at,reversed_at,reversal_reason")
        .in("account_payment_id", paymentIds).order("recorded_at", { ascending: false }).range(offset, offset + 999);
      if (batch.error) throw batch.error;
      allocations.push(...(batch.data || []));
      if ((batch.data || []).length < 1000) break;
    }
    return NextResponse.json({ balances, opening: opening.data, adjustments: adjustments.data,
      payments: payments.data, allocations, notes: notes.data,
      payment_page: paymentPage, payment_count: payments.count || 0,
      has_more_adjustments: (adjustments.count || 0) > (adjustments.data || []).length,
      has_more_payments: paymentPage * 50 < (payments.count || 0),
      has_more_notes: (notes.data || []).length === 100 });
  } catch (error) {
    const message = sqlErrorMessage(error, "供应商总账加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("supplier.reconciliation.manage");
    assertFinanceRole(account.role);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const supplierId = String(body.supplier_id || "");
    const value = String(body.amount_cny ?? "");
    const on = String(body.on || "");
    const explanation = String(body.explanation || "").trim();
    const reference = String(body.payment_reference || "").trim();
    const requestId = String(body.request_id || "");
    if (["OPENING", "ADJUSTMENT", "PAYMENT"].includes(action) && !uuid.test(supplierId)) throw new Error("请选择供应商");
    if (["OPENING", "PAYMENT", "ALLOCATE"].includes(action) && (!amount.test(value) || Number(value) <= 0)) throw new Error("金额须大于零且最多两位小数");
    if (action === "ADJUSTMENT" && (!signedAmount.test(value) || Number(value) === 0)) throw new Error("请输入非零调整金额");
    if (["OPENING", "ADJUSTMENT", "PAYMENT"].includes(action) && !date.test(on)) throw new Error("日期无效");
    if (explanation.length > 500 || reference.length > 200) throw new Error("说明或凭证号过长");
    let data: unknown;
    let error: unknown;
    if (action === "OPENING") {
      if (explanation.length < 4 || body.confirmed_overlap !== true) throw new Error("请核对期初余额与已有送货单不重复，并填写核对说明");
      ({ data, error } = await supabase.rpc("record_supplier_account_opening", {
        p_supplier_id: supplierId, p_as_of_date: on, p_balance_cny: Number(value), p_explanation: explanation,
      }));
    } else if (action === "ADJUSTMENT") {
      if (explanation.length < 4 || !uuid.test(requestId)) throw new Error("账款调整须填写原因和有效提交编号");
      ({ data, error } = await supabase.rpc("record_supplier_account_adjustment", {
        p_supplier_id: supplierId, p_effective_on: on, p_amount_cny: Number(value),
        p_explanation: explanation, p_request_id: requestId,
      }));
    } else if (action === "PAYMENT") {
      const method = String(body.payment_method || "");
      if (!methods.includes(method) || !uuid.test(requestId) || body.confirmed_payment !== true
        || !reference && explanation.length < 4) throw new Error("请确认真实付款并选择付款方式；未填凭证号时请说明付款依据");
      ({ data, error } = await supabase.rpc("record_supplier_account_payment", {
        p_supplier_id: supplierId, p_amount_cny: Number(value), p_paid_on: on,
        p_payment_method: method, p_payment_reference: reference,
        p_explanation: explanation, p_request_id: requestId,
      }));
    } else if (action === "ALLOCATE") {
      const paymentId = String(body.account_payment_id || "");
      const noteId = String(body.delivery_note_id || "");
      if (![paymentId, noteId, requestId].every((id) => uuid.test(id))) throw new Error("请选择有效付款和送货单");
      ({ data, error } = await supabase.rpc("record_supplier_account_payment_allocation", {
        p_account_payment_id: paymentId, p_delivery_note_id: noteId,
        p_amount_cny: Number(value), p_request_id: requestId,
      }));
    } else if (action === "REVERSE_ALLOCATION") {
      const allocationId = String(body.allocation_id || "");
      if (!uuid.test(allocationId) || explanation.length < 4) throw new Error("请选择分配记录并填写更正原因");
      ({ data, error } = await supabase.rpc("reverse_supplier_account_payment_allocation", {
        p_allocation_id: allocationId, p_reason: explanation,
      }));
    } else if (action === "REVERSE_PAYMENT") {
      const paymentId = String(body.account_payment_id || "");
      if (!uuid.test(paymentId) || explanation.length < 4) throw new Error("请选择付款并填写撤销原因");
      ({ data, error } = await supabase.rpc("reverse_supplier_account_payment", {
        p_payment_id: paymentId, p_reason: explanation,
      }));
    } else throw new Error("不支持的账本操作");
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = sqlErrorMessage(error, "供应商总账操作失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
