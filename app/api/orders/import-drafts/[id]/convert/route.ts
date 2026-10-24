import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import type { ImportedPiDocument } from "@/lib/pi-document-import";
import { calculatePiFees } from "@/lib/pi-fees";
import { parsePiOrderInput, requireOwnedPiCustomer } from "@/lib/pi-order-input";
import { isPiOrderNumberConflict, sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export async function POST(request: NextRequest, context: Context) {
  try {
    const { supabase, account } = await requirePermission("orders.import");
    if (!hasPermission(account, "orders.create") || !["SALES", "SUPERVISOR", "ADMIN", "ORDER_CLERK"].includes(account.role)) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const revision = Number(body.import_revision);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("导入草稿版本不正确，请刷新");
    const input = parsePiOrderInput(body);
    const salesUserId = account.role === "ORDER_CLERK" ? String(body.sales_user_id || "") : account.id;
    if (account.role === "ORDER_CLERK" && !salesUserId) throw new Error("请先选择负责此PI的销售员或主管");
    if (account.role !== "ORDER_CLERK") await requireOwnedPiCustomer(supabase, account.id, input.p_customer_id);
    const { data: draft, error: draftError } = await supabase.from("pi_import_drafts")
      .select("id,owner_id,payload,revision,status").eq("id", id).eq("owner_id", account.id).maybeSingle();
    if (draftError) throw draftError;
    if (!draft || draft.status !== "PENDING") throw new Error("导入草稿不存在或已经转换");
    if (draft.revision !== revision) throw new Error("导入草稿已更新，请刷新后重试");
    const source = draft.payload as ImportedPiDocument;
    if (!source || !Array.isArray(source.items) || !source.items.length) throw new Error("导入来源内容已损坏，请重新导入");
    if (source.sales_account_email) {
      const { data: owner, error: ownerError } = await createAdminClient().from("users").select("id,email")
        .eq("id", salesUserId).in("role", ["SALES", "SUPERVISOR"]).eq("status", "ACTIVE").maybeSingle();
      if (ownerError) throw ownerError;
      if (!owner || owner.email.toLowerCase() !== source.sales_account_email.toLowerCase()) {
        throw new Error("所选PI归属销售员与导入文件账号不一致，请核对后重新选择");
      }
    }
    const differences: string[] = [];
    if (source.warehouse_reference_number !== input.p_warehouse_reference_number) differences.push("订单编号与导入文件不同");
    if (source.currency !== input.p_currency) differences.push("付款币种与导入文件不同");
    if (source.items.length !== input.p_items.length) differences.push("产品行数与导入文件不同");
    const count = Math.min(source.items.length, input.p_items.length);
    for (let index = 0; index < count; index += 1) {
      const before = source.items[index];
      const after = input.p_items[index];
      if (before.item_name !== after.item_name || before.brand !== after.brand || before.model !== after.model ||
          before.quality !== after.quality || before.quantity !== after.quantity) differences.push(`第${index + 1}行产品或数量已变更`);
      if (source.source_kind === "SYSTEM_TEMPLATE" && before.unit_price_cny !== undefined) {
        if (Math.abs(after.unit_price_cny - before.unit_price_cny) > 0.01 || Math.abs(after.estimated_unit_cost_cny - Number(before.estimated_unit_cost_cny)) > 0.01) {
          differences.push(`第${index + 1}行人民币售价或成本与导入模板不同`);
        }
      } else if (Math.abs(after.unit_price_payment - before.unit_price_payment) > 0.01) {
        differences.push(`第${index + 1}行客户外币单价由 ${before.unit_price_payment.toFixed(2)} 变为 ${after.unit_price_payment.toFixed(2)}`);
      }
    }
    if (source.source_kind === "SYSTEM_TEMPLATE") {
      if (Math.abs(input.p_shipping_cny - Number(source.shipping_cny)) > 0.01) differences.push("人民币运费与导入模板不同");
    } else if (Math.abs(roundMoney(input.p_shipping_cny * input.p_fx_rate) - source.shipping_payment) > 0.01) differences.push("外币运费与导入文件不同");
    if (source.source_kind !== "SYSTEM_TEMPLATE") {
      const sourceCharges = [
        ["last_balance", source.last_balance_payment, "未付尾款"],
        ["discount", source.discount_payment, "折扣"],
        ["other", source.other_payment, "其他费用"],
      ] as const;
      for (const [key, before, label] of sourceCharges) {
        const charge = input.p_fees[key];
        const after = charge.source === "PAYMENT" ? charge.amount : roundMoney(charge.amount * input.p_fx_rate);
        if (Math.abs(after - Number(before || 0)) > 0.01) differences.push(`${label}与导入文件不同`);
      }
      if (Math.abs(input.p_fees.paypal_rate_percent - Number(source.paypal_rate_percent || 0)) > 0.0001) differences.push("PayPal 手续费率与导入文件不同");
      const subtotalCny = roundMoney(input.p_items.reduce((sum, item) => sum + roundMoney(item.unit_price_cny * item.quantity), 0));
      const subtotalPayment = roundMoney(input.p_items.reduce((sum, item) => sum + roundMoney(item.unit_price_payment * item.quantity), 0));
      const totals = calculatePiFees(subtotalCny, subtotalPayment, input.p_shipping_cny, input.p_fx_rate, input.p_payment_method || "", input.p_fees);
      if (Math.abs(totals.totalPayment - source.total_payment) > 0.01) differences.push("核对后订单总金额与原Excel不同");
    }
    if (differences.length && body.acknowledge_differences !== true) {
      return NextResponse.json({ error: "补全后的PI与原Excel不一致，请逐项核对；确认后才能转换为PI草稿", differences }, { status: 409 });
    }
    const { data, error } = await supabase.rpc("convert_pi_import_draft_with_fees", {
      p_draft_id: id, p_expected_revision: revision, ...input, p_sales_user_id: salesUserId,
    });
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI导入草稿转换失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || (isPiOrderNumberConflict(error) ? 409 : 400) });
  }
}
