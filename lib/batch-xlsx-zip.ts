import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

export function buildWorkbookZip(files: Array<{ name: string; data: ArrayBuffer | Uint8Array }>) {
  if (!files.length) throw new Error("筛选结果没有可导出的订单");
  const archive = XLSX.CFB.utils.cfb_new();
  const names = new Set<string>();
  for (const file of files) {
    const safeName = file.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
    if (!safeName || safeName === "." || safeName === ".." || names.has(safeName.toLowerCase())) {
      throw new Error("导出文件名重复或无效，请核对订单编号");
    }
    names.add(safeName.toLowerCase());
    const bytes = file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : file.data;
    XLSX.CFB.utils.cfb_add(archive, safeName, Buffer.from(bytes));
  }
  return Buffer.from(XLSX.CFB.write(archive, { fileType: "zip", type: "buffer" }) as Uint8Array);
}
