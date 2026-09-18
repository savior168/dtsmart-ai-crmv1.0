"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import {
  BellRing,
  Bot,
  CalendarDays,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
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
  UploadCloud,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { CompactDateRange } from "@/components/ui/compact-date-range";
import { UserScopeSelect } from "@/components/user-scope-select";

function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}

type GradeRow = { grade: string; count: number; percentage: number };
type FunnelRow = { label: string; value: number; percentage: number };
type CountryRow = { name: string; count: number; percentage: number };
type ProtectionRow = { id: string; customer_id: string; customer_name: string; country: string | null; expires_at: string; days: number };
type FollowupRow = { id: string; customer_id: string; customer_name: string; phone: string | null; email: string | null; country: string | null; ai_level: string | null; last_followup: string | null; followup_time: string | null; type: string; status: string; protection_days: number | null };
type ActivityRow = { id: string; action: string; text: string; created_at: string };
type DashboardData = {
  range: { from: string; to: string };
  filters: { countries: string[] };
  totals: { my_customers: number; pending_ai: number; valid_customers: number; intentions: number; today_followups: number; expiring_protection: number; quotes: number; deals: number };
  distribution: GradeRow[];
  funnel: FunnelRow[];
  country_top: CountryRow[];
  protections: ProtectionRow[];
  followups: FollowupRow[];
  activities: ActivityRow[];
};

const panelClass = "rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]";
const gradeColors: Record<string, string> = { A: "#20c56b", B: "#2f80ed", C: "#8358ed", D: "#f5a623", 未筛选: "#cbd5e1" };
const statusLabels: Record<string, string> = { UNCLAIMED: "待认领", CLAIMED: "潜在客户", FOLLOWING: "意向客户", QUOTE: "报价中", DEAL: "已成交", RELEASED: "无效客户" };
const typeLabels: Record<string, string> = { EMAIL: "邮件", WHATSAPP: "whatsapp", PHONE: "电话", LINKEDIN: "LinkedIn", OTHER: "其他" };
const regionNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const countryAliases: Record<string, string> = {
  美国: "US", "UNITED STATES": "US", USA: "US",
  印度: "IN", INDIA: "IN",
  巴西: "BR", BRAZIL: "BR",
  英国: "GB", "UNITED KINGDOM": "GB", UK: "GB",
  墨西哥: "MX", MEXICO: "MX",
  俄罗斯: "RU", RUSSIA: "RU",
  西班牙: "ES", SPAIN: "ES",
  阿联酋: "AE", UAE: "AE", "UNITED ARAB EMIRATES": "AE",
  德国: "DE", GERMANY: "DE",
  法国: "FR", FRANCE: "FR",
  意大利: "IT", ITALY: "IT",
  爱尔兰: "IE", IRELAND: "IE",
  挪威: "NO", NORWAY: "NO",
  厄瓜多尔: "EC", ECUADOR: "EC",
};

function localDate(value: Date) {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function number(value: number) { return new Intl.NumberFormat("zh-CN").format(value); }

function countryInfo(country?: string | null) {
  const raw = country?.trim() || "";
  const upper = raw.toUpperCase();
  const code = /^[A-Z]{2}$/.test(upper) ? upper : countryAliases[upper] || countryAliases[raw] || "";
  return { code, name: code ? regionNames.of(code) || raw : raw || "未知地区" };
}

function CountryFlag({ code, name }: { code: string; name: string }) {
  if (!code) return <span aria-hidden="true" className="grid h-[15px] w-5 place-items-center text-xs">🌐</span>;
  return <span role="img" aria-label={`${name}国旗`} className="inline-block h-[15px] w-5 shrink-0 rounded-[2px] bg-slate-100 bg-cover bg-center shadow-[0_0_0_1px_rgba(15,23,42,.08)]" style={{ backgroundImage: `url(https://flagcdn.com/w40/${code.toLowerCase()}.png)` }} />;
}

function CountryLabel({ country }: { country?: string | null }) {
  const details = countryInfo(country);
  return <span className="inline-flex items-center gap-1.5"><CountryFlag code={details.code} name={details.name} /><span>{details.name}</span></span>;
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  if (seconds < 172800) return "昨天";
  return new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function scopedHref(path: string, scopeUserId: string, range?: { from: string; to: string }) {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  // 全部归属人必须显式传给目标页；省略参数会回退成当前登录人的客户，
  // 造成卡片数字和列表结果不一致。
  params.set("user_id", scopeUserId || "all");
  if (range) { params.set("from", range.from); params.set("to", range.to); }
  return `${pathname}?${params.toString()}`;
}

function DonutChart({ rows, total, scopeUserId, range }: { rows: GradeRow[]; total: number; scopeUserId: string; range: { from: string; to: string } }) {
  const router = useRouter();
  const hasData = rows.some((item) => item.count > 0);
  let cursor = 0;
  const gradient = hasData ? rows.map((item) => { const start = cursor; cursor += item.percentage; return `${gradeColors[item.grade] || "#94a3b8"} ${start}% ${cursor}%`; }).join(",") : "#e2e8f0 0 100%";
  function openGrade(grade: string) { router.push(scopedHref(grade === "未筛选" ? "/customers?ai_status=pending" : `/customers?ai_level=${encodeURIComponent(grade)}&ai_status=done`, scopeUserId, range)); }
  return <button type="button" onClick={() => openGrade(rows.find((item) => item.count > 0)?.grade || "未筛选")} className="relative h-[182px] w-[182px] shrink-0 rounded-full transition hover:scale-[1.02]" style={{ background: `conic-gradient(from -90deg,${gradient})` }} aria-label="AI筛选分布图，点击查看客户">
    <span className="absolute inset-[34px] rounded-full bg-white shadow-inner" />
    <span className="pointer-events-none absolute inset-0 grid place-items-center text-center"><span><small className="block text-xs text-slate-500">总客户数</small><b className="mt-1 block text-xl">{number(total)}</b></span></span>
  </button>;
}

function funnelHref(label: string, scopeUserId: string, range: { from: string; to: string }) {
  if (label === "新客户") return scopedHref("/customers?status=UNCLAIMED", scopeUserId, range);
  if (label === "潜在客户") return scopedHref("/customers?status=CLAIMED", scopeUserId, range);
  if (label === "报价中") return scopedHref("/customers?status=QUOTE", scopeUserId, range);
  if (label === "成交客户") return scopedHref("/customers?status=DEAL", scopeUserId, range);
  if (label === "无效客户") return scopedHref("/customers?status=RELEASED", scopeUserId, range);
  return scopedHref("/customers", scopeUserId, range);
}

function FunnelChart({ rows, scopeUserId, range }: { rows: FunnelRow[]; scopeUserId: string; range: { from: string; to: string } }) {
  const colors = ["#2563eb", "#2498e9", "#21b8c5", "#45c994", "#f4b51f"];
  return <div className="grid grid-cols-[minmax(180px,1fr)_88px] items-center gap-3 px-5 pb-5 pt-1">
    <div className="flex min-h-[210px] flex-col items-center justify-center" aria-label="销售漏斗图">
      {rows.map((item, index) => <Link key={item.label} href={funnelHref(item.label, scopeUserId, range)} aria-label={`查看${item.label}客户，共${item.value}条`} title={`点击查看${item.label}：${number(item.value)} 条`} className="dashboard-funnel-layer dashboard-funnel-enter grid h-[42px] place-items-center text-center text-xs font-medium text-white outline-none" style={{ width: `${100 - index * 14}%`, backgroundColor: colors[index], clipPath: "polygon(0 0,100% 0,90% 100%,10% 100%)", animationDelay: `${index * 65}ms` }}>{item.label}</Link>)}
    </div>
    <div className="flex min-h-[210px] flex-col justify-center">{rows.map((item) => <div key={item.label} className="flex h-[42px] items-center justify-end whitespace-nowrap text-[11px] text-slate-600"><b className="font-medium text-slate-900">{number(item.value)}</b>（{item.percentage}%）</div>)}</div>
  </div>;
}

function DashboardHeader({ title, href }: { title: string; href: string }) {
  return <div className="flex h-12 items-center justify-between px-4"><h3 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">{title}<Info size={14} className="text-slate-400" /></h3><Link href={href} className="text-xs font-medium text-blue-600 hover:text-blue-700">查看详情</Link></div>;
}

export function CrmDashboard() {
  const now = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => localDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(() => localDate(now));
  const [country, setCountry] = useState("");
  const [scopeUserId, setScopeUserId] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [protectionPage, setProtectionPage] = useState(1);
  const protectionPageSize = 4;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ from, to, country });
    if (scopeUserId) params.set("user_id", scopeUserId);
    try {
      const response = await fetch(`/api/dashboard/stats?${params}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "工作台数据加载失败");
      setData(body);
      setProtectionPage(1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "工作台数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [country, from, scopeUserId, to]);

  useEffect(() => { void load(); }, [load]);

  function reset() {
    setFrom(localDate(new Date(now.getFullYear(), now.getMonth(), 1)));
    setTo(localDate(now)); setCountry(""); setScopeUserId("");
  }

  const cards = data ? [
    { label: "我的客户", value: data.totals.my_customers, href: scopedHref("/customers", scopeUserId, data.range), icon: UsersRound, color: "text-blue-600", background: "bg-blue-50", trend: "当前归属人范围", trendColor: "text-blue-600" },
    { label: "待AI筛选", value: data.totals.pending_ai, href: scopedHref("/customers?ai_status=pending", scopeUserId, data.range), icon: Bot, color: "text-violet-600", background: "bg-violet-50", trend: "尚未AI评分", trendColor: "text-violet-600" },
    { label: "AI核验有效", value: data.totals.valid_customers, href: scopedHref("/customers?target=valid&ai_status=done", scopeUserId, data.range), icon: Sparkles, color: "text-emerald-600", background: "bg-emerald-50", trend: "AI判定为目标客户", trendColor: "text-emerald-600" },
    { label: "潜在客户", value: data.totals.intentions, href: scopedHref("/customers?status=CLAIMED", scopeUserId, data.range), icon: UserRoundPlus, color: "text-indigo-600", background: "bg-indigo-50", trend: "已进入销售跟进", trendColor: "text-indigo-600" },
    { label: "报价中", value: data.totals.quotes, href: scopedHref("/customers?status=QUOTE", scopeUserId, data.range), icon: FileText, color: "text-sky-600", background: "bg-sky-50", trend: "已提供报价", trendColor: "text-sky-600" },
    { label: "已成交", value: data.totals.deals, href: scopedHref("/customers?status=DEAL", scopeUserId, data.range), icon: Handshake, color: "text-emerald-600", background: "bg-emerald-50", trend: "已确认采购", trendColor: "text-emerald-600" },
    { label: "今日待跟进", value: data.totals.today_followups, href: scopedHref("/followups?scope=today", scopeUserId), icon: CheckSquare2, color: "text-orange-600", background: "bg-orange-50", trend: "今日计划任务", trendColor: "text-orange-600" },
    { label: "即将保护到期", value: data.totals.expiring_protection, href: scopedHref("/customers?tab=protection", scopeUserId), icon: ShieldCheck, color: "text-amber-500", background: "bg-amber-50", trend: "剩余 0–7 天", trendColor: "text-amber-600" },
  ] : [];
  const protectionPages = Math.max(
    1,
    Math.ceil((data?.protections.length || 0) / protectionPageSize),
  );
  const visibleProtections = data?.protections.slice(
    (protectionPage - 1) * protectionPageSize,
    protectionPage * protectionPageSize,
  ) || [];

  return (
    <main className="dashboard-page min-h-[calc(100vh-64px)] bg-[#f8fafc] px-4 py-4 xl:px-5">
      <div className="mx-auto max-w-[1660px]">
        <section className="mb-4 flex flex-wrap items-center gap-3">
          <CompactDateRange label="统计日期" from={from} to={to} onFromChange={setFrom} onToChange={setTo} className="shadow-sm"/>
          <input aria-label="国家筛选" value={country} onChange={(event) => setCountry(event.target.value)} placeholder="输入国家名称" className="h-10 w-40 rounded-lg border border-slate-200 bg-white px-4 text-sm shadow-sm" />
          <UserScopeSelect permission="dashboard.data_all" value={scopeUserId} onChange={setScopeUserId} className="h-10 min-w-52 rounded-lg border border-slate-200 bg-white px-3 text-sm shadow-sm" />
          <button type="button" onClick={reset} className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-500 bg-white px-5 text-sm font-medium text-blue-600 transition hover:bg-blue-50"><RefreshCw size={16} />重置</button>
          <span className="mx-1 hidden h-6 w-px bg-slate-200 xl:block" />
          <Link href="/import?destination=private" className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:border-blue-300 hover:text-blue-700"><UploadCloud size={16}/>导入我的客户</Link>
          <Link href="/ai-screening/new" className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:border-blue-300 hover:text-blue-700"><Sparkles size={16}/>创建AI筛选</Link>
          <Link href="/quotes/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700"><FileText size={16}/>创建报价</Link>
        </section>

        {error ? <section className={`${panelClass} grid min-h-56 place-items-center p-8 text-center`}><div><BellRing className="mx-auto text-rose-500" /><p className="mt-3 text-sm text-rose-700">{error}</p><button type="button" onClick={() => void load()} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">重新加载</button></div></section> : loading && !data ? <section className={`${panelClass} grid min-h-[520px] place-items-center`}><div className="text-center text-sm text-slate-500"><LoaderCircle className="mx-auto animate-spin text-blue-600" /><p className="mt-3">正在加载工作台数据…</p></div></section> : data ? <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
            {cards.map((card,index) => { const Icon = card.icon; return <Link key={card.label} href={card.href} style={{ animationDelay: `${index * 45}ms` }} className={`${panelClass} dashboard-reveal group relative min-h-[110px] overflow-hidden p-4 transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md`}><ChevronRight size={16} className="absolute right-3 top-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" /><div className="flex items-center gap-3"><span className={`dashboard-icon-pulse grid h-12 w-12 shrink-0 place-items-center rounded-xl ${card.background} ${card.color}`}><Icon size={28} strokeWidth={1.9} /></span><div className="min-w-0"><p className="truncate text-[13px] text-slate-600">{card.label}</p><strong className="mt-0.5 block text-[25px] leading-8 tracking-tight text-slate-950">{number(card.value)}</strong></div></div><p className={`mt-2 text-center text-xs font-medium ${card.trendColor}`}>{card.trend}</p></Link>; })}
          </section>

          <section className="mt-4 grid gap-3 xl:grid-cols-[1.12fr_1.05fr_.88fr_1fr]">
            <article className={`${panelClass} dashboard-reveal min-h-[290px]`}><DashboardHeader title="AI筛选分布" href="/reports" /><div className="flex items-center justify-center gap-6 px-4 pb-5 pt-2"><DonutChart rows={data.distribution} total={data.totals.my_customers} scopeUserId={scopeUserId} range={data.range} /><div className="min-w-[180px] space-y-1.5">{data.distribution.map((item) => { const pending = item.grade === "未筛选"; return <Link href={scopedHref(pending ? "/customers?ai_status=pending" : `/customers?ai_level=${item.grade}&ai_status=done`, scopeUserId, data.range)} key={item.grade} title={pending ? "查看待AI筛选客户" : `查看${item.grade}级客户`} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg px-2 py-2 text-xs transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-sm"><i className="h-2.5 w-2.5 rounded-full" style={{ background: gradeColors[item.grade] }} /><span className="text-slate-600">{pending ? "未筛选" : `${item.grade}级（${item.grade === "A" ? "高潜力" : item.grade === "B" ? "有潜力" : item.grade === "C" ? "待观察" : "低潜力"}）`}</span><b className="whitespace-nowrap font-medium">{number(item.count)}（{item.percentage}%）</b></Link>; })}</div></div></article>
            <article className={`${panelClass} dashboard-reveal min-h-[290px]`} style={{ animationDelay: "130ms" }}><DashboardHeader title="销售漏斗" href="/reports" /><FunnelChart rows={data.funnel} scopeUserId={scopeUserId} range={data.range} /></article>
            <article className={`${panelClass} dashboard-reveal min-h-[290px]`} style={{ animationDelay: "190ms" }}><DashboardHeader title="国家分布TOP10" href="/reports" /><div className="space-y-2 px-4 pb-4">{data.country_top.length ? data.country_top.map((item, index) => { const countryDetails = countryInfo(item.name); return <div key={item.name} title={`${countryDetails.name}：${number(item.count)} 条客户`} className="dashboard-country-row grid grid-cols-[92px_1fr_78px] items-center gap-2 text-xs" style={{ animationDelay: `${index * 48}ms` }}><span className="flex min-w-0 items-center gap-2 text-slate-700"><CountryFlag code={countryDetails.code} name={countryDetails.name} /><span className="truncate">{countryDetails.name}</span></span><span className="h-1.5 overflow-hidden rounded-full bg-slate-100"><i className="dashboard-bar-grow block h-full rounded-full bg-blue-600" style={{ width: `${Math.max(3, item.percentage)}%`, animationDelay: `${index * 48 + 50}ms` }} /></span><span className="text-right text-slate-500">{number(item.count)}（{item.percentage}%）</span></div>; }) : <div className="grid h-48 place-items-center text-sm text-slate-400">暂无国家分布数据</div>}</div></article>
            <article className={`${panelClass} dashboard-reveal flex h-[290px] min-h-0 flex-col overflow-hidden`} style={{ animationDelay: "250ms" }}><div className="flex h-12 shrink-0 items-center justify-between px-4"><h3 className="flex items-center gap-2 text-[15px] font-semibold">保护到期提醒<Info size={14} className="text-slate-400" /></h3><Link href="/customers/protection" className="text-xs font-medium text-blue-600">查看全部</Link></div><div className="min-h-0 flex-1 divide-y divide-slate-100 px-4">{data.protections.length ? visibleProtections.map((item) => <Link key={item.id} href={`/customers/${item.customer_id}`} className="flex h-[48px] items-center justify-between gap-3 text-xs hover:text-blue-700"><span className="min-w-0"><b className="block truncate font-medium text-slate-700">{item.customer_name}</b><span className="mt-0.5 block text-slate-500"><CountryLabel country={item.country} /></span></span><span className="shrink-0 text-right"><b className="block text-red-500">{item.days} 天后到期</b><time className="mt-0.5 block text-slate-500">{new Date(item.expires_at).toLocaleDateString("zh-CN")}</time></span></Link>) : <div className="grid h-full place-items-center text-sm text-slate-400"><div className="text-center"><ShieldCheck className="mx-auto mb-2 text-slate-300" /><p>7天内没有保护到期客户</p></div></div>}</div>{data.protections.length ? <footer className="flex h-[46px] shrink-0 items-center justify-between border-t border-slate-100 px-4 text-xs text-slate-500"><span>共 {data.protections.length} 条</span><div className="flex items-center gap-2"><button type="button" aria-label="上一页保护到期提醒" disabled={protectionPage <= 1} onClick={() => setProtectionPage((page) => Math.max(1, page - 1))} className="grid h-7 w-7 place-items-center rounded border border-slate-200 text-slate-600 disabled:opacity-35"><ChevronLeft size={14} /></button><span>{protectionPage} / {protectionPages}</span><button type="button" aria-label="下一页保护到期提醒" disabled={protectionPage >= protectionPages} onClick={() => setProtectionPage((page) => Math.min(protectionPages, page + 1))} className="grid h-7 w-7 place-items-center rounded border border-slate-200 text-slate-600 disabled:opacity-35"><ChevronRight size={14} /></button></div></footer> : null}</article>
          </section>

          <section className="mt-4 grid gap-3 xl:grid-cols-[1.12fr_1fr]">
            <article className={`${panelClass} dashboard-reveal min-h-[310px] overflow-hidden`} style={{ animationDelay: "300ms" }}><div className="flex h-12 items-center justify-between px-4"><h3 className="text-[15px] font-semibold">今日待跟进（{data.totals.today_followups}）</h3><Link href="/followups" className="text-xs font-medium text-blue-600">查看全部</Link></div><div className="overflow-x-auto"><table className="w-full min-w-[690px] text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr><th className="px-4 py-2.5 font-medium">客户名称</th><th className="px-2 py-2.5 font-medium">国家</th><th className="px-2 py-2.5 font-medium">AI等级</th><th className="px-2 py-2.5 font-medium">上次跟进</th><th className="px-2 py-2.5 font-medium">跟进时间</th><th className="px-2 py-2.5 font-medium">跟进方式</th><th className="px-2 py-2.5 font-medium">状态</th><th className="px-3 py-2.5 font-medium">操作</th></tr></thead><tbody>{data.followups.length ? data.followups.map((item) => <tr key={item.id} className="border-t border-slate-100 hover:bg-blue-50/40"><td className="max-w-40 truncate px-4 py-2.5 font-medium">{item.customer_name}</td><td className="px-2 py-2.5"><CountryLabel country={item.country} /></td><td className="px-2 py-2.5"><span className="rounded bg-emerald-50 px-1.5 py-1 font-semibold text-emerald-600">{item.ai_level || "-"}</span></td><td className="px-2 py-2.5 text-slate-500">{item.last_followup ? new Date(item.last_followup).toLocaleDateString("zh-CN") : "未跟进"}</td><td className="px-2 py-2.5 font-medium text-orange-600">{item.followup_time ? new Date(item.followup_time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "-"}</td><td className="px-2 py-2.5">{typeLabels[item.type] || item.type}</td><td className="px-2 py-2.5"><span className="rounded bg-orange-50 px-2 py-1 text-orange-600">{statusLabels[item.status] || item.status}</span></td><td className="px-3 py-2.5"><div className="flex gap-2 text-blue-600">{item.phone?<a href={`tel:${item.phone}`} aria-label={`拨打 ${item.phone}`} title={item.phone}><Phone size={15} /></a>:<Phone size={15} className="text-slate-300" aria-label="无可用电话"/>}{item.email?<a href={`mailto:${item.email}`} aria-label={`发送邮件给 ${item.email}`} title={item.email}><Mail size={15} /></a>:<Mail size={15} className="text-slate-300" aria-label="无可用邮箱"/>}<Link href={`/customers/${item.customer_id}`} aria-label="查看客户跟进"><MessageSquareText size={15} /></Link></div></td></tr>) : <tr><td colSpan={8} className="h-[175px] text-center text-slate-400">今天没有待跟进任务</td></tr>}</tbody></table></div><footer className="flex h-12 items-center justify-between border-t border-slate-100 px-4 text-xs text-slate-500"><span>共 {data.totals.today_followups} 条</span><div className="flex items-center gap-1"><button type="button" disabled className="grid h-8 w-8 place-items-center rounded border border-slate-200 disabled:opacity-40"><ChevronLeft size={15} /></button><button type="button" className="h-8 min-w-8 rounded bg-blue-600 px-2 text-white">1</button><button type="button" disabled className="grid h-8 w-8 place-items-center rounded border border-slate-200 disabled:opacity-40"><ChevronRight size={15} /></button><select aria-label="每页条数" className="ml-2 h-8 rounded border border-slate-200 px-2"><option>5条/页</option></select></div></footer></article>
            <article className={`${panelClass} min-h-[310px]`}><div className="flex h-12 items-center justify-between px-4"><h3 className="text-[15px] font-semibold">最近动态</h3><Link href="/customers" className="text-xs font-medium text-blue-600">查看全部</Link></div><div className="space-y-0 px-4">{data.activities.length ? data.activities.map((item, index) => { const Icon = item.action.includes("AI") ? Sparkles : item.action.includes("FOLLOWUP") ? UsersRound : item.action.includes("STAGE") ? FileText : index % 2 ? CalendarDays : UserRoundPlus; const colors = item.action.includes("AI") ? "bg-violet-500" : item.action.includes("FOLLOWUP") ? "bg-emerald-500" : item.action.includes("STAGE") ? "bg-orange-500" : "bg-blue-500"; return <div key={item.id} className="flex items-center gap-3 py-3 text-xs"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-white ${colors}`}><Icon size={15} /></span><p className="min-w-0 flex-1 text-slate-700">{item.text}</p><time className="shrink-0 text-slate-400">{relativeTime(item.created_at)}</time></div>; }) : <div className="grid h-52 place-items-center text-sm text-slate-400"><div className="text-center"><MessageSquareText className="mx-auto mb-2 text-slate-300" /><p>暂无最近动态</p></div></div>}</div></article>
          </section>
        </> : null}
      </div>
    </main>
  );
}
