import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { buildQuoteWorkbook } from "@/lib/template-xlsx";

export async function GET() {
  try {
    await requirePermission("quotes.create");
    const buffer = await buildQuoteWorkbook({
      quote_number: "",
      currency: "USD",
      valid_until: null,
      payment_method: "USD - Bank Transfer",
      delivery_date: null,
      customer_short_name: null,
      destination_country: null,
      stocking_requirements: null,
      shipping_cost: 0,
      subtotal: 0,
      total_amount: 0,
      owner: null,
      customer: null,
    }, [{
      line_number: 1, item_name: "", brand: "", model: "", quality: "", description: "",
      description_zh: null, quantity: 0, unit_price: 0, procurement_cost: 0, preparation_requirement: null,
    }]);
    return new NextResponse(new Uint8Array(buffer), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("标准报价导入模板.xlsx")}`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "报价导入模板下载失败" }, { status: 400 });
  }
}
