"use client";

import Image from "next/image";
import { KeyRound, Save, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";

type Props = {
  initialName: string;
  initialEmail: string;
  initialAvatar?: string;
};

export function ProfileSettingsForm({
  initialName,
  initialEmail,
  initialAvatar = "",
}: Props) {
  const [profile, setProfile] = useState({
    name: initialName,
    email: initialEmail,
    avatar_url: initialAvatar,
  });
  const [password, setPassword] = useState({
    old_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"profile" | "password" | "">("");

  function pickAvatar(file?: File) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("头像文件不能超过 1MB");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError("头像读取失败，请重新选择");
    reader.onload = () =>
      setProfile((current) => ({
        ...current,
        avatar_url: String(reader.result || ""),
      }));
    reader.readAsDataURL(file);
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy("profile");
    setError("");
    setMessage("");
    const response = await fetch("/api/users/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setError(result.error || "资料保存失败");
      return;
    }
    setMessage(result.message || "资料已保存");
    window.dispatchEvent(new CustomEvent("dtsmart-profile-updated"));
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setBusy("password");
    setError("");
    setMessage("");
    const response = await fetch("/api/users/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(password),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setError(result.error || "密码修改失败");
      return;
    }
    setPassword({ old_password: "", new_password: "", confirm_password: "" });
    setMessage(result.message || "登录密码已更新");
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <form
        onSubmit={saveProfile}
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h3 className="font-semibold">个人资料</h3>
        <div className="mt-5 flex items-center gap-4">
          <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-50 text-2xl font-semibold text-blue-600">
            {profile.avatar_url ? (
              <Image
                unoptimized
                width={80}
                height={80}
                src={profile.avatar_url}
                alt="头像预览"
                className="h-full w-full object-cover"
              />
            ) : (
              (profile.name || "用").slice(0, 1)
            )}
          </span>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
            <Upload size={16} />
            更换头像
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => pickAvatar(event.target.files?.[0])}
            />
          </label>
        </div>
        <label className="mt-5 block text-sm font-medium">
          用户名
          <input
            required
            value={profile.name}
            onChange={(event) =>
              setProfile({ ...profile, name: event.target.value })
            }
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5"
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          登录邮箱
          <input
            required
            type="email"
            value={profile.email}
            onChange={(event) =>
              setProfile({ ...profile, email: event.target.value })
            }
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5"
          />
        </label>
        <button
          disabled={busy === "profile"}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          <Save size={16} />
          {busy === "profile" ? "保存中…" : "保存资料"}
        </button>
      </form>
      <form
        onSubmit={savePassword}
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h3 className="flex items-center gap-2 font-semibold">
          <KeyRound size={18} className="text-blue-600" />
          修改登录密码
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          修改前必须验证当前密码，新密码至少 8 位。
        </p>
        <label className="mt-5 block text-sm font-medium">
          当前密码
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password.old_password}
            onChange={(event) =>
              setPassword({ ...password, old_password: event.target.value })
            }
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5"
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          新密码
          <input
            required
            minLength={8}
            type="password"
            autoComplete="new-password"
            value={password.new_password}
            onChange={(event) =>
              setPassword({ ...password, new_password: event.target.value })
            }
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
            value={password.confirm_password}
            onChange={(event) =>
              setPassword({ ...password, confirm_password: event.target.value })
            }
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5"
          />
        </label>
        <button
          disabled={busy === "password"}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          <KeyRound size={16} />
          {busy === "password" ? "验证并保存中…" : "验证并修改密码"}
        </button>
      </form>
      {(message || error) && (
        <p
          role="alert"
          className={`xl:col-span-2 rounded-lg px-4 py-3 text-sm ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}
        >
          {error || message}
        </p>
      )}
    </div>
  );
}
