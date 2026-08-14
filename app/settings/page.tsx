import { Bell, Bot, Database, Palette, ShieldCheck } from "lucide-react";
import { ProfileSettingsForm } from "@/components/profile-settings-form";
import { requireUser } from "@/lib/auth/current-user";

export default async function SettingsPage() {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("users").select("name,email,avatar_url,role").eq("id", user.id).maybeSingle();
  return <main className="p-4 lg:p-6">
    <div className="mx-auto max-w-[1500px]">
      <h2 className="text-2xl font-bold">系统设置与个人资料</h2>
      <div className="mt-4 flex gap-6 overflow-x-auto border-b text-sm">
        <span className="whitespace-nowrap border-b-2 border-blue-600 pb-3 font-medium text-blue-600">个人资料</span>
        <span className="whitespace-nowrap pb-3 text-slate-500">账户安全</span>
        <span className="whitespace-nowrap pb-3 text-slate-500">通知设置</span>
        <span className="whitespace-nowrap pb-3 text-slate-500">主题外观</span>
        <span className="whitespace-nowrap pb-3 text-slate-500">AI筛选设置</span>
        {profile?.role === "ADMIN" && <span className="whitespace-nowrap pb-3 text-slate-500">权限管理</span>}
      </div>

      <div className="mt-5">
        <ProfileSettingsForm initialName={profile?.name || user.email || ""} initialEmail={profile?.email || user.email || ""} initialAvatar={profile?.avatar_url || ""}/>
      </div>

      <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          [Database, "数据库", "Supabase PostgreSQL", "text-cyan-600 bg-cyan-50"],
          [Bot, "AI服务", "OpenAI 服务端接口", "text-violet-600 bg-violet-50"],
          [ShieldCheck, "当前角色", profile?.role || "SALES", "text-emerald-600 bg-emerald-50"],
          [Bell, "通知设置", "跟进、到期与AI任务提醒", "text-orange-600 bg-orange-50"],
        ].map(([Icon, label, value, color]) => <article key={String(label)} className="rounded-xl border bg-white p-5 shadow-sm">
          <span className={`grid h-10 w-10 place-items-center rounded-lg ${color}`}><Icon/></span>
          <small className="mt-4 block text-slate-500">{label as string}</small>
          <b className="mt-1 block">{value as string}</b>
        </article>)}
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-2">
        <article className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="text-blue-600"/>账户安全</h3>
          <div className="mt-4 space-y-3 text-sm">
            <p className="rounded-lg bg-slate-50 p-3">登录方式：邮箱 + 密码</p>
            <p className="rounded-lg bg-slate-50 p-3">修改密码需要验证当前密码并确认新密码</p>
            <p className="rounded-lg bg-emerald-50 p-3 text-emerald-700">Supabase Auth 会话保护已启用</p>
          </div>
        </article>
        <article className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 font-semibold"><Palette className="text-violet-600"/>主题外观</h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">使用顶部主题按钮切换晴空蓝、薄荷青、薰衣草紫、樱花粉和柔和米白。选择保存在当前浏览器中。</p>
        </article>
      </section>
    </div>
  </main>;
}
