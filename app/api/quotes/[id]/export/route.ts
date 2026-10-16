import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { buildQuoteWorkbook } from "@/lib/template-xlsx";
import { documentExportFilename } from "@/lib/export-file-name";

function download(buffer: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requirePermission("quotes.export");
    const { id } = await context.params;
    const [{ data: quote, error }, { data: items, error: itemError }] = await Promise.all([
      supabase.from("quotes").select("quote_number,currency,valid_until,payment_method,delivery_date,customer_short_name,destination_country,stocking_requirements,shipping_cost,subtotal,total_amount,created_at,owner:users!quotes_owner_id_fkey(name,email,phone),customer:customers(company_name,contact_name,phone)").eq("id", id).single(),
      supabase.from("quote_items").select("line_number,item_name,brand,model,quality,description,description_zh,quantity,unit_price,procurement_cost,preparation_requirement").eq("quote_id", id).order("line_number"),
    ]);
    if (error) throw error;
    if (itemError) throw itemError;
    const buffer = await buildQuoteWorkbook(quote as never, (items || []) as never);
    return download(buffer, documentExportFilename(quote.quote_number, "报价单", "xlsx"));
  } catch (error) {
    const message = sqlErrorMessage(error, "报价单导出失败");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
