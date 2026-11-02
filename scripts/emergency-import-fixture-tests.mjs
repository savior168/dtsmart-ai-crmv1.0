import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const { parseImportFile, mapImportRow, normalizeImportCountry, importDeliveryContactError } = await jiti.import("../lib/import-parser.ts");
const { normalizeManualContacts, splitManualContacts } = await jiti.import("../lib/contacts/manual-contact-list.ts");
const { customerStageContactError } = await jiti.import("../lib/customer-contact-requirement.ts");
const { importedCustomerStage } = await jiti.import("../lib/customers/import-profile.ts");
const { customerImportIdentityKeys } = await jiti.import("../lib/import-dedupe.ts");

const path = process.argv[2];
assert.ok(path, "Pass the private customer workbook path as the first argument");
const file = new File([await readFile(path)], basename(path));
const rows = await parseImportFile(file);
const accepted = [];
const rejected = [];
const seen = new Set();
for (const [index, raw] of rows.entries()) {
  const rowNumber = Number.isInteger(raw.__rowNum__) ? raw.__rowNum__ + 1 : index + 2;
  const item = mapImportRow(raw);
  try {
    if (!item.contact_name) throw new Error("客户名称为空");
    if (!normalizeImportCountry(item.country)) throw new Error("国家/地区为空或无效");
    for (const kind of ["phone", "email", "wechat", "whatsapp"]) item[kind] = normalizeManualContacts(item[kind], kind);
    const deliveryError = importDeliveryContactError(item);
    if (deliveryError) throw new Error(deliveryError);
    const stageError = customerStageContactError(importedCustomerStage(item.import_stage, "PRIVATE"), item);
    if (stageError) throw new Error(stageError);
    const keys = customerImportIdentityKeys(item);
    if (keys.some((key) => seen.has(key))) throw new Error("客户身份重复");
    keys.forEach((key) => seen.add(key));
    accepted.push({ rowNumber, item });
  } catch (error) {
    rejected.push({ rowNumber, reason: error.message });
  }
}

assert.equal(rows.length, 156, "source workbook must expose all 156 customer rows");
assert.equal(accepted.length, 141, `expected all 141 valid rows; rejected: ${JSON.stringify(rejected)}`);
assert.equal(rejected.length, 15);
assert.ok(rejected.every((row) => row.reason === "国家/地区为空或无效"));
assert.ok(accepted.every(({ item }) => [item.phone, item.email, item.wechat, item.whatsapp].some(Boolean)));

const multi = {
  phone: "+49 699 043 1261；+49 699 043 1262",
  email: "a@example.com;b@example.com",
  wechat: "wechat-one;wechat-two",
  whatsapp: "+49 699 043 1263;+49 699 043 1264",
};
for (const kind of Object.keys(multi)) {
  assert.equal(splitManualContacts(normalizeManualContacts(multi[kind], kind)).length, 2, `${kind} must remain two editable entries`);
}
assert.throws(() => normalizeManualContacts("good@example.com;bad-email", "email"), /邮箱格式不正确/);
assert.throws(() => normalizeManualContacts("+49 699 043 1261;bad-number", "phone"), /联系电话格式不正确/);
console.log(`customer fixture parsed: ${rows.length} rows, ${accepted.length} accepted, ${rejected.length} rejected with source row numbers`);

