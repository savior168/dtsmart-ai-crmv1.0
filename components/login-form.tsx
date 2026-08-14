"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  AtSign,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";

type PageMode = "login" | "register";
type LoginMethod = "password" | "otp";
type ContactType = "email" | "phone";
type ApiResponse = { ok?: boolean; error?: string; message?: string; otp_sent?: boolean };

const inputClass = "h-12 w-full rounded-xl border border-slate-200 bg-white px-11 pr-12 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as ApiResponse;
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
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <span className="relative block">
        <Icon aria-hidden="true" size={18} className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
        {children}
      </span>
      {hint ? <span className="mt-1.5 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

function PasswordField({ label, value, onChange, autoComplete, placeholder = "请输入密码" }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string; placeholder?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} icon={LockKeyhole}>
      <input
        required
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
      <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "隐藏密码" : "显示密码"} className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </Field>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pageMode, setPageMode] = useState<PageMode>(params.get("mode") === "register" ? "register" : "login");
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("password");
  const [contactType, setContactType] = useState<ContactType>("email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [contact, setContact] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [register, setRegister] = useState({ username: "", name: "", email: "", phone: "", password: "", confirmPassword: "" });
  const [registerVerification, setRegisterVerification] = useState<{ type: ContactType; contact: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  function clearFeedback() {
    setError("");
    setNotice("");
  }

  function goToApp() {
    const next = params.get("next");
    router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setLoading(true);
    try {
      await postJson("/api/auth/password-login", { identifier, password });
      goToApp();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function sendOtp(targetType = contactType, targetContact = contact) {
    clearFeedback();
    setLoading(true);
    try {
      const result = await postJson("/api/auth/send-otp", { type: targetType, contact: targetContact });
      setOtpSent(true);
      setCountdown(60);
      setNotice(result.message || "验证码已发送，请注意查收");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "验证码发送失败");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>, verification = { type: contactType, contact }) {
    event.preventDefault();
    clearFeedback();
    setLoading(true);
    try {
      await postJson("/api/auth/verify-otp", { ...verification, token: otp });
      goToApp();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "验证码验证失败");
    } finally {
      setLoading(false);
    }
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    if (register.password !== register.confirmPassword) return setError("两次输入的密码不一致");
    setLoading(true);
    try {
      const result = await postJson("/api/auth/register", { type: contactType, ...register });
      const verificationContact = contactType === "email" ? register.email : register.phone;
      setRegisterVerification({ type: contactType, contact: verificationContact });
      setOtp("");
      setCountdown(result.otp_sent ? 60 : 0);
      setNotice(result.message || "账号已创建，请完成验证码确认");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "注册失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  const switchMode = (mode: PageMode) => {
    setPageMode(mode);
    setRegisterVerification(null);
    setOtpSent(false);
    setOtp("");
    clearFeedback();
  };

  return (
    <div>
      <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="登录或注册">
        {(["login", "register"] as const).map((mode) => (
          <button key={mode} type="button" role="tab" aria-selected={pageMode === mode} onClick={() => switchMode(mode)} className={`h-10 rounded-lg text-sm font-semibold transition ${pageMode === mode ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            {mode === "login" ? "登录" : "注册账号"}
          </button>
        ))}
      </div>

      {pageMode === "login" ? (
        <div className="mt-6">
          <div className="flex gap-6 border-b border-slate-200" role="tablist" aria-label="登录方式">
            {(["password", "otp"] as const).map((method) => (
              <button key={method} type="button" role="tab" aria-selected={loginMethod === method} onClick={() => { setLoginMethod(method); setOtpSent(false); setOtp(""); clearFeedback(); }} className={`relative pb-3 text-sm font-semibold transition ${loginMethod === method ? "text-blue-700" : "text-slate-500 hover:text-slate-800"}`}>
                {method === "password" ? "密码登录" : "验证码登录"}
                {loginMethod === method ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-blue-600" /> : null}
              </button>
            ))}
          </div>

          {loginMethod === "password" ? (
            <form onSubmit={submitPassword} className="mt-5 space-y-4">
              <Field label="账号" icon={UserRound} hint="支持用户名、企业邮箱或国际格式手机号">
                <input required autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="用户名 / 邮箱 / 手机号" className={inputClass} />
              </Field>
              <PasswordField label="密码" value={password} onChange={setPassword} autoComplete="current-password" />
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-slate-500"><input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600" />保持登录状态</label>
                <button type="button" onClick={() => { setLoginMethod("otp"); clearFeedback(); }} className="font-medium text-blue-600 hover:text-blue-700">忘记密码？使用验证码登录</button>
              </div>
              <Feedback error={error} notice={notice} />
              <PrimaryButton loading={loading} label="登录系统" loadingLabel="正在安全登录…" />
            </form>
          ) : (
            <form onSubmit={(event) => verifyOtp(event)} className="mt-5 space-y-4">
              <ContactSwitch value={contactType} onChange={(value) => { setContactType(value); setContact(""); setOtp(""); setOtpSent(false); clearFeedback(); }} />
              <Field label={contactType === "email" ? "邮箱" : "手机号"} icon={contactType === "email" ? Mail : Phone} hint={contactType === "phone" ? "请输入国际格式，例如 +8613800138000" : "验证码将发送到已注册邮箱"}>
                <input required type={contactType === "email" ? "email" : "tel"} autoComplete={contactType === "email" ? "email" : "tel"} value={contact} onChange={(event) => setContact(event.target.value)} placeholder={contactType === "email" ? "name@company.com" : "+8613800138000"} className={inputClass} />
              </Field>
              {otpSent ? <OtpInput value={otp} onChange={setOtp} countdown={countdown} disabled={loading} resend={() => void sendOtp()} /> : null}
              <Feedback error={error} notice={notice} />
              {otpSent ? <PrimaryButton loading={loading} label="验证并登录" loadingLabel="正在验证…" /> : <button type="button" disabled={loading} onClick={() => void sendOtp()} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">{loading ? <LoaderCircle size={18} className="animate-spin" /> : <KeyRound size={18} />}{loading ? "正在发送…" : "获取验证码"}</button>}
            </form>
          )}
        </div>
      ) : registerVerification ? (
        <form onSubmit={(event) => verifyOtp(event, registerVerification)} className="mt-7 space-y-5">
          <button type="button" onClick={() => { setRegisterVerification(null); setOtp(""); clearFeedback(); }} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-700"><ArrowLeft size={16} />返回修改注册信息</button>
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-center gap-2 font-semibold text-blue-900"><ShieldCheck size={19} />完成账号验证</div>
            <p className="mt-2 break-all text-sm leading-6 text-blue-700">验证码已发送至 {registerVerification.contact}</p>
          </div>
          <OtpInput value={otp} onChange={setOtp} countdown={countdown} disabled={loading} resend={() => void sendOtp(registerVerification.type, registerVerification.contact)} />
          <Feedback error={error} notice={notice} />
          <PrimaryButton loading={loading} label="完成验证并进入系统" loadingLabel="正在验证…" />
        </form>
      ) : (
        <form onSubmit={submitRegister} className="mt-6 space-y-4">
          <ContactSwitch value={contactType} onChange={(value) => { setContactType(value); clearFeedback(); }} register />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="用户名" icon={AtSign}><input required autoComplete="username" value={register.username} onChange={(event) => setRegister((current) => ({ ...current, username: event.target.value }))} placeholder="3-30 位字符" className={inputClass} /></Field>
            <Field label="姓名" icon={UserRound}><input required autoComplete="name" value={register.name} onChange={(event) => setRegister((current) => ({ ...current, name: event.target.value }))} placeholder="您的姓名" className={inputClass} /></Field>
          </div>
          <Field label={contactType === "email" ? "注册邮箱" : "绑定邮箱（选填）"} icon={Mail}>
            <input required={contactType === "email"} type="email" autoComplete="email" value={register.email} onChange={(event) => setRegister((current) => ({ ...current, email: event.target.value }))} placeholder={contactType === "email" ? "name@company.com" : "可绑定邮箱，便于多方式登录"} className={inputClass} />
          </Field>
          <Field label={contactType === "phone" ? "注册手机号" : "绑定手机号（选填）"} icon={Phone} hint="手机号须包含国家区号，例如 +8613800138000">
            <input required={contactType === "phone"} type="tel" autoComplete="tel" value={register.phone} onChange={(event) => setRegister((current) => ({ ...current, phone: event.target.value }))} placeholder="+8613800138000" className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordField label="设置密码" value={register.password} onChange={(value) => setRegister((current) => ({ ...current, password: value }))} autoComplete="new-password" placeholder="至少 8 位" />
            <PasswordField label="确认密码" value={register.confirmPassword} onChange={(value) => setRegister((current) => ({ ...current, confirmPassword: value }))} autoComplete="new-password" placeholder="再次输入密码" />
          </div>
          <p className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-500"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" />注册后将发送验证码确认账号。邮箱与手机号可同时绑定，并用于后续登录。</p>
          <Feedback error={error} notice={notice} />
          <PrimaryButton loading={loading} label="创建账号并发送验证码" loadingLabel="正在创建账号…" />
        </form>
      )}

      <p className="mt-6 text-center text-xs leading-5 text-slate-400">登录即表示您同意企业数据安全规范，系统全程采用加密会话保护。</p>
    </div>
  );
}

function ContactSwitch({ value, onChange, register = false }: { value: ContactType; onChange: (value: ContactType) => void; register?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
      {(["email", "phone"] as const).map((type) => (
        <button key={type} type="button" onClick={() => onChange(type)} className={`flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-medium transition ${value === type ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
          {type === "email" ? <Mail size={15} /> : <Phone size={15} />}{type === "email" ? `邮箱${register ? "注册" : ""}` : `手机${register ? "注册" : ""}`}
        </button>
      ))}
    </div>
  );
}

function OtpInput({ value, onChange, countdown, disabled, resend }: { value: string; onChange: (value: string) => void; countdown: number; disabled: boolean; resend: () => void }) {
  return (
    <Field label="验证码" icon={KeyRound}>
      <input required inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))} placeholder="请输入验证码" className={inputClass} />
      <button type="button" disabled={disabled || countdown > 0} onClick={resend} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:text-slate-400">
        {countdown > 0 ? `${countdown}s 后重发` : "重新发送"}
      </button>
    </Field>
  );
}

function Feedback({ error, notice }: { error: string; notice: string }) {
  if (error) return <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm leading-5 text-rose-700">{error}</p>;
  if (notice) return <p role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm leading-5 text-emerald-700">{notice}</p>;
  return null;
}

function PrimaryButton({ loading, label, loadingLabel }: { loading: boolean; label: string; loadingLabel: string }) {
  return (
    <button disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-blue-600/25 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0">
      {loading ? <LoaderCircle size={18} className="animate-spin" /> : <ShieldCheck size={18} />}{loading ? loadingLabel : label}
    </button>
  );
}
