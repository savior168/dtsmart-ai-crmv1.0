"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AtSign,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
  RefreshCw,
} from "lucide-react";

type Mode = "login" | "register" | "forgot";
type ApiResponse = { ok?: boolean; error?: string; message?: string };
const inputClass =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-11 pr-12 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok) throw new Error(result.error || "操作失败，请稍后重试");
  return result;
}

function Field({
  label,
  icon: Icon,
  children,
  hint,
}: {
  label: string;
  icon: typeof UserRound;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">
        {label}
      </span>
      <span className="relative block">
        <Icon
          aria-hidden="true"
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-slate-400"
        />
        {children}
      </span>
      {hint ? (
        <span className="mt-1.5 block text-xs text-slate-400">{hint}</span>
      ) : null}
    </label>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} icon={LockKeyhole}>
      <input
        required
        minLength={8}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="至少 8 位密码"
        className={inputClass}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "隐藏密码" : "显示密码"}
        className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </Field>
  );
}

export function PasswordAuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(
    params.get("mode") === "register" ? "register" : "login",
  );
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState({
    username: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [captchaVersion, setCaptchaVersion] = useState(1);
  const [captchaExpiresAt, setCaptchaExpiresAt] = useState(() => Date.now() + 120000);
  const [captchaRefreshAt, setCaptchaRefreshAt] = useState(() => Date.now() + 15000);
  const [now, setNow] = useState(() => Date.now());
  const captchaExpired = now >= captchaExpiresAt;

  const refreshCaptcha = useCallback((clearInput = true) => {
    if (clearInput) setCaptcha("");
    setCaptchaExpiresAt(Date.now() + 120000);
    setCaptchaRefreshAt(Date.now() + 15000);
    setCaptchaVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (now >= captchaRefreshAt) refreshCaptcha(false);
  }, [captchaRefreshAt, now, refreshCaptcha]);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
    refreshCaptcha();
  }
  function goToApp() {
    const next = params.get("next");
    window.dispatchEvent(new CustomEvent("dtsmart-auth-changed"));
    router.replace(
      next?.startsWith("/") && !next.startsWith("//") ? next : "/",
    );
    router.refresh();
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    if (captchaExpired) return setError("验证码已失效，请点击图片刷新后重新输入");
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await postJson("/api/auth/password-login", { identifier, password, captcha });
      goToApp();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "登录失败");
      refreshCaptcha();
    } finally {
      setLoading(false);
    }
  }

  async function submitRegister(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (captchaExpired) return setError("验证码已失效，请点击图片刷新后重新输入");
    if (register.password !== register.confirmPassword)
      return setError("两次输入的密码不一致");
    setLoading(true);
    try {
      const result = await postJson("/api/auth/register", { ...register, captcha });
      setMode("login");
      setNotice(result.message || "注册申请已提交，请等待系统管理员审核");
      setIdentifier(register.email);
      setRegister({ username: "", email: "", phone: "", password: "", confirmPassword: "" });
      refreshCaptcha();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "注册失败");
      refreshCaptcha();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {mode !== "forgot" ? (
        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          {(["login", "register"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => switchMode(item)}
              className={`h-10 rounded-lg text-sm font-semibold ${mode === item ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
            >
              {item === "login" ? "登录" : "注册账号"}
            </button>
          ))}
        </div>
      ) : null}

      {mode === "login" ? (
        <form onSubmit={submitLogin} className="mt-6 space-y-4">
          <Field
            label="账号"
            icon={UserRound}
            hint="支持用户名、邮箱或已绑定的国际格式手机号"
          >
            <input
              required
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="用户名 / 邮箱 / 手机号"
              className={inputClass}
            />
          </Field>
          <PasswordField
            label="密码"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <CaptchaField value={captcha} onChange={setCaptcha} version={captchaVersion} refresh={refreshCaptcha} validityRemainingSeconds={Math.max(0, Math.ceil((captchaExpiresAt - now) / 1000))} refreshRemainingSeconds={Math.max(0, Math.ceil((captchaRefreshAt - now) / 1000))} />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => switchMode("forgot")}
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              忘记密码？
            </button>
          </div>
          <Feedback error={error} notice={notice} />
          <PrimaryButton
            loading={loading}
            label="登录系统"
            loadingLabel="正在登录…"
          />
        </form>
      ) : null}

      {mode === "register" ? (
        <form onSubmit={submitRegister} className="mt-6 space-y-4">
          <Field
            label="用户名"
            icon={AtSign}
            hint="1-15 位中文、字母、数字、下划线或短横线"
          >
            <input
              required
              autoComplete="username"
              value={register.username}
              onChange={(event) =>
                setRegister({ ...register, username: event.target.value })
              }
              placeholder="设置登录用户名"
              className={inputClass}
            />
          </Field>
          <Field label="注册邮箱" icon={Mail}>
            <input
              required
              type="email"
              autoComplete="email"
              value={register.email}
              onChange={(event) =>
                setRegister({ ...register, email: event.target.value })
              }
              placeholder="name@company.com"
              className={inputClass}
            />
          </Field>
          <Field
            label="绑定手机号（选填）"
            icon={Phone}
            hint="国际格式，例如 +8613800138000"
          >
            <input
              type="tel"
              autoComplete="tel"
              value={register.phone}
              onChange={(event) =>
                setRegister({ ...register, phone: event.target.value })
              }
              placeholder="+8613800138000"
              className={inputClass}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordField
              label="设置密码"
              value={register.password}
              onChange={(value) =>
                setRegister({ ...register, password: value })
              }
              autoComplete="new-password"
            />
            <PasswordField
              label="确认密码"
              value={register.confirmPassword}
              onChange={(value) =>
                setRegister({ ...register, confirmPassword: value })
              }
              autoComplete="new-password"
            />
          </div>
          <p className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-500">
            <CheckCircle2
              size={16}
              className="mt-0.5 shrink-0 text-emerald-500"
            />
            注册后账号进入待审核状态。系统管理员审核通过后方可登录，手机号仅作为可选登录标识。
          </p>
            <CaptchaField value={captcha} onChange={setCaptcha} version={captchaVersion} refresh={refreshCaptcha} validityRemainingSeconds={Math.max(0, Math.ceil((captchaExpiresAt - now) / 1000))} refreshRemainingSeconds={Math.max(0, Math.ceil((captchaRefreshAt - now) / 1000))} />
          <Feedback error={error} notice={notice} />
          <PrimaryButton
            loading={loading}
            label="提交注册申请"
            loadingLabel="正在提交申请…"
          />
        </form>
      ) : null}

      {mode === "forgot" ? (
        <section className="mt-6 space-y-4">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className="text-sm font-medium text-blue-600"
          >
            ← 返回登录
          </button>
          <div>
            <h3 className="text-xl font-bold text-slate-900">重置登录密码</h3>
            <p className="mt-1 text-sm text-slate-500">
              为保护企业数据，本系统不使用邮件或短信验证码重置密码。
            </p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm leading-6 text-blue-800">
            请联系系统管理员重置密码。管理员会提供一次性临时密码，登录后系统将要求您立即修改。
          </div>
        </section>
      ) : null}
      <p className="mt-6 text-center text-xs leading-5 text-slate-400">
        系统使用 Supabase Auth 加密会话保护账号和企业数据。
      </p>
    </div>
  );
}

function CaptchaField({ value, onChange, version, refresh, validityRemainingSeconds, refreshRemainingSeconds }: { value: string; onChange: (value: string) => void; version: number; refresh: () => void; validityRemainingSeconds: number; refreshRemainingSeconds: number }) {
  // A regular img is intentional: the browser must receive the captcha cookie
  // from this request, which the Next.js image optimizer would not forward.
  // eslint-disable-next-line @next/next/no-img-element
  const expired = validityRemainingSeconds <= 0;
  return <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">图形验证码</span><span className="flex items-stretch gap-2"><input required maxLength={5} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} placeholder="请输入图中字符" className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 px-4 text-[15px] uppercase tracking-[.2em] outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"/><button type="button" onClick={refresh} title="点击刷新验证码" className="group relative flex h-12 w-[154px] overflow-hidden rounded-xl border border-slate-200 bg-blue-50"><img src={`/api/auth/captcha?v=${version}`} alt="图形验证码，点击刷新" className="h-full w-full object-cover"/><span className="absolute inset-0 hidden items-center justify-center bg-slate-950/45 text-xs font-medium text-white group-hover:flex"><RefreshCw size={14} className="mr-1"/>刷新</span></button></span><span className={`mt-1.5 block text-xs ${expired ? "font-medium text-rose-600" : "text-slate-400"}`}>{expired ? "验证码已失效，请点击图片刷新后重新输入。" : `将在 ${refreshRemainingSeconds} 秒后自动刷新。`}</span></label>;
}

function Feedback({ error, notice }: { error: string; notice: string }) {
  if (error)
    return (
      <p
        role="alert"
        className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
      >
        {error}
      </p>
    );
  if (notice)
    return (
      <p
        role="status"
        className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700"
      >
        {notice}
      </p>
    );
  return null;
}
function PrimaryButton({
  loading,
  label,
  loadingLabel,
}: {
  loading: boolean;
  label: string;
  loadingLabel: string;
}) {
  return (
    <button
      disabled={loading}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-60"
    >
      {loading ? (
        <LoaderCircle size={18} className="animate-spin" />
      ) : (
        <ShieldCheck size={18} />
      )}
      {loading ? loadingLabel : label}
    </button>
  );
}
