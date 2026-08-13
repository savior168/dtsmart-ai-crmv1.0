import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "登录 | DTSmart AI获客CRM" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[.045] p-8 shadow-2xl shadow-black/40">
        <div className="text-xs font-semibold uppercase tracking-[.25em] text-indigo-400">DTSmart</div>
        <h1 className="mt-3 text-3xl font-semibold">登录 CRM</h1>
        <p className="mt-2 text-sm text-slate-400">使用管理员创建的企业账号继续。</p>
        <Suspense fallback={<p className="mt-7 text-sm text-slate-400">正在加载登录表单…</p>}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
