import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { classifyIdentifier, isUsername } from "@/lib/auth/identifiers";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAPTCHA_COOKIE, verifyCaptcha } from "@/lib/auth/captcha";
import { isTimedLockActive, nextFailedLogin } from "@/lib/auth/lockout";

function loginError(message?: string) {
  if (message?.includes("Email not confirmed") || message?.includes("Phone not confirmed")) {
    return "账号尚未启用，请联系管理员确认账号状态";
  }
  return "账号或密码错误，请检查后重试";
}

function isTransientAuthError(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown; status?: unknown } | null;
  const code = String(candidate?.code || candidate?.status || "");
  const message = String(candidate?.message || "");
  return ["408", "429", "502", "503", "504", "525", "529", "57014", "PGRST003"].includes(code)
    || /(?:gateway timeout|temporar(?:y|ily)|timed? out|statement timeout|fetch failed|network|ssl handshake failed|cloudflare|aborted)/i.test(message);
}

async function recordFailedPasswordAttempt(admin: ReturnType<typeof createAdminClient>, id: string, maxAttempts: number, lockMinutes: number) {
  // Compare-and-swap avoids lost increments when several wrong passwords are
  // submitted concurrently. A concurrent admin lock/status change wins.
  for (let retry = 0; retry < 5; retry += 1) {
    const current = await admin.from("users").select("status,failed_login_attempts,locked_until").eq("id", id).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data || current.data.status !== "ACTIVE") return { blocked: true, locked: false };
    if (isTimedLockActive(current.data.locked_until)) return { blocked: true, locked: true };
    const previousAttempts = Number(current.data.failed_login_attempts || 0);
    const next = nextFailedLogin(previousAttempts, current.data.locked_until, maxAttempts, lockMinutes);
    let update = admin.from("users").update({ failed_login_attempts: next.attempts, locked_until: next.lockedUntil })
      .eq("id", id).eq("status", "ACTIVE").eq("failed_login_attempts", previousAttempts);
    update = current.data.locked_until ? update.eq("locked_until", current.data.locked_until) : update.is("locked_until", null);
    const saved = await update.select("id");
    if (saved.error) throw saved.error;
    if (saved.data?.length === 1) return { blocked: false, locked: Boolean(next.lockedUntil) };
  }
  throw new Error("登录失败计数发生并发冲突，请稍后重试");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const identifier = String(body.identifier || "").trim();
    const password = String(body.password || "");
    if (!identifier || !password) return NextResponse.json({ error: "请输入账号和密码" }, { status: 400 });
    const captcha = await verifyCaptcha(body.captcha);
    if (!captcha.ok) return NextResponse.json({ error: captcha.error }, { status: 400 });
    const classified = classifyIdentifier(identifier);
    const admin = createAdminClient();
    const accountFields = "id,name,email,status,failed_login_attempts,locked_until,must_change_password,temporary_password_expires_at";
    let account: { id: string; name: string | null; email: string; status: string; failed_login_attempts: number | null; locked_until: string | null; must_change_password: boolean; temporary_password_expires_at: string | null } | null = null;
    let accountError: { message?: string } | null = null;
    if (classified.type === "phone") {
      const profile = await admin.from("profiles").select("id").eq("phone", classified.value).limit(1).abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
      if (profile.error) accountError = profile.error;
      else if (profile.data?.id) {
        const found = await admin.from("users").select(accountFields).eq("id", profile.data.id).abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
        account = found.data;
        accountError = found.error;
      }
    } else if (classified.type === "username") {
      if (!isUsername(identifier)) return NextResponse.json({ error: "请输入有效的用户名、邮箱或国际格式手机号" }, { status: 400 });
      const found = await admin.from("users").select(accountFields).ilike("name", classified.value).limit(20).abortSignal(AbortSignal.timeout(8_000));
      account = found.data?.find((item) => String(item.name || "").trim().toLowerCase() === classified.value) || null;
      accountError = found.error;
    } else {
      const found = await admin.from("users").select(accountFields).eq("email", classified.value).abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
      account = found.data;
      accountError = found.error;
    }
    if (accountError && isTransientAuthError(accountError)) {
      console.warn("[auth/password-login] account lookup temporarily unavailable", { message: accountError.message });
      return NextResponse.json({ error: "登录服务暂时繁忙，请稍后重试" }, { status: 503 });
    }
    if (accountError || !account) {
      console.error("[auth/password-login] account lookup failed", { code:(accountError as {code?:string}|null)?.code, message:accountError?.message, account_found:Boolean(account) });
      return NextResponse.json({ error: "账号资料异常，请联系系统管理员" }, { status: 403 });
    }
    const statusMessages: Record<string, string> = {
      PENDING: "注册申请正在等待系统管理员审核，暂时无法登录",
      REJECTED: "注册申请未通过审核，请联系系统管理员",
      DISABLED: "账号已停用，请联系系统管理员",
      DEPARTED: "账号已标记离职，无法继续登录",
      LOCKED: "账号已锁定，请联系系统管理员解锁",
    };
    if (account.status !== "ACTIVE") return NextResponse.json({ error: statusMessages[account.status] || "账号当前不可用，请联系系统管理员" }, { status: 403 });
    if (account.must_change_password && account.temporary_password_expires_at && Date.parse(account.temporary_password_expires_at) < Date.now()) return NextResponse.json({ error: "临时密码已过期，请联系系统管理员重新生成" }, { status: 403 });
    if (account.locked_until && isTimedLockActive(account.locked_until)) {
      const detail = account.failed_login_attempts ? "登录失败次数过多" : "账号已由系统管理员锁定";
      return NextResponse.json({ error: `${detail}，请在 ${new Date(account.locked_until).toLocaleString("zh-CN")} 后重试，或联系系统管理员提前解锁` }, { status: 423 });
    }
    let credentials: { email: string; password: string } | { phone: string; password: string };
    if (classified.type === "email") credentials = { email: account.email, password };
    else if (classified.type === "phone") credentials = { phone: classified.value, password };
    else {
      if (account.email) credentials = { email: account.email, password };
      else return NextResponse.json({ error: "该账号尚未绑定可登录的邮箱" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("登录服务未配置");

    // Collect only the cookies generated by this login. Using next/headers'
    // mutable cookie store here can copy stale request cookies back into the
    // response and make every following request exceed Vercel's header limit.
    const response = NextResponse.json({ ok: true });
    const supabase = createServerClient(url, key, {
      cookies: {
        // A password login does not need an existing Supabase session. Start
        // with an empty cookie jar so an oversized/stale session can never be
        // re-serialized into the successful login response.
        getAll: () => [],
        setAll: (items: Array<{ name: string; value: string; options: CookieOptions }>) => {
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data, error } = await supabase.auth.signInWithPassword(credentials);
    if (error || !data.user) {
      // Infrastructure failures are not invalid-password attempts. Never lock
      // a valid account because the upstream Auth gateway timed out.
      if (error && isTransientAuthError(error)) {
        console.warn("[auth/password-login] auth provider temporarily unavailable", { status: error.status, message: error.message });
        return NextResponse.json({ error: "登录服务暂时繁忙，请稍后重试" }, { status: 503 });
      }
      const { data: settings, error: settingsError } = await admin.from("system_security_settings").select("max_failed_login_attempts,lock_minutes").eq("id", true).maybeSingle();
      if (settingsError) throw settingsError;
      const maxAttempts = Number(settings?.max_failed_login_attempts || 5);
      const failure = await recordFailedPasswordAttempt(admin, account.id, maxAttempts, Number(settings?.lock_minutes || 15));
      if (failure.blocked) return NextResponse.json({ error: failure.locked ? "账号已临时锁定，请到期后重试或联系管理员解锁" : "账号当前不可用" }, { status: 423 });
      return NextResponse.json({ error: failure.locked ? "登录失败次数过多，账号已临时锁定" : loginError(error?.message) }, { status: 401 });
    }
    let successfulLogin = admin.from("users").update({ failed_login_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
      .eq("id", account.id).eq("status", "ACTIVE").eq("failed_login_attempts", Number(account.failed_login_attempts || 0));
    successfulLogin = account.locked_until ? successfulLogin.eq("locked_until", account.locked_until) : successfulLogin.is("locked_until", null);
    const savedLogin = await successfulLogin.select("id");
    if (savedLogin.error) throw savedLogin.error;
    if (savedLogin.data?.length !== 1) return NextResponse.json({ error: "账号状态已变化，请重新登录" }, { status: 409 });
    response.cookies.delete(CAPTCHA_COOKIE);
    return response;
  } catch (error) {
    console.error("[auth/password-login]", error);
    return NextResponse.json({ error: "登录服务暂时不可用，请稍后重试" }, { status: 500 });
  }
}
