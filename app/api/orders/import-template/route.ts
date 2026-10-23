import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { sqlErrorMessage } from "@/lib/sales-flow";

export async function GET(request: Request) {
  try {
    await requirePermission("orders.import");
    const invoiceLayout = new URL(request.url).searchParams.get("format") === "invoice";
    const bytes = readFileSync(path.join(process.cwd(), "assets", "templates", invoiceLayout ? "PI_Import_Template.xlsx" : "PI_Whole_Order_Import_Template.xlsx"));
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${invoiceLayout ? "PI-invoice-layout-template" : "PI-full-data-template"}.xlsx`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI导入模板下载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
