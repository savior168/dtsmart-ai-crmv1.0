import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requirePermission("pricebooks.import");
    const workbook = XLSX.utils.book_new();
    const rows = [
      ["供应商编号（选填）", "供应商商品货号（选填）", "中文名称*", "英文名称", "产品类型", "品牌", "型号", "品质", "颜色", "包装规格", "单位", "最小起订量", "人民币采购价", "人民币包装费", "人民币其他成本", "美元销售参考价", "中文内部描述", "英文客户描述", "搜索别名"],
      ["1191", "LCD-IP15-OLED", "iPhone 15 OLED屏幕", "iPhone 15 OLED Display", "手机屏幕", "Apple", "iPhone 15", "OLED", "黑色", "防静电独立包装", "PCS", 1, 320, 2, 1, 58.5, "内部采购与质检说明", "Customer-facing description", "iPhone15屏幕,OLED display"],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = rows[0].map((value) => ({ wch: Math.max(14, String(value).length * 2) }));
    XLSX.utils.book_append_sheet(workbook, sheet, "产品价格导入模板");
    const guide = XLSX.utils.aoa_to_sheet([
      ["填写说明"],
      ["1", "系统SKU由数据库自动生成，无需填写；工作表顶部的代码是供应商编号，不是单品货号。"],
      ["2", "供应商商品货号只有逐行明确提供时才填写；不得将同一供应商编号复制为每个商品货号。"],
      ["3", "采购价、包装费、其他成本均为人民币；销售参考价为美元。"],
      ["4", "无法确认的字段请留空，系统会进入待核对，不会猜测或直接发布。"],
      ["5", "导入后必须逐行核对并由有发布权限的管理员发布。"],
    ]);
    guide["!cols"] = [{ wch: 10 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(workbook, guide, "填写说明");
    const body = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(body, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=product-price-import-template.xlsx", "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "模板下载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
