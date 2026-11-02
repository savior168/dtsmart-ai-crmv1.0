import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storageObjectName } from "../lib/storage-object-key.ts";

const id = "232f0c1a-6c1c-425b-b319-61416116c28e";
for (const [mime, extension] of [
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/msword", "doc"],
]) {
  assert.equal(storageObjectName(id, mime), `${id}.${extension}`);
}
assert.throws(() => storageObjectName("为什么选择我们22.webp", "image/webp"));
assert.throws(() => storageObjectName(id, "text/html"));

for (const route of ["app/api/attachments/route.ts", "app/api/customers/[id]/workflow/route.ts"]) {
  const source = readFileSync(new URL(`../${route}`, import.meta.url), "utf8");
  assert.match(source, /storageObjectName\(/, `${route} must use an opaque storage key`);
  assert.doesNotMatch(source, /safeName\(file\.name\)/, `${route} must not embed a filename in its key`);
  assert.match(source, /filename:\s*file\.name|p_filename:\s*file instanceof File \? file\.name/, `${route} must preserve the original filename in metadata`);
}
const claimEvidence = readFileSync(new URL("../lib/customer-workflow-evidence.ts", import.meta.url), "utf8");
assert.match(claimEvidence, /safeName\(file\.name\)/);
assert.match(claimEvidence, /return `evidence\$\{extension/, "claim and renewal evidence uses a fixed ASCII filename");
const avatar = readFileSync(new URL("../app/api/users/avatar/upload-url/route.ts", import.meta.url), "utf8");
assert.match(avatar, /avatar-\$\{Date\.now\(\)\}\.\$\{extension\}/, "avatar key uses only server-generated ASCII characters");
console.log("storage object key regression tests passed");

