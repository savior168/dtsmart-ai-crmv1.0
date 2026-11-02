import { NextRequest, NextResponse } from "next/server";
import { canWriteOwnedRecord, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerStageContactError } from "@/lib/customer-contact-requirement";

type WorkflowBody = { action?: "RELEASE" | "ASSIGN" | "STAGE" | "FOLLOWUP_STATUS"; reason?: string; user_id?: string; status?: string; followup_status?: string };

const stageEvidenceTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const safeName = (value: string) => value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-160) || "stage-evidence";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      if (String(form.get("action") || "") !== "STAGE") return NextResponse.json({ error: "无效操作" }, { status: 400 });
      const { supabase, account } = await requirePermission("customers.edit");
      const admin = createAdminClient();
      const customer = await admin.from("customers").select("owner_id,phone,phone_numbers,email,email_addresses,wechat,wechat_numbers,whatsapp,whatsapp_numbers").eq("id", id).is("deleted_at", null).maybeSingle();
      if (customer.error) throw customer.error;
      if (!customer.data || !customer.data.owner_id || !canWriteOwnedRecord(account, customer.data.owner_id)) {
        return NextResponse.json({ error: "只能单独修改归属自己的客户阶段；系统管理员可进行有审计记录的数据纠正" }, { status: 403 });
      }
      const status = String(form.get("status") || "").toUpperCase();
      const reason = String(form.get("reason") || "").trim();
      const file = form.get("file");
      if (!["CLAIMED", "FOLLOWING", "DEAL"].includes(status)) return NextResponse.json({ error: "无效客户阶段" }, { status: 400 });
      const contactError = customerStageContactError(status, customer.data);
      if (contactError) return NextResponse.json({ error: `${contactError}，请先编辑客户资料` }, { status: 400 });
      const needsEvidence = ["FOLLOWING", "DEAL"].includes(status);
      if (!reason) return NextResponse.json({ error: "请填写真实、可追溯的阶段变更原因" }, { status: 400 });
      if (needsEvidence && !(file instanceof File)) return NextResponse.json({ error: "变更为意向客户或成交客户时必须上传真实凭证" }, { status: 400 });
      if (file instanceof File && (file.size <= 0 || file.size > 15 * 1024 * 1024)) return NextResponse.json({ error: "凭证文件必须小于15MB" }, { status: 400 });
      if (file instanceof File && !stageEvidenceTypes.has(file.type)) return NextResponse.json({ error: "阶段凭证仅支持 JPG、PNG、WebP 图片或 PDF 文件" }, { status: 400 });

      let storagePath: string | null = null;
      if (file instanceof File) {
        storagePath = `${account.id}/stage-evidence/${id}/${crypto.randomUUID()}-${safeName(file.name)}`;
        const uploaded = await admin.storage.from("crm-attachments").upload(storagePath, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
        if (uploaded.error) throw uploaded.error;
      }
      const result = await supabase.rpc("change_customer_stage_with_evidence", {
        p_customer_id: id,
        p_status: status,
        p_reason: reason,
        p_storage_path: storagePath,
        p_filename: file instanceof File ? file.name : null,
        p_mime_type: file instanceof File ? file.type : null,
        p_size_bytes: file instanceof File ? file.size : null,
      });
      if (result.error) {
        if (storagePath) await admin.storage.from("crm-attachments").remove([storagePath]);
        throw result.error;
      }
      return NextResponse.json(result.data);
    }
    const body = (await request.json()) as WorkflowBody;
    const permission = body.action === "RELEASE" ? "customers.release" : body.action === "ASSIGN" ? "customers.assign" : "customers.edit";
    const { supabase, user, account } = await requirePermission(permission);
    const customer = await createAdminClient().from("customers").select("owner_id").eq("id", id).maybeSingle();
    if (customer.error) throw customer.error;
    const assigningUnowned = body.action === "ASSIGN" && customer.data?.owner_id == null;
    if (!customer.data || (!assigningUnowned && !canWriteOwnedRecord(account, customer.data.owner_id))) {
      return NextResponse.json({ error: "只能操作归属自己的客户；跨用户数据仅供查看" }, { status: 403 });
    }
    let rpc: string;
    let args: Record<string, string>;
    if (body.action === "RELEASE") { rpc = "release_customer"; args = { p_customer_id: id, p_reason: body.reason || "" }; }
    else if (body.action === "ASSIGN") { rpc = "assign_customer"; args = { p_customer_id: id, p_user_id: body.user_id || "" }; }
    else if (body.action === "FOLLOWUP_STATUS") { rpc = "change_customer_followup_status"; args = { p_customer_id: id, p_followup_status: body.followup_status || "" }; }
    else return NextResponse.json({ error: "无效操作" }, { status: 400 });

    const { data, error } = await supabase.rpc(rpc, args);
    if (error) throw error;
    if (body.action !== "FOLLOWUP_STATUS") await writeAudit(supabase, user.id, `CUSTOMER_${body.action}`, "customer", id, { reason: body.reason, assignee: body.user_id, status: body.status });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "客户流程操作失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

