"use client";
import Link from "next/link";
import { CalendarClock, Check, ChevronDown, Globe2, Plus, Search, ShieldCheck, Target, WalletCards, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { ACQUISITION_COMMON_INDUSTRIES, ACQUISITION_COUNTRIES, ACQUISITION_INDUSTRY_TERMS } from "@/lib/ai-acquisition/config";
import {
  PageHeader,
  button,
  input,
  panel,
  primaryButton,
  useToast,
} from "@/components/ai-screening/ui";
import { AppDialog, DialogActions } from "@/components/ui/app-dialog";

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
      <div className="min-h-11 rounded-lg border border-slate-200 bg-white p-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
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
      <p className="mb-2 text-xs text-slate-500">{normalized ? "匹配的标准行业" : "当前账号常用行业（快捷选择，不限制可获客行业）"}</p>
      <div className="flex flex-wrap gap-2">
        {(normalized ? options : [...ACQUISITION_COMMON_INDUSTRIES]).map((item)=>{const checked=value.includes(item);return <button key={item} type="button" disabled={!checked&&value.length>=8} aria-pressed={checked} onClick={()=>toggle(item)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition disabled:opacity-40 ${checked?"border-blue-500 bg-blue-50 font-medium text-blue-700":"border-slate-200 bg-white text-slate-600 hover:border-blue-300"}`}>{checked?<Check size={13}/>:<Plus size={13}/>} {item}</button>})}
        {canAddCustom?<button type="button" onClick={addCustom} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-blue-400 bg-blue-50/40 px-3 text-sm font-medium text-blue-700"><Plus size={14}/>添加“{normalized}”</button>:null}
      </div>
      {normalized && !options.length && !canAddCustom ? <p className="mt-2 text-xs text-slate-400">行业名称需为2–60个字符，且最多选择8个。</p> : null}
    </div>
  </div>;
}

const DRAFT_KEY = "dtsmart-ai-acquisition-create:v3";

export function AcquisitionCreateView() {
  const router = useRouter();
  const { toast, node } = useToast();
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    name_mode: "AUTO" as "AUTO" | "MANUAL",
    industries: [] as string[],
    countries: [] as string[],
    keywords: [] as string[],
    cost_mode: "ADAPTIVE",
    task_cost_limit_usd: 5,
    schedule_type: "now" as "now" | "scheduled",
    scheduled_at: "",
  });
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
        task_cost_limit_usd: typeof saved.task_cost_limit_usd === "number" ? saved.task_cost_limit_usd : current.task_cost_limit_usd,
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
    (form.cost_mode === "ADAPTIVE" && form.task_cost_limit_usd <= 0);
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
        description="设置目标市场、行业与成本边界；系统自动发现、早停排除、核验补证、去重，并只将通过质量门槛的客户送入客户公海。"
        actions={
          <Link href="/ai-acquisition" className={button}>
            返回任务中心
          </Link>
        }
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className={`${panel} overflow-visible`}>
        <div className="border-b border-slate-100 p-5">
          <div className="mb-4 flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700"><Globe2 size={18}/></span><div><h2 className="font-semibold">1. 任务与目标市场</h2><p className="mt-1 text-xs leading-5 text-slate-500">每个任务最多选择8个国家/地区，便于控制检索范围、执行时间和费用追溯。</p></div></div>
          <div className="grid gap-4 lg:grid-cols-2"><label>
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
          </div><div className="lg:col-span-2"><span className="mb-1.5 block text-sm font-medium">执行时间</span><div className="flex flex-wrap items-center gap-2"><div className="inline-flex rounded-lg border border-[#dfe5ee] bg-[#f7f9fc] p-1"><button type="button" onClick={()=>setForm({...form,schedule_type:"now",scheduled_at:""})} className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${form.schedule_type==="now"?"bg-white text-[#1763e8] shadow-sm":"text-[#657187] hover:text-[#334158]"}`}>立即执行</button><button type="button" onClick={()=>setForm({...form,schedule_type:"scheduled"})} className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${form.schedule_type==="scheduled"?"bg-white text-[#1763e8] shadow-sm":"text-[#657187] hover:text-[#334158]"}`}><CalendarClock size={15}/>预约执行</button></div>{form.schedule_type==="scheduled"?<label className="relative min-w-[240px] flex-1"><CalendarClock className="absolute left-3 top-[11px] text-slate-400" size={16}/><input type="datetime-local" aria-label="预约执行时间" className={`${input} w-full pl-10`} value={form.scheduled_at} onChange={(event)=>setForm({...form,scheduled_at:event.target.value})} min={new Date(Date.now()+60000).toISOString().slice(0,16)}/></label>:<span className="text-sm text-[#778397]">任务创建后立即进入队列执行</span>}</div></div></div>
        </div>
        <div className="border-b border-slate-100 p-5">
          <div className="mb-4 flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700"><Target size={18}/></span><div className="min-w-0 flex-1"><h2 className="font-semibold">2. 目标客户条件</h2><p className="mt-1 text-xs leading-5 text-slate-500">可选择或输入任意行业，常用行业仅用于快捷选择。多选表示匹配其中任一行业；系统仍会逐家核验真实业务，不会因关键词命中直接判定为目标客户。</p></div></div>
          <IndustryPicker value={form.industries} onChange={(industries) => setForm({ ...form, industries })}/>
          <div className="mt-4">
          <ChipInput
            label="补充业务关键词"
            values={form.keywords}
            onChange={(keywords) => setForm({ ...form, keywords })}
            placeholder="选填。用于增加更具体的检索表达；目标行业始终是核验硬门槛，关键词不会单独放宽行业范围。"
          />
          </div>
        </div>
        <section className="p-5">
          <div className="mb-4 flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><WalletCards size={18}/></span><div><h2 className="font-semibold">3. AI获客模式</h2><p className="mt-1 text-xs leading-5 text-slate-500">两种模式执行相同的行业、主体、在营、联系方式来源和系统去重校验；区别在于证据不足时是否允许在预算内继续付费补证。</p></div></div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[
              {
                id: "ADAPTIVE",
                title: "智能增强获客",
                text: "先执行全部免费发现与核验；仅当候选与目标行业高度相关、主体无冲突但缺少关键证据时，才在单任务费用上限内调用付费能力继续补证。",
                points: ["默认模式，优先消耗可用免费额度", "非目标候选提前停止，避免无效费用", "达到证据门槛或预算上限立即停止"],
                recommended: true,
              },
              {
                id: "FREE_ONLY",
                title: "全免费获客",
                text: "使用企业官网、公开页面及系统可核对的 Google Places 各 SKU 免费额度；一旦需要产生正金额费用立即停止该付费路径。证据不足的候选保留在任务明细，不进入客户公海。",
                points: ["只允许实际金额为0的调用", "免费证据足够即完成并停止", "不因免费模式降低入池质量门槛"],
                recommended: false,
              },
            ].map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setForm({ ...form, cost_mode: m.id })}
                aria-pressed={form.cost_mode === m.id}
                className={`rounded-lg border p-4 text-left transition ${form.cost_mode === m.id ? "border-blue-500 bg-blue-50/40 ring-2 ring-blue-100" : "border-slate-200 bg-white hover:border-blue-300"}`}
              >
                <span className="flex items-center gap-2"><b>{m.title}</b>{m.recommended ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">推荐</span> : null}</span>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {m.text}
                </p>
                <ul className="mt-3 space-y-1.5 text-xs leading-5 text-slate-500">{m.points.map((point)=><li key={point} className="flex gap-2"><Check size={13} className="mt-1 shrink-0 text-emerald-600"/><span>{point}</span></li>)}</ul>
              </button>
            ))}
          </div>
          {form.cost_mode === "ADAPTIVE" ? (
            <label className="mt-4 block max-w-xs">
              <span className="mb-1.5 block text-sm font-medium">
                单任务费用上限（USD）
              </span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={`${input} w-full`}
                value={form.task_cost_limit_usd}
                onChange={(e) =>
                  setForm({
                    ...form,
                    task_cost_limit_usd: Number(e.target.value),
                  })
                }
              />
            </label>
          ) : null}
          <p className="mt-3 text-xs leading-5 text-slate-500">
            创建前不展示伪精确耗时或费用。实际调用、免费/计费状态、SKU、价格快照和来源会在任务详情逐项留痕。
          </p>
        </section>
      </section>
      <aside className={`${panel} p-5 xl:sticky xl:top-5`}><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-emerald-600"/><h2 className="font-semibold">任务确认</h2></div><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-slate-500">目标国家/地区</dt><dd className="mt-1 leading-6">{form.countries.length ? form.countries.map((code)=>COUNTRY_NAMES.of(code)||code).join("、") : "尚未选择"}</dd></div><div><dt className="text-xs text-slate-500">目标行业</dt><dd className="mt-1 leading-6">{form.industries.length ? form.industries.join("、") : "尚未选择"}</dd></div><div><dt className="text-xs text-slate-500">执行时间</dt><dd className="mt-1">{form.schedule_type==="scheduled"&&form.scheduled_at?new Date(form.scheduled_at).toLocaleString("zh-CN",{hour12:false}):"创建后立即执行"}</dd></div><div><dt className="text-xs text-slate-500">成本模式</dt><dd className="mt-1">{form.cost_mode==="FREE_ONLY"?"全免费获客":`智能增强 · 上限 $${Number(form.task_cost_limit_usd||0).toFixed(2)}`}</dd></div></dl><div className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">非目标、永久停业、证据不足、无可追溯有效联系方式或系统重复的候选均不会进入客户公海。</div>{invalid?<p className="mt-4 text-xs leading-5 text-amber-700">请完整填写任务名称、行业、国家/地区和有效执行时间。</p>:null}<div className="mt-5 grid gap-2"><button type="button" disabled={invalid} onClick={()=>setConfirm(true)} className={`${primaryButton} w-full`}>{form.schedule_type==="scheduled"?"预约并创建任务":"创建并自动执行"}</button><Link href="/ai-acquisition" className={`${button} w-full`}>取消</Link></div></aside>
      </div>
      {node}
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
              : `智能增强，上限 $${form.task_cost_limit_usd.toFixed(2)}`}
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
