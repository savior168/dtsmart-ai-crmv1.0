"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      const nextPath = searchParams.get("next");
      router.replace(nextPath?.startsWith("/") ? nextPath : "/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败，请检查账号和密码");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-7 space-y-4">
      <label className="block text-sm text-slate-300">
        邮箱
        <span className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 focus-within:border-indigo-400/60">
          <Mail size={17} className="text-slate-500" />
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-transparent py-3 outline-none" placeholder="name@company.com" />
        </span>
      </label>
      <label className="block text-sm text-slate-300">
        密码
        <span className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 focus-within:border-indigo-400/60">
          <LockKeyhole size={17} className="text-slate-500" />
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-transparent py-3 outline-none" placeholder="输入密码" />
        </span>
      </label>
      {error && <p role="alert" className="rounded-xl bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-3 font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60">
        {loading && <LoaderCircle size={18} className="animate-spin" />}
        {loading ? "正在登录" : "登录"}
      </button>
    </form>
  );
}
