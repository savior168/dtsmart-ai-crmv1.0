const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
};

// Storage keys are opaque identifiers. Keep the user's original filename in metadata,
// never in a key: Supabase Storage rejects some otherwise valid Unicode filenames.
export function storageObjectName(id: string, mimeType: string): string {
  const extension = EXTENSIONS[mimeType.toLowerCase()];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !extension) {
    throw new Error("附件文件名或类型无效");
  }
  return `${id}.${extension}`;
}

