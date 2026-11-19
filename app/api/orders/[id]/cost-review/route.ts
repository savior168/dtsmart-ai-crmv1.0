import { NextResponse } from "next/server";

// Older browser tabs may still call this retired endpoint.
export async function POST() {
  return NextResponse.json({ error: "采购价触发的销售成本复核已停用，请使用 PI 产品更正价格" }, { status: 410 });
}
