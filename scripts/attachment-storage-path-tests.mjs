import assert from "node:assert/strict";
import { attachmentStoragePath } from "../lib/attachment-storage-path.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const uploadId = "33333333-3333-4333-8333-333333333333";
const cases = [
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/msword", "doc"],
];

for (const [mimeType, extension] of cases) {
  const path = attachmentStoragePath(ownerId, "stage-evidence", customerId, mimeType, uploadId);
  assert.equal(path, `${ownerId}/stage-evidence/${customerId}/${uploadId}.${extension}`);
  assert.match(path, /^[A-Za-z0-9_/-]+\.[a-z0-9]+$/);
}
assert.throws(() => attachmentStoragePath(ownerId, "followups", customerId, "text/plain", uploadId), /文件类型不受支持/);

console.log("Attachment storage keys remain ASCII for all supported file types.");
