import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { NextResponse } from "next/server";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

export async function GET() {
  try {
    const template = XLSX.CFB.read(await readFile(path.join(process.cwd(), "assets", "templates", "DT-Smart_PI_Template.xlsx")), { type: "buffer" });
    const image = XLSX.CFB.find(template, "/xl/media/image.png");
    if (!image?.content) throw new Error("PI企业Logo不可用");
    return new NextResponse(new Uint8Array(image.content), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
