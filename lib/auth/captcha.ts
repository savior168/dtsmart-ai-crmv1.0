import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const CAPTCHA_COOKIE = "dtsmart_captcha";
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function secret() {
  const value = process.env.CAPTCHA_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("验证码服务未配置");
  return value;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function createCaptcha() {
  const code = Array.from(randomBytes(5), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
  const expires = Date.now() + 2 * 60 * 1000;
  const payload = `${code}.${expires}.${randomBytes(8).toString("hex")}`;
  const token = `${payload}.${sign(payload)}`;
  const lines = Array.from({ length: 7 }, (_, index) => {
    const x1 = (index * 29 + 7) % 210;
    const y1 = (index * 17 + 9) % 56;
    const x2 = (index * 41 + 83) % 210;
    const y2 = (index * 23 + 31) % 56;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${index % 2 ? "#93c5fd" : "#c4b5fd"}" stroke-width="1" opacity=".65"/>`;
  }).join("");
  const letters = code.split("").map((letter, index) => `<text x="${24 + index * 38}" y="39" transform="rotate(${index % 2 ? 6 : -7} ${24 + index * 38} 39)" font-family="ui-monospace,monospace" font-size="27" font-weight="800" fill="${index % 2 ? "#1d4ed8" : "#6d28d9"}">${letter}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="56" viewBox="0 0 220 56"><rect width="220" height="56" rx="10" fill="#eff6ff"/>${lines}${letters}</svg>`;
  return { token, svg };
}

export async function verifyCaptcha(answer: unknown) {
  const input = String(answer || "").trim().toUpperCase();
  if (!input) return { ok: false, error: "请输入图形验证码" };
  const token = (await cookies()).get(CAPTCHA_COOKIE)?.value || "";
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, error: "验证码已失效，请刷新后重试" };
  const [code, expires, nonce, signature] = parts;
  const payload = `${code}.${expires}.${nonce}`;
  if (sign(payload) !== signature || Number(expires) < Date.now()) return { ok: false, error: "验证码已失效，请刷新后重试" };
  if (input !== code) return { ok: false, error: "图形验证码错误" };
  return { ok: true as const };
}
