import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requirePermission("pricebooks.import");
    const admin = createAdminClient();
    const { data, error } = await admin.from("product_categories").select("code,name_zh,is_active").eq("is_active", true).order("code");
    if (error) throw error;
    const workbook = XLSX.utils.book_new();
    const headers = ["商品分类编码", "供应商编号", "供应商商品货号", "商品名称", "英文名称", "产品类型", "品牌", "型号", "品质", "颜色", "包装规格", "单位", "最小起订量", "采购内部描述", "英文客户描述", "搜索别名"];
    const master = XLSX.utils.aoa_to_sheet([headers]);
    master["!cols"] = headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(workbook, master, "商品资料导入");
    const categoryRows = [["商品分类编码", "商品分类名称"], ...(data || []).map((item) => [item.code, item.name_zh])];
    const categories = XLSX.utils.aoa_to_sheet(categoryRows);
    categories["!cols"] = [{ wch: 22 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(workbook, categories, "分类编码参考");
    const guide = XLSX.utils.aoa_to_sheet([
      ["填写说明"],
      ["1", "仅在“商品资料导入”页填写商品，一行一个可独立选购的规格；不要填写价格或系统SKU。"],
      ["2", "分类编码从“分类编码参考”页复制；供应商编号是供应商身份，不是单品货号。"],
      ["3", "同一供应商确有独立单品货号时才填写“供应商商品货号”，不要把供应商编号重复当作货号。"],
      ["4", "导入后先核对原始行、分类和规格，再由有发布权限的账号发布；价格另用系统SKU模板更新。"],
    ]);
    guide["!cols"] = [{ wch: 10 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(workbook, guide, "注意事项");
    const body = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(body, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=product-master-import-template.xlsx", "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品资料模板下载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 500 });
  }
}
