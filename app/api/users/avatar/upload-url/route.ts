import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser();
    const body = await request.json();
    const contentType = String(body.contentType || "").toLowerCase();
    const size = Number(body.size || 0);
    const extension = MIME_EXTENSIONS[contentType];
    if (!extension) return NextResponse.json({ error: "头像仅支持 JPG、PNG、WebP 格式" }, { status: 400 });
    if (!Number.isFinite(size) || size <= 0 || size > MAX_AVATAR_SIZE) {
      return NextResponse.json({ error: "头像文件不能超过 5MB" }, { status: 400 });
    }

    const admin = createAdminClient();
    const bucket = "avatars";
    const { data: bucketInfo, error: bucketError } = await admin.storage.getBucket(bucket);
    if (bucketError && !/not found/i.test(bucketError.message)) throw bucketError;
    if (!bucketInfo) {
      const { error } = await admin.storage.createBucket(bucket, {
        public: false,
        fileSizeLimit: MAX_AVATAR_SIZE,
        allowedMimeTypes: Object.keys(MIME_EXTENSIONS),
      });
      if (error && !/already exists/i.test(error.message)) throw error;
    }

    const path = `${user.id}/avatar-${Date.now()}.${extension}`;
    const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
    if (error) throw error;
    return NextResponse.json({ path, token: data.token });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "头像上传准备失败" }, { status: 400 });
  }
}
