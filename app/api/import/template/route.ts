import { readFile } from "node:fs/promises";
import path from "node:path";
import { requirePermission } from "@/lib/auth/current-user";

export async function GET() {
  await requirePermission("imports.create");
  const template = await readFile(path.join(process.cwd(), "assets", "templates", "Customer_Import_Template.xlsx"));
  return new Response(new Uint8Array(template), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("客户导入模板.xlsx")}`,
      "Cache-Control": "private, no-store",
    },
  });
}
