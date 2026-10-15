import { NextResponse } from "next/server";

// Older browser tabs may still call this retired endpoint. Do not mutate PI data.
export async function PATCH() {
  return NextResponse.json({ error: "客户英文核对功能已移除，请刷新页面" }, { status: 410 });
}
