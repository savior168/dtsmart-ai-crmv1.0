import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { PRICE_IMPORT_HEADERS } from "@/lib/product-price-import";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requirePermission("pricebooks.import");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [...PRICE_IMPORT_HEADERS],
      ["ZK-0000-000000", "采购价", 12.34, 1, new Date().toISOString().slice(0, 10), "示例数据，请替换系统SKU和价格来源；此行不会导入"],
    ]);
    sheet["!cols"] = [18, 22, 14, 14, 18, 60].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, "价格更新");
    const body = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(body, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=product-price-update-template.xlsx",
      "Cache-Control": "no-store",
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "模板下载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
