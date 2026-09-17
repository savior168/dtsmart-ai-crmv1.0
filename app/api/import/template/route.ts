import { workbookResponse } from "@/lib/xlsx-export";
import { requirePermission } from "@/lib/auth/current-user";

const header = ["名称", "国家", "区号", "完整号码", "邮箱", "标签", "分类", "商店名称", "商店地址", "商店类型", "商店状态", "商家官网网址", "谷歌网址", "商店分数", "商品图片", "搜索关键词", "创建时间"];
const example = ["示例手机配件商", "中国", "+86", "13800138000", "sales@example.com", "手机配件,批发", "手机配件批发商", "示例门店", "深圳市", "批发", "营业中", "https://example.com", "https://maps.google.com", "4.8", "https://example.com/image.jpg", "手机配件批发", "2026-08-15"];

export async function GET() {
  await requirePermission("imports.create");
  return workbookResponse("客户导入模板.xlsx", [{ name: "客户导入模板", rows: [header, example], widths: [22, 14, 10, 18, 26, 22, 22, 24, 32, 16, 16, 36, 42, 12, 42, 28, 20], hyperlinkColumns: [11, 12, 14] }]);
}
