import assert from "node:assert/strict";
import { readableImportError, sanitizeImportRow } from "../lib/import-safety.ts";

const sanitized = sanitizeImportRow({
  company_name: "Example Customer",
  phone: "+49 123 456",
  suspected_duplicate: true,
  suspected_candidates: [{ id: "candidate" }],
  preflight_candidates: [{ id: "preflight" }],
  preview_id: 1,
  import_meta: { file_name: "test.xls", row_number: 2 },
});

assert.deepEqual(sanitized, {
  company_name: "Example Customer",
  phone: "+49 123 456",
  import_meta: { file_name: "test.xls", row_number: 2 },
});
assert.equal(readableImportError({ message: "数据库字段不存在", code: "PGRST204" }, "导入失败"), "数据库字段不存在");
assert.equal(readableImportError({ details: "约束校验失败" }, "导入失败"), "约束校验失败");
assert.equal(readableImportError({ code: "23505" }, "导入失败"), "数据库错误 23505");
assert.equal(readableImportError({}, "导入失败"), "导入失败");
assert.notEqual(readableImportError({}, "导入失败"), "[object Object]");

console.log("import safety regression tests: ok");
