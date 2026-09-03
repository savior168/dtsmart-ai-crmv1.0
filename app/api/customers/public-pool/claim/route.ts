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
    const file = validateWorkflowEvidence(form.get("file"));
    uploaded = await uploadWorkflowEvidence(user.id, "claim", file);
    const result = await supabase.rpc("claim_public_customer", {
      p_customer_id: customerId,
      p_channel: String(form.get("channel") || ""),
      p_result: String(form.get("result") || ""),
      p_next_plan: String(form.get("next_plan") || ""),
      p_storage_path: uploaded.storagePath,
      p_filename: uploaded.filename,
      p_mime_type: uploaded.mimeType,
      p_size_bytes: uploaded.sizeBytes,
    });
    if (result.error) throw result.error;
    return NextResponse.json({ success: true, data: result.data, message: "客户认领成功，90天保护期已经开始" });
  } catch (error) {
    if (uploaded) await uploaded.cleanup();
    const rawMessage = error instanceof Error ? error.message : "客户认领失败";
    const message = /invalid key/i.test(rawMessage) ? "凭证文件名包含存储服务不支持的字符，请重新选择文件后重试" : rawMessage;
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
