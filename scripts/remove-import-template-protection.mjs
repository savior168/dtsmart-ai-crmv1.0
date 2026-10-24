import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import XLSX from "xlsx";

const templatePaths = [
  "assets/templates/Warehouse_Stock_Template.xlsx",
  "assets/templates/PI_Whole_Order_Import_Template.xlsx",
  "assets/templates/PI_Import_Template.xlsx",
  "assets/templates/DT-Smart_PI_Template.xlsx",
  "assets/templates/Customer_Public_Pool_Import_Template.xlsx",
  "assets/templates/Customer_Import_Template.xlsx",
  "public/templates/pi-line-import-template.xlsx",
];

for (const filename of templatePaths) {
  const path = resolve(filename);
  const archive = XLSX.CFB.read(await readFile(path), { type: "buffer" });
  let changed = false;
  for (const [index, part] of archive.FullPaths.entries()) {
    if (!/\/xl\/worksheets\/sheet\d+\.xml$/.test(part)) continue;
    const before = archive.FileIndex[index].content.toString("utf8");
    const after = before.replace(/<sheetProtection\b[^>]*\/>/g, "");
    if (after === before) continue;
    archive.FileIndex[index].content = Buffer.from(after, "utf8");
    changed = true;
  }
  if (!changed) continue;

  const result = XLSX.CFB.write(archive, { type: "buffer", fileType: "zip", compression: true });
  const reopened = XLSX.CFB.read(result, { type: "buffer" });
  const expectedFiles = new Map(archive.FullPaths.map((part, index) => [part, archive.FileIndex[index].content])
    .filter(([part]) => !part.endsWith("/")));
  const actualFiles = new Map(reopened.FullPaths.map((part, index) => [part, reopened.FileIndex[index].content])
    .filter(([part]) => !part.endsWith("/")));
  assert.deepEqual([...actualFiles.keys()].sort(), [...expectedFiles.keys()].sort(), `${filename}: ZIP files changed`);
  for (const [part, content] of expectedFiles) {
    assert.deepEqual(actualFiles.get(part), content, `${filename}: ZIP part changed during rewrite: ${part}`);
  }
  await writeFile(path, result);
  console.log(`${filename}: removed worksheet protection`);
}
