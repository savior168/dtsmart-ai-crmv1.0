import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { matchImportedPaymentAccount, parseCustomerPiWorkbook } from "@/lib/pi-document-import";
import { sqlErrorMessage } from "@/lib/sales-flow";

const allowedSizes = new Set([10, 20, 50, 100, 300, 500]);

export async function GET(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("orders.import");
    const page = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get("page") || 1) || 1));
    const requestedSize = Number(request.nextUrl.searchParams.get("page_size") || 20);
    const size = allowedSizes.has(requestedSize) ? requestedSize : 20;
    const query = supabase.from("pi_import_drafts")
      .select("id,owner_id,source_file_name,source_sheet_name,source_order_number,revision,status,converted_order_id,created_at,updated_at", { count: "exact" })
      .eq("owner_id", account.id).order("created_at", { ascending: false }).range((page - 1) * size, page * size - 1);
    const { data, count, error } = await query;
    if (error) throw error;
    return NextResponse.json({ data: data || [], count: count || 0, page, page_size: size });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI导入草稿加载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, account } = await requirePermission("orders.import");
    if (!["SALES", "SUPERVISOR", "ADMIN"].includes(account.role)) throw new Error("FORBIDDEN");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !/\.xlsx$/i.test(file.name) || file.size > 2 * 1024 * 1024 || file.size < 100) {
      throw new Error("请选择2MB以内的.xlsx客户PI文件");
    }
    const parsed = parseCustomerPiWorkbook(new Uint8Array(await file.arrayBuffer()));
    const { data: accounts, error: accountsError } = await supabase.from("pi_payment_accounts")
      .select("id,currency,instructions").eq("currency", parsed.document.currency).eq("active", true);
    if (accountsError) throw accountsError;
    const payment_account_id = matchImportedPaymentAccount(parsed.payment_account_instructions, accounts || [], parsed.document.currency) || null;
    const { data, error } = await supabase.rpc("create_pi_import_draft", {
      p_file_name: file.name.slice(0, 255), p_sheet_name: parsed.sheet_name, p_payload: { ...parsed.document, payment_account_id },
    });
    if (error) throw error;
    return NextResponse.json({ data: { id: data.id, revision: data.revision, source_order_number: data.source_order_number } }, { status: 201 });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI文件导入失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

