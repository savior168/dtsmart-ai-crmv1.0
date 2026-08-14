"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Bot,
  CalendarDays,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Handshake,
  Info,
  LoaderCircle,
  Mail,
  MessageSquareText,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";

type GradeRow = { grade: string; count: number; percentage: number };
type FunnelRow = { label: string; value: number; percentage: number };
type CountryRow = { name: string; count: number; percentage: number };
type ProtectionRow = { id: string; customer_id: string; customer_name: string; country: string | null; expires_at: string; days: number };
type FollowupRow = { id: string; customer_id: string; customer_name: string; country: string | null; ai_level: string | null; last_followup: string | null; followup_time: string | null; type: string; status: string };
type ActivityRow = { id: string; action: string; text: string; created_at: string };
type DashboardData = {
  range: { from: string; to: string };
  filters: { countries: string[] };
  totals: { my_customers: number; pending_ai: number; grade_a: number; today_followups: number; expiring_protection: number; quotes: number; deals: number; target_customers: number };
  distribution: GradeRow[];
  funnel: FunnelRow[];
  country_top: CountryRow[];
  protections: ProtectionRow[];
  followups: FollowupRow[];
  activities: ActivityRow[];
};

const panelClass = "rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]";
const gradeColors: Record<string, string> = { A: "#20c56b", B: "#2f80ed", C: "#8358ed", D: "#f5a623" };
const statusLabels: Record<string, string> = { UNCLAIMED: "待跟进", CLAIMED: "待开发", FOLLOWING: "跟进中", QUOTE: "报价中", DEAL: "已成交", RELEASED: "已释放" };
const typeLabels: Record<string, string> = { EMAIL: "邮件", WHATSAPP: "WhatsApp", PHONE: "电话", LINKEDIN: "LinkedIn", OTHER: "其他" };

function localDate(value: Date) {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function number(value: number) { return new Intl.NumberFormat("zh-CN").format(value); }

function countryFlag(country?: string | null) {
  if (!country) return "🌐";
  const code = country.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) return String.fromCodePoint(...Array.from(code).map((letter) => 127397 + letter.charCodeAt(0)));
  const aliases: Record<string, string> = { 美国: "🇺🇸", 印度: "🇮🇳", 巴西: "🇧🇷", 英国: "🇬🇧", 墨西哥: "🇲🇽", 俄罗斯: "🇷🇺", 西班牙: "🇪🇸", 阿联酋: "🇦🇪", 德国: "🇩🇪", 法国: "🇫🇷" };
  return aliases[country] || "🌐";
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  if (seconds < 172800) return "昨天";
  return new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function donutGradient(rows: GradeRow[]) {
  const total = rows.reduce((sum, item) => sum + item.count, 0);
  if (!total) return "conic-gradient(#e2e8f0 0 100%)";
  let cursor = 0;
  return `conic-gradient(${rows.map((item) => { const start = cursor; cursor += (item.count / total) * 100; return `${gradeColors[item.grade] || "#94a3b8"} ${start}% ${cursor}%`; }).join(",")})`;
}

function DashboardHeader({ title, href }: { title: string; href: string }) {
  return <div className="flex h-12 items-center justify-between px-4"><h3 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">{title}<Info size={14} className="text-slate-400" /></h3><Link href={href} className="text-xs font-medium text-blue-600 hover:text-blue-700">查看详情</Link></div>;
}

export function CrmDashboard() {
  const now = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => localDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(() => localDate(now));
  const [country, setCountry] = useState("");
  const [aiLevel, setAiLevel] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ from, to, country, ai_level: aiLevel });
    try {
      const response = await fetch(`/api/dashboard/stats?${params}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "工作台数据加载失败");
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "工作台数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [aiLevel, country, from, to]);

  useEffect(() => { void load(); }, [load]);

  function reset() {
    setFrom(localDate(new Date(now.getFullYear(), now.getMonth(), 1)));
    setTo(localDate(now)); setCountry(""); setAiLevel("");
  }

  function exportData() {
    if (!data) return;
    const rows = [["指标", "数量"], ["我的客户", data.totals.my_customers], ["待AI筛选", data.totals.pending_ai], ["A级客户", data.totals.grade_a], ["今日待跟进", data.totals.today_followups], ["即将到期保护", data.totals.expiring_protection], ["报价中", data.totals.quotes], ["已成交", data.totals.deals]];
    const csv = "\uFEFF" + rows.map((row) => row.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `DTSmart工作台_${from}_${to}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  const cards = data ? [
    { label: "我的客户", value: data.totals.my_customers, href: "/customers", icon: UsersRound, color: "text-blue-600", background: "bg-blue-50", trend: "+0", trendColor: "text-blue-600" },
    { label: "待AI筛选", value: data.totals.pending_ai, href: "/ai-screening", icon: Bot, color: "text-violet-600", background: "bg-violet-50", trend: "0", trendColor: "text-emerald-600" },
    { label: "A级客户", value: data.totals.grade_a, href: "/customers?ai_level=A", icon: Sparkles, color: "text-emerald-600", background: "bg-emerald-50", trend: "+0", trendColor: "text-blue-600" },
    { label: "今日待跟进", value: data.totals.today_followups, href: "/followups", icon: CheckSquare2, color: "text-orange-600", background: "bg-orange-50", trend: "+0", trendColor: "text-orange-600" },
    { label: "即将到期保护", value: data.totals.expiring_protection, href: "/followups", icon: ShieldCheck, color: "text-amber-500", background: "bg-amber-50", trend: "7天内到期", trendColor: "text-amber-600" },
    { label: "报价中", value: data.totals.quotes, href: "/customers?status=QUOTE", icon: FileText, color: "text-sky-600", background: "bg-sky-50", trend: "+0", trendColor: "text-blue-600" },
    { label: "已成交", value: data.totals.deals, href: "/customers?status=DEAL", icon: Handshake, color: "text-emerald-600", background: "bg-emerald-50", trend: "+0", trendColor: "text-emerald-600" },
  ] : [];

  return (
    <main className="dashboard-page min-h-[calc(100vh-64px)] bg-[#f8fafc] px-4 py-4 xl:px-5">
      <div className="mx-auto max-w-[1660px]">
        <section className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm shadow-sm"><input aria-label="开始日期" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="w-[132px] border-0 bg-transparent outline-none" /><span className="px-2 text-slate-400">~</span><input aria-label="结束日期" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="w-[132px] border-0 bg-transparent outline-none" /></label>
          <select aria-label="国家筛选" value={country} onChange={(event) => setCountry(event.target.value)} className="h-10 min-w-32 rounded-lg border border-slate-200 bg-white px-4 text-sm shadow-sm"><option value="">全部国家</option>{data?.filters.countries.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select aria-label="AI等级筛选" value={aiLevel} onChange={(event) => setAiLevel(event.target.value)} className="h-10 min-w-40 rounded-lg border border-slate-200 bg-white px-4 text-sm shadow-sm"><option value="">全部AI等级</option>{["A", "B", "C", "D"].map((item) => <option key={item} value={item}>{item}级</option>)}</select>
          <div className="ml-auto flex items-center gap-3"><button type="button" onClick={reset} className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-500 bg-white px-5 text-sm font-medium text-blue-600 transition hover:bg-blue-50"><RefreshCw size={16} />重置</button><button type="button" disabled={!data} onClick={exportData} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"><Download size={16} />导出数据</button></div>
        </section>

        {error ? <section className={`${panelClass} grid min-h-56 place-items-center p-8 text-center`}><div><BellRing className="mx-auto text-rose-500" /><p className="mt-3 text-sm text-rose-700">{error}</p><button type="button" onClick={() => void load()} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">重新加载</button></div></section> : loading && !data ? <section className={`${panelClass} grid min-h-[520px] place-items-center`}><div className="text-center text-sm text-slate-500"><LoaderCircle className="mx-auto animate-spin text-blue-600" /><p className="mt-3">正在加载工作台数据…</p></div></section> : data ? <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
            {cards.map((card) => { const Icon = card.icon; return <Link key={card.label} href={card.href} className={`${panelClass} group relative min-h-[110px] overflow-hidden p-4 transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md`}><ChevronRight size={16} className="absolute right-3 top-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" /><div className="flex items-center gap-3"><span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${card.background} ${card.color}`}><Icon size={28} strokeWidth={1.9} /></span><div className="min-w-0"><p className="truncate text-[13px] text-slate-600">{card.label}</p><strong className="mt-0.5 block text-[25px] leading-8 tracking-tight text-slate-950">{number(card.value)}</strong></div></div><p className="mt-2 text-center text-xs text-slate-500">{card.label === "即将到期保护" ? "" : "较上周 "}<span className={`font-medium ${card.trendColor}`}>{card.trend}</span></p></Link>; })}
          </section>

          <section className="mt-4 grid gap-3 xl:grid-cols-[1.12fr_1.05fr_.88fr_1fr]">
            <article className={`${panelClass} min-h-[290px]`}><DashboardHeader title="AI等级分布" href="/reports" /><div className="flex items-center justify-center gap-7 px-4 pb-5 pt-2"><div className="grid h-[168px] w-[168px] shrink-0 place-items-center rounded-full" style={{ background: donutGradient(data.distribution) }}><div className="grid h-[90px] w-[90px] place-items-center rounded-full bg-white text-center"><span><small className="block text-xs text-slate-500">总客户数</small><b className="mt-1 block text-xl">{number(data.totals.my_customers)}</b></span></div></div><div className="min-w-[170px] space-y-3">{data.distribution.map((item) => <div key={item.grade} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs"><i className="h-2.5 w-2.5 rounded-full" style={{ background: gradeColors[item.grade] }} /><span className="text-slate-600">{item.grade}级（{item.grade === "A" ? "高潜力" : item.grade === "B" ? "有潜力" : item.grade === "C" ? "待观察" : "低潜力"}）</span><b className="whitespace-nowrap font-medium">{number(item.count)}（{item.percentage}%）</b></div>)}</div></div></article>
            <article className={`${panelClass} min-h-[290px]`}><DashboardHeader title="销售漏斗" href="/reports" /><div className="space-y-1 px-5 pb-4 pt-1">{data.funnel.map((item, index) => <div key={item.label} className="flex items-center gap-3"><div className="h-[38px] text-center text-xs font-medium leading-[38px] text-white" style={{ width: `${100 - index * 12}%`, marginInline: "auto", background: ["#2563eb", "#2498e9", "#21b8c5", "#45c994", "#f4b51f"][index], clipPath: "polygon(5% 0,95% 0,88% 100%,12% 100%)" }}>{item.label}</div><span className="w-[92px] shrink-0 text-right text-[11px] text-slate-600"><b className="font-medium text-slate-900">{number(item.value)}</b>（{item.percentage}%）</span></div>)}</div></article>
            <article className={`${panelClass} min-h-[290px]`}><DashboardHeader title="国家分布TOP10" href="/reports" /><div className="space-y-2 px-4 pb-4">{data.country_top.length ? data.country_top.map((item) => <div key={item.name} className="grid grid-cols-[78px_1fr_78px] items-center gap-2 text-xs"><span className="truncate text-slate-700"><i className="mr-1 not-italic">{countryFlag(item.name)}</i>{item.name}</span><span className="h-1.5 overflow-hidden rounded-full bg-slate-100"><i className="block h-full rounded-full bg-blue-600" style={{ width: `${Math.max(3, item.percentage)}%` }} /></span><span className="text-right text-slate-500">{number(item.count)}（{item.percentage}%）</span></div>) : <div className="grid h-48 place-items-center text-sm text-slate-400">暂无国家分布数据</div>}</div></article>
            <article className={`${panelClass} min-h-[290px]`}><div className="flex h-12 items-center justify-between px-4"><h3 className="flex items-center gap-2 text-[15px] font-semibold">保护到期提醒<Info size={14} className="text-slate-400" /></h3><Link href="/followups" className="text-xs font-medium text-blue-600">查看全部</Link></div><div className="divide-y divide-slate-100 px-4">{data.protections.length ? data.protections.map((item) => <Link key={item.id} href={`/customers/${item.customer_id}`} className="flex items-center justify-between gap-3 py-2 text-xs hover:text-blue-700"><span className="min-w-0"><b className="block truncate font-medium text-slate-700">{item.customer_name}</b><span className="mt-1 block text-slate-500">{countryFlag(item.country)} {item.country || "未知地区"}</span></span><span className="shrink-0 text-right"><b className="block text-red-500">{item.days} 天后到期</b><time className="mt-1 block text-slate-500">{new Date(item.expires_at).toLocaleDateString("zh-CN")}</time></span></Link>) : <div className="grid h-48 place-items-center text-sm text-slate-400"><div className="text-center"><ShieldCheck className="mx-auto mb-2 text-slate-300" /><p>7天内没有保护到期客户</p></div></div>}</div></article>
          </section>

          <section className="mt-4 grid gap-3 xl:grid-cols-[1.12fr_1fr]">
            <article className={`${panelClass} min-h-[310px] overflow-hidden`}><div className="flex h-12 items-center justify-between px-4"><h3 className="text-[15px] font-semibold">今日待跟进（{data.totals.today_followups}）</h3><Link href="/followups" className="text-xs font-medium text-blue-600">查看全部</Link></div><div className="overflow-x-auto"><table className="w-full min-w-[690px] text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr><th className="px-4 py-2.5 font-medium">客户名称</th><th className="px-2 py-2.5 font-medium">国家</th><th className="px-2 py-2.5 font-medium">AI等级</th><th className="px-2 py-2.5 font-medium">上次跟进</th><th className="px-2 py-2.5 font-medium">跟进时间</th><th className="px-2 py-2.5 font-medium">跟进方式</th><th className="px-2 py-2.5 font-medium">状态</th><th className="px-3 py-2.5 font-medium">操作</th></tr></thead><tbody>{data.followups.length ? data.followups.map((item) => <tr key={item.id} className="border-t border-slate-100 hover:bg-blue-50/40"><td className="max-w-40 truncate px-4 py-2.5 font-medium">{item.customer_name}</td><td className="px-2 py-2.5">{countryFlag(item.country)} {item.country || "-"}</td><td className="px-2 py-2.5"><span className="rounded bg-emerald-50 px-1.5 py-1 font-semibold text-emerald-600">{item.ai_level || "-"}</span></td><td className="px-2 py-2.5 text-slate-500">{item.last_followup ? new Date(item.last_followup).toLocaleDateString("zh-CN") : "未跟进"}</td><td className="px-2 py-2.5 font-medium text-orange-600">{item.followup_time ? new Date(item.followup_time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "-"}</td><td className="px-2 py-2.5">{typeLabels[item.type] || item.type}</td><td className="px-2 py-2.5"><span className="rounded bg-orange-50 px-2 py-1 text-orange-600">{statusLabels[item.status] || item.status}</span></td><td className="px-3 py-2.5"><div className="flex gap-2 text-blue-600"><a href={`tel:${item.customer_name}`} aria-label="电话跟进"><Phone size={15} /></a><Link href={`/customers/${item.customer_id}`} aria-label="邮件跟进"><Mail size={15} /></Link><Link href={`/customers/${item.customer_id}`} aria-label="编辑跟进"><MessageSquareText size={15} /></Link></div></td></tr>) : <tr><td colSpan={8} className="h-[175px] text-center text-slate-400">今天没有待跟进任务</td></tr>}</tbody></table></div><footer className="flex h-12 items-center justify-between border-t border-slate-100 px-4 text-xs text-slate-500"><span>共 {data.totals.today_followups} 条</span><div className="flex items-center gap-1"><button type="button" disabled className="grid h-8 w-8 place-items-center rounded border border-slate-200 disabled:opacity-40"><ChevronLeft size={15} /></button><button type="button" className="h-8 min-w-8 rounded bg-blue-600 px-2 text-white">1</button><button type="button" disabled className="grid h-8 w-8 place-items-center rounded border border-slate-200 disabled:opacity-40"><ChevronRight size={15} /></button><select aria-label="每页条数" className="ml-2 h-8 rounded border border-slate-200 px-2"><option>5条/页</option></select></div></footer></article>
            <article className={`${panelClass} min-h-[310px]`}><div className="flex h-12 items-center justify-between px-4"><h3 className="text-[15px] font-semibold">最近动态</h3><Link href="/customers" className="text-xs font-medium text-blue-600">查看全部</Link></div><div className="space-y-0 px-4">{data.activities.length ? data.activities.map((item, index) => { const Icon = item.action.includes("AI") ? Sparkles : item.action.includes("FOLLOWUP") ? UsersRound : item.action.includes("STAGE") ? FileText : index % 2 ? CalendarDays : UserRoundPlus; const colors = item.action.includes("AI") ? "bg-violet-500" : item.action.includes("FOLLOWUP") ? "bg-emerald-500" : item.action.includes("STAGE") ? "bg-orange-500" : "bg-blue-500"; return <div key={item.id} className="flex items-center gap-3 py-3 text-xs"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-white ${colors}`}><Icon size={15} /></span><p className="min-w-0 flex-1 text-slate-700">{item.text}</p><time className="shrink-0 text-slate-400">{relativeTime(item.created_at)}</time></div>; }) : <div className="grid h-52 place-items-center text-sm text-slate-400"><div className="text-center"><MessageSquareText className="mx-auto mb-2 text-slate-300" /><p>暂无最近动态</p></div></div>}</div></article>
          </section>
        </> : null}
      </div>
    </main>
  );
}
