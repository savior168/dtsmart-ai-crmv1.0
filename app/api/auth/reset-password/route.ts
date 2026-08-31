import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ ok: true, message: "请联系系统管理员重置密码。管理员会提供一次性临时密码，登录后必须立即修改。" });
}
