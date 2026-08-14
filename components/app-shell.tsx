/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Bot, FileSpreadsheet, LayoutDashboard, LogOut, MessageSquareText, Settings, Sparkles, UsersRound } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ThemeSwitcher } from "@/components/theme-switcher";

const menu = [
  { label: "工作台", href: "/", icon: LayoutDashboard },
  { label: "客户管理", href: "/customers", icon: UsersRound },
  { label: "数据导入", href: "/import", icon: FileSpreadsheet },
  { label: "AI筛选", href: "/ai-screening", icon: Bot },
  { label: "跟进管理", href: "/followups", icon: MessageSquareText },
  { label: "报表中心", href: "/reports", icon: BarChart3 },
  { label: "系统设置", href: "/settings", icon: Settings },
] as const;

function active(path: string, href?: string) { return href === "/" ? path === "/" : Boolean(href && (path === href || path.startsWith(`${href}/`))); }
function NavNode({ item, path, depth = 0 }: { item: any; path: string; depth?: number }) {
  const Icon = item.icon;
  return <div>{item.href ? <Link href={item.href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active(path, item.href) ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}><Icon size={17} />{item.label}</Link> : <div className="px-3 py-2 text-xs font-semibold text-slate-400">{item.label}</div>}{item.children && <div className={`${depth ? "ml-3 border-l border-slate-200 pl-1" : ""} space-y-1`}>{item.children.map((child: any) => <NavNode key={child.label} item={child} path={path} depth={depth + 1} />)}</div>}</div>;
}

function ProfileModal({ type, close, saved }: { type: "avatar" | "name" | "password"; close: () => void; saved: () => void }) {
  const [value, setValue] = useState({ avatar_url: "", name: "", old_password: "", new_password: "", confirm_password: "" });
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  function selectAvatar(file?: File) {
    setMessage("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("请选择图片文件"); return; }
    if (file.size > 1024 * 1024) { setMessage("头像文件不能超过 1MB"); return; }
    const reader = new FileReader();
    reader.onerror = () => setMessage("头像读取失败，请重新选择");
    reader.onload = () => setValue((current) => ({ ...current, avatar_url: String(reader.result || "") }));
    reader.readAsDataURL(file);
  }
  async function submit() { setBusy(true); const isPassword = type === "password"; const body = isPassword ? value : type === "avatar" ? { avatar_url: value.avatar_url } : { name: value.name }; const response = await fetch(isPassword ? "/api/users/password" : "/api/users/profile", { method: isPassword ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json().catch(() => ({})); setBusy(false); if (!response.ok) { setMessage(result.error || "保存失败"); return; } saved(); close(); }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}><section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-lg font-semibold">{type === "avatar" ? "修改头像" : type === "name" ? "修改姓名" : "修改登录密码"}</h2><div className="mt-4 space-y-3">{type === "avatar" && <><input type="file" accept="image/*" onChange={(e) => selectAvatar(e.target.files?.[0])} className="w-full rounded-xl border p-2" />{value.avatar_url && <Image unoptimized width={96} height={96} src={value.avatar_url} alt="头像预览" className="mx-auto h-24 w-24 rounded-full border object-cover" />}</>}{type === "name" && <input value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} placeholder="请输入姓名" className="w-full rounded-xl border p-2.5" />}{type === "password" && <><input type="password" value={value.old_password} onChange={(e) => setValue({ ...value, old_password: e.target.value })} placeholder="原密码" className="w-full rounded-xl border p-2.5" /><input type="password" value={value.new_password} onChange={(e) => setValue({ ...value, new_password: e.target.value })} placeholder="新密码" className="w-full rounded-xl border p-2.5" /><input type="password" value={value.confirm_password} onChange={(e) => setValue({ ...value, confirm_password: e.target.value })} placeholder="确认新密码" className="w-full rounded-xl border p-2.5" /></>}</div>{message && <p className="mt-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{message}</p>}<div className="mt-5 flex justify-end gap-2"><button onClick={close} className="rounded-xl border px-4 py-2">取消</button><button onClick={submit} disabled={busy || (type === "avatar" && !value.avatar_url)} className="rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{busy ? "保存中…" : "保存"}</button></div></section></div>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname(); const router = useRouter(); const [width, setWidth] = useState(240); const [profile, setProfile] = useState({ name: "当前用户", email: "", avatar_url: "" }); const [open, setOpen] = useState(false); const [modal, setModal] = useState<"avatar" | "name" | "password" | null>(null); const ref = useRef<HTMLDivElement>(null);
  const load = () => fetch("/api/users/me").then((r) => r.json()).then((b) => setProfile((p) => ({ ...p, ...b }))).catch(() => undefined);
  useEffect(() => { void load(); }, []); useEffect(() => { const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  if (path === "/login") return <>{children}</>;
  const title = path === "/ai-screening" ? "AI筛选" : path === "/customers" ? "客户列表" : path.startsWith("/customers/new") ? "新增客户" : path.startsWith("/customers/") ? "客户详情" : path === "/import" ? "数据导入" : path === "/reports" ? "报表中心" : path === "/followups" ? "跟进管理" : path === "/" ? "工作台" : "系统设置";
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined); localStorage.clear(); sessionStorage.clear(); router.replace("/login"); }
  return <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex"><aside style={{ width }} className="relative hidden shrink-0 border-r border-slate-200 bg-white lg:block"><div className="sticky top-0 h-screen overflow-y-auto p-5"><Link href="/" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white"><Sparkles size={20} /></span><span><b className="block text-lg">DTSmart</b><small className="text-slate-500">AI获客CRM</small></span></Link><nav className="mt-8 space-y-3">{menu.map((item) => <NavNode key={item.label} item={item} path={path} />)}</nav></div><div onMouseDown={(e) => { const x = e.clientX, initial = width; const move = (m: MouseEvent) => setWidth(Math.max(220, Math.min(360, initial + m.clientX - x))); const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); }; addEventListener("mousemove", move); addEventListener("mouseup", up); }} className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-blue-300" /></aside><div className="min-w-0 flex-1"><header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur"><div><h1 className="text-xl font-semibold">{title}</h1></div><div className="flex items-center gap-2"><ThemeSwitcher/><div ref={ref} className="relative"><button title={`欢迎您，${profile.name}`} onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-slate-50"><span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-blue-600 font-semibold text-white">{profile.avatar_url ? <Image unoptimized width={36} height={36} src={profile.avatar_url} alt="头像" className="h-full w-full object-cover" /> : (profile.name || "用").slice(0, 1)}</span><span className="hidden text-sm font-medium sm:block">{profile.name}</span></button>{open && <div className="absolute right-0 mt-3 w-56 overflow-hidden rounded-2xl border bg-white shadow-xl"><div className="border-b px-4 py-3"><b>欢迎您，{profile.name}</b><p className="mt-1 truncate text-xs text-slate-500">{profile.email}</p></div><button onClick={() => { setModal("avatar"); setOpen(false); }} className="block w-full px-4 py-3 text-left text-sm hover:bg-slate-50">修改头像</button><button onClick={() => { setModal("name"); setOpen(false); }} className="block w-full px-4 py-3 text-left text-sm hover:bg-slate-50">修改姓名</button><button onClick={() => { setModal("password"); setOpen(false); }} className="block w-full px-4 py-3 text-left text-sm hover:bg-slate-50">修改登录密码</button><button onClick={logout} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-rose-600 hover:bg-rose-50"><LogOut size={15} />退出登录</button></div>}</div></div></header><div className="min-h-[calc(100vh-65px)]">{children}</div></div>{modal && <ProfileModal type={modal} close={() => setModal(null)} saved={load} />}</div>;
}
