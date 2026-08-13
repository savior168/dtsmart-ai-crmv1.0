import { requireUser } from "@/lib/auth/current-user";
import { Bot, Database, Globe2, ShieldCheck } from "lucide-react";

const runtimeItems = [
  ["前端框架", "Next.js App Router + TypeScript + Tailwind CSS"],
  ["部署方式", "Vercel Production"],
  ["数据库", "Supabase PostgreSQL"],
  ["AI服务", "OpenAI API"],
];

export default async function SettingsPage() {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();

  return (
    <main className="min-h-screen p-5 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs uppercase tracking-[.22em] text-indigo-400">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold">设置</h1>
        <p className="mt-2 text-sm text-slate-400">查看生产环境、权限、安全和系统运行状态。</p>

        <section className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[.035] p-5"><Database className="text-cyan-300" /><p className="mt-4 text-sm text-slate-400">Supabase</p><p className="mt-1 font-semibold">已配置</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[.035] p-5"><Bot className="text-indigo-300" /><p className="mt-4 text-sm text-slate-400">OpenAI</p><p className="mt-1 font-semibold">生产环境变量控制</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[.035] p-5"><ShieldCheck className="text-emerald-300" /><p className="mt-4 text-sm text-slate-400">当前角色</p><p className="mt-1 font-semibold">{profile?.role || "未设置角色"}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[.035] p-5"><Globe2 className="text-amber-300" /><p className="mt-4 text-sm text-slate-400">公网部署</p><p className="mt-1 font-semibold">Vercel</p></div>
        </section>

        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[.035] p-6">
          <h2 className="text-lg font-semibold">系统运行状态</h2>
          <div className="mt-5 divide-y divide-white/10 rounded-xl border border-white/10">
            {runtimeItems.map(([label, value]) => (
              <div key={label} className="grid gap-2 p-4 text-sm md:grid-cols-[180px_1fr]">
                <span className="text-slate-500">{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[.035] p-6">
          <h2 className="text-lg font-semibold">生产环境变量</h2>
          <div className="mt-4 grid gap-3 text-sm text-slate-300">
            {["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"].map((item) => (
              <div key={item} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">{item}</div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">SUPABASE_SERVICE_ROLE_KEY 仅允许服务端使用，禁止添加 NEXT_PUBLIC_ 前缀。</p>
        </section>
      </div>
    </main>
  );
}
