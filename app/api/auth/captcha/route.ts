import { NextResponse } from "next/server";
import { CAPTCHA_COOKIE, createCaptcha } from "@/lib/auth/captcha";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { token, svg } = createCaptcha();
    const response = new NextResponse(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store, max-age=0" } });
    response.cookies.set(CAPTCHA_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 120 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "验证码生成失败" }, { status: 500 });
  }
}
