import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { ArrowRight, ArrowUpRight, CheckCircle2, Database, Globe2, ScanSearch, ShieldCheck, Sparkles } from "lucide-react";
import { PasswordAuthForm } from "@/components/password-auth-form";

export const metadata: Metadata = {
  title: "登录与注册",
  description: "智客云AI客户分析与管理系统",
};

export default function LoginPage() {
  return (
    <main className="tradeos-auth-shell min-h-screen overflow-hidden bg-[#071226] text-slate-950">
      <div className="tradeos-auth-orb tradeos-auth-orb-one" />
      <div className="tradeos-auth-orb tradeos-auth-orb-two" />
      <div className="tradeos-auth-grid" />
      <svg className="tradeos-auth-network" viewBox="0 0 920 820" fill="none" aria-hidden="true">
        <g className="tradeos-auth-network-lines" stroke="url(#network-gradient)" strokeWidth="1.25">
          <path d="M35 612C155 566 203 466 318 453S501 510 604 402 715 185 886 146" />
          <path d="M61 218C194 251 237 332 350 318S512 202 629 258 746 432 887 476" />
          <path d="M166 748C251 653 331 634 415 655S575 734 683 636 761 531 892 558" />
          <path d="M311 70C350 184 412 247 510 281S681 313 755 390" />
        </g>
        <g className="tradeos-auth-network-nodes">
          {[[35,612],[318,453],[604,402],[886,146],[61,218],[350,318],[629,258],[887,476],[166,748],[415,655],[683,636],[892,558],[311,70],[510,281],[755,390]].map(([cx,cy],index)=><circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={index%4===0?6:4} />)}
        </g>
        <defs><linearGradient id="network-gradient" x1="44" y1="140" x2="866" y2="680" gradientUnits="userSpaceOnUse"><stop stopColor="#38BDF8" stopOpacity=".08"/><stop offset=".48" stopColor="#60A5FA" stopOpacity=".72"/><stop offset="1" stopColor="#A78BFA" stopOpacity=".12"/></linearGradient></defs>
      </svg>
      <div className="relative z-10 grid min-h-screen lg:grid-cols-[minmax(0,1.08fr)_minmax(500px,0.92fr)]">
        <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden px-9 py-8 text-white lg:flex xl:px-14 xl:py-10 2xl:px-16">
            <div className="tradeos-auth-brand flex items-center gap-3">
            <Image src="/zhikeyun-logo.svg" width={48} height={48} priority alt="智客云" className="h-12 w-12 rounded-2xl shadow-2xl shadow-blue-500/25" />
            <div><p className="text-[19px] font-bold tracking-tight">智客云</p><p className="text-sm text-blue-100/65">AI 客户分析与销售转化平台</p></div>
          </div>

          <div className="max-w-[700px] py-7">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-3.5 py-1.5 text-[13px] font-medium text-cyan-50 backdrop-blur-xl"><Sparkles size={15} className="text-cyan-300" />AI 驱动的全球精准获客引擎<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_12px_#6ee7b7]" /></div>
            <h1 className="max-w-[700px] text-[46px] font-bold leading-[1.12] tracking-[-0.045em] xl:text-[56px]">AI精准获客<br /><span className="bg-gradient-to-r from-cyan-300 via-blue-200 to-violet-300 bg-clip-text text-transparent">让全球潜客更快进入销售跟进</span></h1>
            <p className="mt-5 max-w-[640px] text-[16px] leading-7 text-blue-100/72 xl:text-[17px]">AI 自动发现潜在企业，逐项核验主体、业务与联系方式；全程记录来源、进度和费用，让销售拿到清晰、可核验、可行动的客户数据。</p>

            <div className="mt-6 flex max-w-[650px] items-center gap-1.5 overflow-hidden rounded-xl border border-white/10 bg-slate-950/20 px-3 py-2.5 backdrop-blur-xl">
              {['全球发现','主体核验','AI精准筛选','进入销售跟进'].map((step,index)=><span key={step} className="contents"><span className="tradeos-auth-step whitespace-nowrap rounded-lg bg-white/[0.07] px-2.5 py-1.5 text-xs font-medium text-blue-50">{step}</span>{index<3?<ArrowRight size={14} className="shrink-0 text-cyan-300/70"/>:null}</span>)}
            </div>

            <div className="mt-5 grid max-w-[650px] grid-cols-3 gap-2.5">
              <Feature icon={Globe2} title="增量智能获客" text="跨国家与行业持续发现新客户" />
              <Feature icon={ScanSearch} title="证据级AI筛选" text="来源可点击，结论可复核" />
              <Feature icon={Database} title="销售闭环转化" text="入池、认领、跟进全程留痕" />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/[0.08] pt-4 text-xs text-blue-100/50"><span>© 2026 智客云 · 智能获客 &amp; 精准筛选</span><span className="flex items-center gap-1.5"><ShieldCheck size={13} className="text-emerald-300"/>企业级权限、费用与数据审计 <ArrowUpRight size={12} /></span></div>
        </section>

        <section className="flex min-h-screen items-center justify-center bg-white/96 px-4 py-8 backdrop-blur-3xl sm:px-8 lg:bg-white/95 xl:px-14">
          <div className="w-full max-w-[560px]">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <Image src="/zhikeyun-logo.svg" width={44} height={44} priority alt="智客云" className="h-11 w-11 rounded-xl" />
              <div><p className="font-bold text-slate-950">智客云</p><p className="text-xs text-slate-500">智能获客 &amp; 精准筛选</p></div>
            </div>
            <div className="mb-7">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-600"><CheckCircle2 size={16} />安全访问企业工作台</p>
              <h2 className="text-3xl font-bold tracking-[-0.03em] text-slate-950 sm:text-4xl">欢迎使用智客云</h2>
              <p className="mt-3 text-[15px] leading-6 text-slate-500">选择适合您的方式登录，或创建一个新的企业账号。</p>
            </div>
            <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-slate-100" />}><PasswordAuthForm /></Suspense>
          </div>
        </section>
      </div>
    </main>
  );
}

function Feature({ icon: Icon, title, text }: { icon: typeof Globe2; title: string; text: string }) {
  return <div className="tradeos-auth-feature group rounded-xl border border-white/[0.09] bg-white/[0.065] p-3.5 backdrop-blur-xl"><span className="mb-3 grid h-8 w-8 place-items-center rounded-lg border border-cyan-200/10 bg-cyan-300/[0.08] text-cyan-200 shadow-[inset_0_0_18px_rgba(56,189,248,.06)]"><Icon size={17} /></span><p className="text-[13px] font-semibold text-white">{title}</p><p className="mt-1 text-[11px] leading-4 text-blue-100/52">{text}</p></div>;
}
