import { createAdminClient } from "@/lib/supabase/admin";

const MAX_SIZE = 15 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function safeName(value: string) {
  const extension = value.toLowerCase().match(/\.(jpe?g|png|webp|pdf)$/)?.[0] || "";
  return `evidence${extension === ".jpeg" ? ".jpg" : extension}`;
}

export function validateWorkflowEvidence(value: FormDataEntryValue | null) {
  if (!(value instanceof File)) throw new Error("请上传真实跟进凭证");
  if (value.size <= 0 || value.size > MAX_SIZE) throw new Error("跟进凭证必须小于15MB");
  if (!ALLOWED.has(value.type)) throw new Error("跟进凭证仅支持 JPG、PNG、WebP 或 PDF");
  return value;
}

export async function uploadWorkflowEvidence(userId: string, purpose: "claim" | "renewal", file: File) {
  const admin = createAdminClient();
  const storagePath = `${userId}/${purpose}/${Date.now()}-${crypto.randomUUID()}-${safeName(file.name)}`;
  const upload = await admin.storage.from("crm-attachments").upload(
    storagePath,
    Buffer.from(await file.arrayBuffer()),
    { contentType: file.type, upsert: false },
  );
  if (upload.error) throw upload.error;
  return {
    storagePath,
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    async cleanup() {
      await admin.storage.from("crm-attachments").remove([storagePath]);
    },
  };
}
