import { readFile } from "node:fs/promises";
import path from "node:path";
import { requirePermission } from "@/lib/auth/current-user";

export async function GET(request: Request) {
  await requirePermission("imports.create");
  const destination = new URL(request.url).searchParams.get("destination");
  const isPublicPool = destination === "PUBLIC_POOL";
  const filename = isPublicPool ? "Customer_Public_Pool_Import_Template.xlsx" : "Customer_Import_Template.xlsx";
  const template = await readFile(path.join(process.cwd(), "assets", "templates", filename));
  return new Response(new Uint8Array(template), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(isPublicPool ? "客户公海导入模板.xlsx" : "我的客户导入模板.xlsx")}`,
      "Cache-Control": "private, no-store",
    },
  });
}
