import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";

type BatchBody = { ids?: string[]; action?: "STAGE" | "DELETE"; status?: string };
const CHUNK_SIZE = 200;

function split<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as BatchBody;
    const ids = [...new Set((body.ids || []).filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 5000);
    if (!ids.length) return NextResponse.json({ error: "请选择至少一条客户数据" }, { status: 400 });
    if (body.action !== "DELETE" && body.action !== "STAGE") return NextResponse.json({ error: "无效的批量操作" }, { status: 400 });
    if (body.action === "STAGE" && !["CLAIMED", "FOLLOWING", "QUOTE", "DEAL"].includes(body.status || "")) {
      return NextResponse.json({ error: "无效的客户状态" }, { status: 400 });
    }

    const succeeded = new Set<string>();
    const failures: { id: string; ok: false; error: string }[] = [];
    for (const chunk of split(ids, CHUNK_SIZE)) {
      // RLS is the single source of truth for visibility and edit permission.
      // Query first so an update affecting zero rows is never reported as success.
      const { data: accessible, error: readError } = await supabase
        .from("customers")
        .select("id")
        .in("id", chunk)
        .is("deleted_at", null);
      if (readError) throw readError;

      const accessibleIds = (accessible || []).map((item) => item.id);
      const accessibleSet = new Set(accessibleIds);
      chunk.filter((id) => !accessibleSet.has(id)).forEach((id) => failures.push({ id, ok: false, error: "客户不存在、已删除或您没有操作权限" }));
      if (!accessibleIds.length) continue;

      const update = body.action === "DELETE"
        ? { deleted_at: new Date().toISOString() }
        : { status: body.status as string };
      const { error: updateError } = await supabase
        .from("customers")
        .update(update)
        .in("id", accessibleIds)
        .is("deleted_at", null);
      if (updateError) {
        accessibleIds.forEach((id) => failures.push({ id, ok: false, error: updateError.message }));
        continue;
      }
      accessibleIds.forEach((id) => succeeded.add(id));
    }

    if (succeeded.size) {
      const action = body.action === "DELETE" ? "CUSTOMER_DELETE" : "CUSTOMER_STAGE";
      const { error: auditError } = await supabase.from("audit_logs").insert([...succeeded].map((id) => ({
        user_id: user.id,
        action,
        target_type: "customer",
        target_id: id,
        content: { status: body.status || null, batch: true },
      })));
      if (auditError) throw auditError;
    }

    return NextResponse.json({
      total_count: ids.length,
      success_count: succeeded.size,
      failed_count: failures.length,
      results: ids.map((id) => failures.find((item) => item.id === id) || { id, ok: succeeded.has(id) }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
