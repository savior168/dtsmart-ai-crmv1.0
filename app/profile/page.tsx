import { requireUser } from "@/lib/auth/current-user";
import { Mail, ShieldCheck, UserCircle, Users } from "lucide-react";

export default async function ProfilePage() {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("users").select("*").eq("id", user.id).maybeSingle();
  const displayName = profile?.name || user.email || "未设置姓名";
  const email = profile?.email || user.email || "未设置邮箱";
  const role = profile?.role || "未设置角色";

  return (
    <main className="min-h-screen p-5 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs uppercase tracking-[.22em] text-indigo-400">Profile</p>
        <h1 className="mt-2 text-3xl font-semibold">我的</h1>
        <p className="mt-2 text-sm text-slate-400">查看当前登录账号、角色权限和部门信息。</p>

        <section className="mt-7 grid gap-5 lg:grid-cols-[320px_1fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[.035] p-6 text-center">
            <div className="mx-auto grid h-24 w-24 place-items-center rounded-3xl bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/30">
              <UserCircle size={52} />
            </div>
            <h2 className="mt-5 text-xl font-semibold">{displayName}</h2>
            <p className="mt-1 text-sm text-slate-400">{email}</p>
            <span className="mt-4 inline-flex rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs text-indigo-200">{role}</span>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[.035] p-6">
            <h2 className="text-lg font-semibold">账号信息</h2>
            <div className="mt-5 grid gap-4">
              <div className="flex items-center gap-3 rounded-xl border border-white/10 p-4">
                <UserCircle className="text-indigo-300" size={20} />
                <div><p className="text-xs text-slate-500">姓名</p><p className="mt-1">{displayName}</p></div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-white/10 p-4">
                <Mail className="text-cyan-300" size={20} />
                <div><p className="text-xs text-slate-500">邮箱</p><p className="mt-1">{email}</p></div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-white/10 p-4">
                <ShieldCheck className="text-emerald-300" size={20} />
                <div><p className="text-xs text-slate-500">角色</p><p className="mt-1">{role}</p></div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-white/10 p-4">
                <Users className="text-amber-300" size={20} />
                <div><p className="text-xs text-slate-500">部门ID</p><p className="mt-1">{profile?.department_id || "未分配部门"}</p></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
