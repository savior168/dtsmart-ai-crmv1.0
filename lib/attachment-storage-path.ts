const extensionByMimeType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
};

export function attachmentStoragePath(ownerId: string, folder: string, recordId: string, mimeType: string, uploadId: string) {
  const extension = extensionByMimeType[mimeType];
  if (!extension) throw new Error("附件文件类型不受支持");
  return `${ownerId}/${folder}/${recordId}/${uploadId}.${extension}`;
}
