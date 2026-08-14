import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { ArrowUpRight, BarChart3, CheckCircle2, Globe2, ShieldCheck, Sparkles } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "登录与注册 | DTSmart TradeOS",
  description: "DTSmart TradeOS 企业获客与销售转化平台",
};

export default function LoginPage() {
  return (
    <main className="tradeos-auth-shell min-h-screen overflow-hidden bg-[#071226] text-slate-950">
      <div className="tradeos-auth-orb tradeos-auth-orb-one" />
      <div className="tradeos-auth-orb tradeos-auth-orb-two" />
      <div className="tradeos-auth-grid" />
      <div className="relative z-10 grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(520px,0.9fr)]">
        <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden px-10 py-9 text-white lg:flex xl:px-16 xl:py-12">
          <div className="flex items-center gap-3">
            <Image src="/dtsmart-tradeos-logo.png" width={48} height={48} priority alt="DTSmart TradeOS" className="h-12 w-12 rounded-2xl object-cover shadow-2xl shadow-orange-500/20" />
            <div><p className="text-[19px] font-bold tracking-tight">DTSmart TradeOS</p><p className="text-sm text-blue-100/70">精准识客 &amp; 高效转化</p></div>
          </div>

          <div className="max-w-2xl pb-8">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-blue-50 backdrop-blur-xl"><Sparkles size={16} className="text-amber-300" />AI 驱动的企业获客工作台</div>
            <h1 className="text-5xl font-bold leading-[1.14] tracking-[-0.04em] xl:text-6xl">让每一条客户数据<br /><span className="bg-gradient-to-r from-sky-300 via-blue-200 to-violet-300 bg-clip-text text-transparent">更快转化为生意</span></h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-blue-100/75">从客户导入、AI 深度筛选到销售跟进，DTSmart TradeOS 将获客流程集中在一个安全、清晰、高效的企业平台。</p>

            <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
              <Feature icon={Globe2} title="全球客户洞察" text="多维数据识别" />
              <Feature icon={BarChart3} title="智能销售管理" text="全链路可视化" />
              <Feature icon={ShieldCheck} title="企业级安全" text="权限与数据隔离" />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-blue-100/55"><span>© 2026 DTSmart TradeOS</span><span className="flex items-center gap-1">企业数据安全中心 <ArrowUpRight size={13} /></span></div>
        </section>

        <section className="flex min-h-screen items-center justify-center bg-white/96 px-4 py-8 backdrop-blur-3xl sm:px-8 lg:bg-white/95 xl:px-14">
          <div className="w-full max-w-[560px]">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <Image src="/dtsmart-tradeos-logo.png" width={44} height={44} priority alt="DTSmart TradeOS" className="h-11 w-11 rounded-xl object-cover" />
              <div><p className="font-bold text-slate-950">DTSmart TradeOS</p><p className="text-xs text-slate-500">精准识客 &amp; 高效转化</p></div>
            </div>
            <div className="mb-7">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-600"><CheckCircle2 size={16} />安全访问企业工作台</p>
              <h2 className="text-3xl font-bold tracking-[-0.03em] text-slate-950 sm:text-4xl">欢迎使用 DTSmart</h2>
              <p className="mt-3 text-[15px] leading-6 text-slate-500">选择适合您的方式登录，或创建一个新的企业账号。</p>
            </div>
            <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-slate-100" />}><LoginForm /></Suspense>
          </div>
        </section>
      </div>
    </main>
  );
}

function Feature({ icon: Icon, title, text }: { icon: typeof Globe2; title: string; text: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.08] p-4 backdrop-blur-xl"><span className="mb-4 grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-sky-200"><Icon size={19} /></span><p className="text-sm font-semibold text-white">{title}</p><p className="mt-1 text-xs text-blue-100/55">{text}</p></div>;
}
