"use client";

import { createClient } from "@/lib/supabase/client";

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateAvatar(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) return "头像仅支持 JPG、PNG、WebP 格式";
  if (file.size > MAX_AVATAR_SIZE) return "头像文件不能超过 5MB";
  if (!file.size) return "头像文件内容为空";
  return "";
}

export async function uploadAvatar(file: File) {
  const validationError = validateAvatar(file);
  if (validationError) throw new Error(validationError);
  const prepare = await fetch("/api/users/avatar/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  });
  const prepared = await prepare.json().catch(() => ({}));
  if (!prepare.ok) throw new Error(prepared.error || "头像上传准备失败");
  const { error } = await createClient()
    .storage.from("avatars")
    .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
  if (error) throw error;
  return String(prepared.path || "");
}
