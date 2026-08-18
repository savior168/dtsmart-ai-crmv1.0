"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("新密码至少需要 8 位");
    if (password !== confirm) return setError("两次输入的新密码不一致");
    setBusy(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) return setError(`密码重置失败：${updateError.message}`);
    await supabase.auth.signOut();
    router.replace("/login?reset=success");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xl"
      >
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-blue-50 text-blue-600">
          <KeyRound />
        </span>
        <h1 className="mt-5 text-2xl font-bold">设置新密码</h1>
        <p className="mt-2 text-sm text-slate-500">
          请输入新的登录密码，保存后需要重新登录。
        </p>
        <label className="mt-6 block text-sm font-medium">
          新密码
          <input
            required
            minLength={8}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5"
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          确认新密码
          <input
            required
            minLength={8}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5"
          />
        </label>
        {error ? (
          <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <button
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white disabled:opacity-60"
        >
          {busy ? <LoaderCircle size={17} className="animate-spin" /> : null}
          {busy ? "保存中…" : "保存新密码"}
        </button>
      </form>
    </main>
  );
}
