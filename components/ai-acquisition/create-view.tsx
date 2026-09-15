"use client";
import Link from "next/link";
import { Check, ChevronDown, Plus, Search, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { ACQUISITION_COMMON_INDUSTRIES, ACQUISITION_COUNTRIES, ACQUISITION_INDUSTRY_TERMS, acquisitionKeywordRecommendations } from "@/lib/ai-acquisition/config";
import {
  PageHeader,
  button,
  input,
  panel,
  primaryButton,
  useToast,
} from "@/components/ai-screening/ui";
import { AppDialog, DialogActions } from "@/components/ui/app-dialog";
import { ScheduleControl } from "@/components/ai-screening/schedule-control";

const COUNTRY_NAMES = new Intl.DisplayNames(["zh-CN"], { type: "region" });

function CountryPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);
  const options = ACQUISITION_COUNTRIES.filter((c) =>
    `${c} ${COUNTRY_NAMES.of(c)}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(!open)}
        className={`${input} flex w-full items-center justify-between text-left`}
      >
        <span className="truncate">
          {value.length
            ? `已选 ${value.length} 个国家/地区`
            : "请选择1至8个国家/地区"}
        </span>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="absolute z-40 mt-1 w-[min(32rem,calc(100vw-3rem))] max-w-full rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <label className="relative block">
            <Search
              size={15}
              className="absolute left-3 top-2.5 text-slate-400"
            />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-full rounded-lg border pl-9 pr-3 text-sm outline-none focus:border-blue-400"
              placeholder="搜索国家/地区"
            />
          </label>
          {value.length ? <div className="mt-2 flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2"><span className="mr-1 text-xs text-slate-500">已选 {value.length}/8</span>{value.map((code)=><button key={code} type="button" aria-label={`移除${COUNTRY_NAMES.of(code) || code}`} onClick={()=>onChange(value.filter((item)=>item!==code))} className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700">{COUNTRY_NAMES.of(code) || code}<X size={11}/></button>)}<button type="button" onClick={()=>onChange([])} className="ml-auto text-xs text-slate-500 hover:text-blue-700">清空</button></div> : null}
          <div role="listbox" aria-multiselectable="true" className="mt-2 grid max-h-64 grid-cols-1 overflow-auto sm:grid-cols-2">
            {options.map((c) => {
              const checked = value.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  disabled={!checked && value.length >= 8}
                  onClick={() =>
                    onChange(
                      checked ? value.filter((x) => x !== c) : [...value, c],
                    )
                  }
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm disabled:opacity-40 ${checked ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50"}`}
                >
                  <span>
                    {COUNTRY_NAMES.of(c)} <small>{c}</small>
                  </span>
                  {checked ? <Check size={14} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChipInput({
  label,
  values,
  onChange,
  required = false,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  required?: boolean;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (
      v &&
      !values.some((x) => x.toLowerCase() === v.toLowerCase()) &&
      values.length < 8
    )
      onChange([...values, v]);
    setDraft("");
  };
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required ? <b className="text-rose-500"> *</b> : null}
      </span>
      <div className="min-h-11 rounded-lg border border-slate-200 bg-white p-1.5 transition focus-within:border-[#1763e8]">
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700"
            >
              {v}
              <button
                type="button"
                aria-label={`移除${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
            placeholder={values.length ? "继续输入" : "输入后按回车"}
            className="min-w-36 flex-1 px-1 py-1 text-sm outline-none"
          />
        </div>
      </div>
      <small className="mt-1 block text-slate-400">{placeholder}</small>
    </label>
  );
}

function IndustryPicker({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim();
  const options = Object.keys(ACQUISITION_INDUSTRY_TERMS).filter((item) => item.toLowerCase().includes(normalized.toLowerCase())).slice(0, 12);
  const canAddCustom = normalized.length >= 2 && normalized.length <= 60 && !value.some((item) => item.toLowerCase() === normalized.toLowerCase()) && !options.includes(normalized) && value.length < 8;
  const toggle = (item: string) => {
    if (value.includes(item)) onChange(value.filter((selected) => selected !== item));
    else if (value.length < 8) onChange([...value, item]);
  };
  const addCustom = () => {
    if (!canAddCustom) return;
    onChange([...value, normalized]);
    setQuery("");
  };
  return <div className="space-y-3">
    <label className="relative block">
      <Search size={16} className="absolute left-3 top-3 text-slate-400"/>
      <input value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"){event.preventDefault();addCustom();}}} className={`${input} w-full pl-9`} placeholder="搜索标准行业，或输入任意明确行业后按回车添加" maxLength={60}/>
    </label>
    {value.length ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3"><span className="text-xs font-medium text-slate-500">已选 {value.length}/8</span>{value.map((item)=><button key={item} type="button" aria-label={`移除${item}`} onClick={()=>toggle(item)} className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-sm text-blue-700 shadow-sm ring-1 ring-blue-100">{item}<X size={13}/></button>)}<button type="button" onClick={()=>onChange([])} className="ml-auto text-xs text-slate-500 hover:text-blue-700">清空</button></div>:null}
    <div>
      {normalized ? <p className="mb-2 text-xs text-slate-500">匹配的标准行业</p> : null}
      <div className="flex flex-wrap gap-2">
        {(normalized ? options : [...ACQUISITION_COMMON_INDUSTRIES]).map((item)=>{const checked=value.includes(item);return <button key={item} type="button" disabled={!checked&&value.length>=8} aria-pressed={checked} onClick={()=>toggle(item)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition disabled:opacity-40 ${checked?"border-blue-500 bg-blue-50 font-medium text-blue-700":"border-slate-200 bg-white text-slate-600 hover:border-blue-300"}`}>{checked?<Check size={13}/>:<Plus size={13}/>} {item}</button>})}
        {canAddCustom?<button type="button" onClick={addCustom} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-blue-400 bg-blue-50/40 px-3 text-sm font-medium text-blue-700"><Plus size={14}/>添加“{normalized}”</button>:null}
      </div>
      {normalized && !options.length && !canAddCustom ? <p className="mt-2 text-xs text-slate-400">行业名称需为2–60个字符，且最多选择8个。</p> : null}
    </div>
  </div>;
}

const DRAFT_KEY = "dtsmart-ai-acquisition-create:v4";

export function AcquisitionCreateView() {
  const router = useRouter();
  const { toast, node } = useToast();
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [flowOpen, setFlowOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    name_mode: "AUTO" as "AUTO" | "MANUAL",
    industries: [] as string[],
    countries: [] as string[],
    keywords: [] as string[],
    cost_mode: "ADAPTIVE",
    task_cost_limit_usd: "",
    schedule_type: "now" as "now" | "scheduled",
    scheduled_at: "",
  });
  const keywordRecommendations = acquisitionKeywordRecommendations(form.industries);
  const requestKeyRef = useRef(crypto.randomUUID());
  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || "null") as Partial<typeof form> | null;
      if (!saved) return;
      setForm((current)=>({
        ...current,
        name: typeof saved.name === "string" ? saved.name : current.name,
        name_mode: saved.name_mode === "MANUAL" ? "MANUAL" : "AUTO",
        industries: Array.isArray(saved.industries) ? saved.industries : [],
        countries: Array.isArray(saved.countries) ? saved.countries : [],
        keywords: Array.isArray(saved.keywords) ? saved.keywords : [],
        cost_mode: saved.cost_mode === "FREE_ONLY" ? "FREE_ONLY" : "ADAPTIVE",
        task_cost_limit_usd: typeof saved.task_cost_limit_usd === "string" ? saved.task_cost_limit_usd : current.task_cost_limit_usd,
        schedule_type: saved.schedule_type === "scheduled" ? "scheduled" : "now",
        scheduled_at: typeof saved.scheduled_at === "string" ? saved.scheduled_at : "",
      }));
    } catch { window.sessionStorage.removeItem(DRAFT_KEY); }
  }, []);
  const automaticName = (() => {
    const country = form.countries.length === 1 ? COUNTRY_NAMES.of(form.countries[0]) || form.countries[0] : form.countries.length > 1 ? `${COUNTRY_NAMES.of(form.countries[0]) || form.countries[0]}等${form.countries.length}国` : "";
    const industry = form.industries.length === 1 ? form.industries[0] : form.industries.length > 1 ? `${form.industries[0]}等${form.industries.length}行业` : "";
    return [country, industry, form.cost_mode === "FREE_ONLY" ? "全免费获客" : "智能增强获客"].filter(Boolean).join("｜").slice(0, 100);
  })();
  useEffect(() => {
    if (form.name_mode !== "AUTO" || form.name === automaticName) return;
    setForm((current)=>current.name_mode === "AUTO" ? {...current,name:automaticName} : current);
  }, [automaticName, form.name, form.name_mode]);
  useEffect(() => { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form)); }, [form]);
  const invalid =
    !form.name.trim() ||
    !form.industries.length ||
    !form.countries.length ||
    (form.schedule_type === "scheduled" && (!form.scheduled_at || new Date(form.scheduled_at).getTime() <= Date.now())) ||
    (form.cost_mode === "ADAPTIVE" && form.task_cost_limit_usd !== "" && Number(form.task_cost_limit_usd) <= 0);
  async function submit() {
    setBusy(true);
    try {
      const r = await fetch("/api/ai-acquisition/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          scheduled_at: form.schedule_type === "scheduled" ? new Date(form.scheduled_at).toISOString() : null,
          request_key: requestKeyRef.current,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "创建失败");
      window.sessionStorage.removeItem(DRAFT_KEY);
      router.push(`/ai-acquisition/tasks/${b.task.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "创建失败", "error");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
      <PageHeader
        title="创建AI获客任务"
        description="设置目标市场、行业、执行时间和获客模式。"
        actions={
          <Link href="/ai-acquisition" className={button}>返回任务中心</Link>
        }
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <section className={`${panel} overflow-visible`}>
          <div className="border-b border-[#e8ecf2] px-4 py-[14px]"><h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-[#1763e8] text-sm text-white">1</span>任务与目标市场</h2><p className="ml-[38px] mt-1 text-sm text-[#778397]">设置任务名称、目标国家和执行时间。</p></div>
          <div className="grid gap-3 p-4 lg:grid-cols-2"><label>
            <span className="mb-1.5 block text-sm font-medium">任务名称 <b className="text-rose-500">*</b></span>
            <input
              className={`${input} w-full`}
              value={form.name}
              maxLength={100}
              onChange={(e) => setForm({ ...form, name: e.target.value, name_mode: "MANUAL" })}
              placeholder="选择国家、行业和模式后自动生成"
            />
            <span className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-400"><span>系统自动生成，您可以修改。</span>{form.name_mode === "MANUAL" ? <button type="button" onClick={()=>setForm({...form,name_mode:"AUTO",name:automaticName})} className="text-blue-700 hover:underline">恢复自动名称</button>:null}</span>
          </label><div><span className="mb-1.5 block text-sm font-medium">目标国家/地区 <b className="text-rose-500">*</b></span>
            <CountryPicker
              value={form.countries}
              onChange={(countries) => setForm({ ...form, countries })}
            />
          </div><div className="lg:col-span-2"><span className="mb-1.5 block text-sm font-medium">执行时间</span><ScheduleControl scheduleType={form.schedule_type} scheduledAt={form.scheduled_at} onScheduleTypeChange={(schedule_type)=>setForm((current)=>({...current,schedule_type}))} onScheduledAtChange={(scheduled_at)=>setForm((current)=>({...current,scheduled_at}))}/></div></div>
        </section>
        <section className={`${panel} overflow-visible`}>
          <div className="border-b border-[#e8ecf2] px-4 py-[14px]"><h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-[#1763e8] text-sm text-white">2</span>目标客户条件</h2><p className="ml-[38px] mt-1 text-sm text-[#778397]">行业可多选或自定义；系统按任一目标行业匹配，并逐家核验真实业务。</p></div>
          <div className="p-4">
          <IndustryPicker value={form.industries} onChange={(industries) => setForm({ ...form, industries })}/>
          <div className="mt-4">
          <ChipInput
            label="补充业务关键词"
            values={form.keywords}
            onChange={(keywords) => setForm({ ...form, keywords })}
            placeholder="选填。用于增加更具体的检索表达；目标行业始终是核验硬门槛，关键词不会单独放宽行业范围。"
          />
          {keywordRecommendations.length ? <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3"><div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-xs font-medium text-slate-500">行业推荐关键词</span>{keywordRecommendations.map((keyword)=>{const selected=form.keywords.includes(keyword);return <button key={keyword} type="button" aria-pressed={selected} disabled={!selected&&form.keywords.length>=8} onClick={()=>setForm((current)=>({...current,keywords:selected?current.keywords.filter((item)=>item!==keyword):[...current.keywords,keyword]}))} className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs transition disabled:opacity-40 ${selected?"border-blue-400 bg-blue-50 font-medium text-blue-700":"border-slate-200 bg-white text-slate-600 hover:border-blue-300"}`}>{selected?<Check size={12}/>:<Plus size={12}/>} {keyword}</button>})}</div><p className="mt-2 text-xs text-slate-400">按所选行业即时推荐，按需选择；执行时会与目标国家的本地化行业表达组合，也可在上方手动补充。</p></div>:null}
          </div>
          </div>
        </section>
        <section className={panel}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e8ecf2] px-4 py-[14px]"><div><h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-[#1763e8] text-sm text-white">3</span>AI获客模式</h2><p className="ml-[38px] mt-1 text-sm text-[#778397]">质量门槛相同，仅付费补证权限不同。</p></div><button type="button" onClick={()=>setFlowOpen(true)} className={`${button} h-8 px-3 text-xs`}>查看获客规则</button></div>
          <div className="p-4"><div className="grid gap-[14px] md:grid-cols-2">
            {[
              {
                id: "ADAPTIVE",
                title: "智能增强获客",
                text: "免费渠道优先；必要时在费用限制内付费补证。",
                summary: "免费优先 · 按需增强",
                recommended: true,
              },
              {
                id: "FREE_ONLY",
                title: "全免费获客",
                text: "仅使用实际费用为 0 的渠道，质量门槛不降低。",
                summary: "零付费调用 · 同等质量门槛",
                recommended: false,
              },
            ].map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setForm({ ...form, cost_mode: m.id })}
                aria-pressed={form.cost_mode === m.id}
                className={`relative rounded-xl border p-[18px] text-left transition ${form.cost_mode === m.id ? "border-[#1763e8] shadow-[0_0_0_2px_#e7efff]" : "border-[#dfe5ee] hover:border-blue-300"}`}
              >
                <span className="flex items-center gap-2"><b>{m.title}</b>{m.recommended ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">推荐</span> : null}</span>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {m.text}
                </p>
                <span className="mt-3 inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500">{m.summary}</span>
              </button>
            ))}
          </div>
          {form.cost_mode === "ADAPTIVE" ? (
            <div className="mt-4 max-w-xl">
            <label className="block max-w-xs">
              <span className="mb-1.5 block text-sm font-medium">
                单任务费用上限（USD，可选）
              </span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={`${input} w-full`}
                value={form.task_cost_limit_usd}
                placeholder="留空则仅按全局上限执行"
                onChange={(e) =>
                  setForm({
                    ...form,
                    task_cost_limit_usd: e.target.value,
                  })
                }
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-slate-500">留空遵循“AI获客设置”；所有费用限制以先触发者为准。</p>
            </div>
          ) : null}</div>
        </section>
      </div>
      <aside className={`${panel} p-5 xl:sticky xl:top-5`}><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-emerald-600"/><h2 className="font-semibold">任务确认</h2></div><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-slate-500">目标国家/地区</dt><dd className="mt-1 leading-6">{form.countries.length ? form.countries.map((code)=>COUNTRY_NAMES.of(code)||code).join("、") : "尚未选择"}</dd></div><div><dt className="text-xs text-slate-500">目标行业</dt><dd className="mt-1 leading-6">{form.industries.length ? form.industries.join("、") : "尚未选择"}</dd></div><div><dt className="text-xs text-slate-500">执行时间</dt><dd className="mt-1">{form.schedule_type==="scheduled"&&form.scheduled_at?new Date(form.scheduled_at).toLocaleString("zh-CN",{hour12:false}):"创建后立即执行"}</dd></div><div><dt className="text-xs text-slate-500">成本模式</dt><dd className="mt-1">{form.cost_mode==="FREE_ONLY"?"全免费获客":form.task_cost_limit_usd?`智能增强 · 任务上限 $${Number(form.task_cost_limit_usd).toFixed(2)}`:"智能增强 · 遵循全局费用限制"}</dd></div></dl><div className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">非目标、永久停业、证据不足、无可追溯有效联系方式或系统重复的候选均不会进入客户公海。</div>{invalid?<p className="mt-4 text-xs leading-5 text-amber-700">请完整填写任务名称、行业、国家/地区和有效执行时间。</p>:null}<div className="mt-5 grid gap-2"><button type="button" disabled={invalid} onClick={()=>setConfirm(true)} className={`${primaryButton} w-full`}>{form.schedule_type==="scheduled"?"预约并创建任务":"创建并自动执行"}</button><Link href="/ai-acquisition" className={`${button} w-full`}>取消</Link></div></aside>
      </div>
      {node}
      <AppDialog
        open={flowOpen}
        title="AI获客规则与底层执行链路"
        description="查看说明不会离开创建页，当前已填写的任务内容会完整保留。"
        onClose={()=>setFlowOpen(false)}
        width="max-w-4xl"
      >
        <div className="space-y-4 text-sm text-slate-600">
          <ol className="grid gap-3 md:grid-cols-2">
            {[
              ["1. 固定任务范围","根据国家/地区、目标行业和补充关键词生成有限任务快照；关键词按目标国家常用语言扩展，但不能绕过行业门槛。"],
              ["2. 低成本发现","优先使用公开来源和可核对免费额度，按本地化检索表达发现商家；连续分页无新候选即提前结束。"],
              ["3. 前置早停","Google 商家永久停业、基础类别明显不相关或系统已有相同 Place ID 的候选立即停止，不继续产生补证费用。"],
              ["4. 主体与在营核验","交叉核对名称、地址、电话、官网域名、Google 商家和公开页面，主体冲突或缺少当前在营依据不进入公海。"],
              ["5. 按需补证","只对行业高度相关但缺少关键证据的候选继续采集官网、地图和社媒公开信息；智能增强模式才允许在费用边界内调用付费能力。"],
              ["6. 联系方式核验","电话、邮箱和 WhatsApp 必须保存发现该联系方式的具体页面；列表可直接打开来源核验，WhatsApp 另可直达对话。"],
              ["7. AI评分与准入","基于已核验事实形成行业、等级、评分和理由；行业、主体、在营、证据、有效联系方式任一门槛不通过都不进入客户公海。"],
              ["8. 全局去重入池","按 Place ID、规范化电话、邮箱、WhatsApp 等强身份与现有客户、历史获客结果去重，只把新的合格客户送入待认领公海。"],
            ].map(([title,text])=><li key={title} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"><b className="text-slate-800">{title}</b><p className="mt-1.5 leading-6">{text}</p></li>)}
          </ol>
          <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-4"><h3 className="font-semibold text-blue-900">暂停、恢复、重试与完成</h3><p className="mt-1.5 leading-6 text-blue-800">暂停在安全节点停止新调用，恢复应从最近成功检查点继续；失败重试只处理未完成步骤，不重复已入账调用和已处理客户。有限检索计划执行完且全部候选完成判定后自动结束；用户取消、异常失败和费用受限会分别留痕。</p></section>
          <section className="rounded-xl border border-amber-100 bg-amber-50/60 p-4"><h3 className="font-semibold text-amber-900">费用、耗时与质量边界</h3><p className="mt-1.5 leading-6 text-amber-800">智能增强任务同时受付费渠道开关、单任务费用上限、每日/每周/每月上限及单客户调用次数限制，任一限制先触发即停止付费调用；全免费模式只允许实际金额为 0 的调用。创建前不展示无法保证准确的耗时或费用预估，任务详情会记录具体来源页、判断依据、API SKU、免费/计费状态、实际费用和有效执行耗时。系统通过多来源交叉验证降低误判，但公开数据可能变化，因此保留人工核对入口，不作绝对无误承诺。</p></section>
          <section className="rounded-xl border border-violet-100 bg-violet-50/50 p-4"><h3 className="font-semibold text-violet-900">候选进入AI筛选后的底层核验</h3><p className="mt-1.5 leading-6 text-violet-800">候选先规范化名称、地址、电话、邮箱域名、官网和 Place ID，再按“官网与关键子页 → 免费公开来源 → 必要时 Google 主体候选 → 已核验社媒”的顺序采集。确定性规则先判断明确经营事实；仅在主体通过且证据确有歧义时，模型才综合已采集证据。最后执行证据门控、评分一致性校准、联系方式具体来源校验和原子写回；抓取失败、主体冲突或证据不足不会被伪造成有效或无效结论。</p></section>
        </div>
      </AppDialog>
      <AppDialog
        open={confirm}
        title="确认创建AI获客任务"
        description="系统只会把通过行业、主体、在营、证据、有效联系方式和去重校验的企业送入客户公海。证据不足的候选保留在任务明细，不会交给销售员。"
        onClose={() => !busy && setConfirm(false)}
        width="max-w-lg"
      >
        <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6">
          <b>{form.name}</b>
          <p>行业：{form.industries.join("、")}</p><p>国家/地区：{form.countries.map((code)=>COUNTRY_NAMES.of(code)||code).join("、")}</p>
          <p>执行：{form.schedule_type==="scheduled"&&form.scheduled_at?new Date(form.scheduled_at).toLocaleString("zh-CN",{hour12:false}):"立即执行"}</p>
          <p>
            模式：
            {form.cost_mode === "FREE_ONLY"
              ? "全免费获客"
              : form.task_cost_limit_usd
                ? `智能增强，任务上限 $${Number(form.task_cost_limit_usd).toFixed(2)}`
                : "智能增强，遵循AI获客全局费用限制"}
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogActions
            busy={busy}
            onCancel={() => setConfirm(false)}
            confirmLabel="确认创建"
          />
        </form>
      </AppDialog>
    </div></main>
  );
}
