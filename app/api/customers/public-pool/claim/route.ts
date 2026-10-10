import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission } from "@/lib/auth/current-user";
import { uploadWorkflowEvidence, validateWorkflowEvidence } from "@/lib/customer-workflow-evidence";

export async function POST(request: NextRequest) {
  let uploaded: Awaited<ReturnType<typeof uploadWorkflowEvidence>> | null = null;
  try {
    const { supabase, user } = await requirePermission("customers.claim");
    const form = await request.formData();
    const customerId = String(form.get("customer_id") || "");
    if (!customerId) return NextResponse.json({ error: "缺少客户ID" }, { status: 400 });
    const stage = String(form.get("stage") || "CLAIMED").toUpperCase();
    if (!["CLAIMED", "FOLLOWING", "DEAL"].includes(stage)) return NextResponse.json({ error: "无效客户阶段" }, { status: 400 });
    if (["FOLLOWING", "DEAL"].includes(stage)) {
      const customer = await supabase.from("customers").select("phone,email").eq("id", customerId)
        .is("deleted_at", null).maybeSingle();
      if (customer.error) throw customer.error;
      if (!customer.data) return NextResponse.json({ error: "客户不存在或无权认领" }, { status: 404 });
      if (!String(customer.data.phone || "").trim() || !String(customer.data.email || "").trim()) {
        return NextResponse.json({ error: "意向客户和成交客户必须同时具备联系电话和邮箱，请先补全客户资料" }, { status: 400 });
      }
    }
    const fileValue = form.get("file");
    if (stage !== "CLAIMED" && !(fileValue instanceof File)) return NextResponse.json({ error: "潜在客户以外的阶段必须上传真实凭证附件" }, { status: 400 });
    if (!String(form.get("next_plan") || "").trim()) return NextResponse.json({ error: "请填写本次联系纪要及下一步安排" }, { status: 400 });
    const file = fileValue instanceof File ? validateWorkflowEvidence(fileValue) : null;
    if (file) uploaded = await uploadWorkflowEvidence(user.id, "claim", file);
    const result = await supabase.rpc("claim_public_customer", {
      p_customer_id: customerId,
      p_channel: String(form.get("channel") || ""),
      p_result: String(form.get("result") || ""),
      p_next_plan: String(form.get("next_plan") || ""),
      p_storage_path: uploaded?.storagePath || null,
      p_filename: uploaded?.filename || null,
      p_mime_type: uploaded?.mimeType || null,
      p_size_bytes: uploaded?.sizeBytes || null,
      p_stage: stage,
    });
    if (result.error) throw result.error;
    return NextResponse.json({ success: true, data: result.data, message: "客户认领成功，保护期已按所选阶段生效" });
  } catch (error) {
    if (uploaded) await uploaded.cleanup();
    const rawMessage = error instanceof Error ? error.message : "客户认领失败";
    const message = /invalid key/i.test(rawMessage) ? "凭证文件名包含存储服务不支持的字符，请重新选择文件后重试" : rawMessage;
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
