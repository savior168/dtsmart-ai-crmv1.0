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
  const noise = randomBytes(72);
  const lines = Array.from({ length: 9 }, (_, index) => {
    const offset = index * 4;
    const x1 = noise[offset] % 220;
    const y1 = noise[offset + 1] % 56;
    const x2 = noise[offset + 2] % 220;
    const y2 = noise[offset + 3] % 56;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${index % 2 ? "#93c5fd" : "#c4b5fd"}" stroke-width="1" opacity=".65"/>`;
  }).join("");
  const dots = Array.from({ length: 18 }, (_, index) => {
    const offset = 36 + index * 2;
    return `<circle cx="${noise[offset] % 220}" cy="${noise[offset + 1] % 56}" r="${1 + noise[index] % 2}" fill="${index % 2 ? "#60a5fa" : "#a78bfa"}" opacity=".45"/>`;
  }).join("");
  const letters = code.split("").map((letter, index) => {
    const x = 24 + index * 38;
    const angle = (noise[index] % 19) - 9;
    const y = 37 + (noise[index + 6] % 7) - 3;
    return `<text x="${x}" y="${y}" transform="rotate(${angle} ${x} ${y})" font-family="ui-monospace,monospace" font-size="27" font-weight="800" fill="${index % 2 ? "#1d4ed8" : "#6d28d9"}">${letter}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="56" viewBox="0 0 220 56"><rect width="220" height="56" rx="10" fill="#eff6ff"/>${dots}${lines}${letters}</svg>`;
  return { token, svg };
}

export async function verifyCaptcha(answer: unknown) {
  const input = String(answer || "").trim().toUpperCase();
  if (!input) return { ok: false, error: "请输入图形验证码" };
  const cookieStore = await cookies();
  const token = cookieStore.get(CAPTCHA_COOKIE)?.value || "";
  // A challenge is single-use regardless of the answer. The client refreshes
  // after every response, preventing captured answers from being replayed.
  cookieStore.delete(CAPTCHA_COOKIE);
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, error: "验证码已失效，请刷新后重试" };
  const [code, expires, nonce, signature] = parts;
  const payload = `${code}.${expires}.${nonce}`;
  if (sign(payload) !== signature || Number(expires) < Date.now()) return { ok: false, error: "验证码已失效，请刷新后重试" };
  if (input !== code) return { ok: false, error: "图形验证码错误" };
  return { ok: true as const };
}
