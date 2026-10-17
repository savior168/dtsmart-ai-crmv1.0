import { requirePermission } from "@/lib/auth/current-user";

export async function GET(request: Request) {
  await requirePermission("imports.create");
  return Response.redirect(new URL("/templates/客户导入模板.xlsx", request.url), 302);
}
