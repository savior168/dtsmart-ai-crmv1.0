"use client";
import Link from "next/link";
import { Check, ChevronDown, Globe2, Search, ShieldCheck, Target, WalletCards, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { AI_INDUSTRIES } from "@/lib/types";
import { ACQUISITION_COUNTRIES } from "@/lib/ai-acquisition/config";
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
  minimumLength = 1,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  required?: boolean;
  placeholder: string;
  minimumLength?: number;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (
      v.length >= minimumLength &&
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
  const options = AI_INDUSTRIES.filter((item) => item !== "其他");
  return <div className="grid gap-2 sm:grid-cols-2">{options.map((item) => {
    const checked = value.includes(item);
    return <button key={item} type="button" aria-pressed={checked} onClick={() => onChange(checked ? value.filter((value) => value !== item) : [...value, item])} className={`flex h-11 items-center justify-between rounded-lg border px-3 text-left text-sm transition ${checked ? "border-blue-500 bg-blue-50 font-medium text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"}`}><span>{item}</span><span className={`grid size-5 place-items-center rounded-full border ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-transparent"}`}><Check size={12}/></span></button>;
  })}</div>;
}

const DRAFT_KEY = "dtsmart-ai-acquisition-create:v2";

export function AcquisitionCreateView() {
  const router = useRouter();
  const { toast, node } = useToast();
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    industries: [] as string[],
    countries: [] as string[],
    keywords: [] as string[],
    excluded_keywords: [] as string[],
    cost_mode: "FREE_ONLY",
    task_cost_limit_usd: 5,
  });
  const requestKeyRef = useRef(crypto.randomUUID());
  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || "null") as Partial<typeof form> | null;
      if (!saved) return;
      setForm((current)=>({ ...current, ...saved, industries:Array.isArray(saved.industries)?saved.industries:[], countries:Array.isArray(saved.countries)?saved.countries:[], keywords:Array.isArray(saved.keywords)?saved.keywords:[], excluded_keywords:Array.isArray(saved.excluded_keywords)?saved.excluded_keywords:[] }));
    } catch { window.sessionStorage.removeItem(DRAFT_KEY); }
  }, []);
  useEffect(() => { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form)); }, [form]);
  const invalid =
    !form.name.trim() ||
    !form.industries.length ||
    !form.countries.length ||
    (form.cost_mode === "ADAPTIVE" && form.task_cost_limit_usd <= 0);
  async function submit() {
    setBusy(true);
    try {
      const r = await fetch("/api/ai-acquisition/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, request_key: requestKeyRef.current }),
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
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：葡萄牙手机维修店获客"
            />
          </label><div><span className="mb-1.5 block text-sm font-medium">目标国家/地区 <b className="text-rose-500">*</b></span>
            <CountryPicker
              value={form.countries}
              onChange={(countries) => setForm({ ...form, countries })}
            />
          </div></div>
        </div>
        <div className="border-b border-slate-100 p-5">
          <div className="mb-4 flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700"><Target size={18}/></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">2. 目标客户条件</h2><div className="flex gap-3 text-xs"><button type="button" onClick={()=>setForm({...form,industries:AI_INDUSTRIES.filter((item)=>item!=="其他")})} className="text-blue-700 hover:underline">全选</button><button type="button" onClick={()=>setForm({...form,industries:[]})} className="text-slate-500 hover:text-blue-700">清空</button></div></div><p className="mt-1 text-xs leading-5 text-slate-500">行业为必须满足的业务范围；多选表示匹配其中任一行业，不会要求同时属于所有行业。</p></div></div>
          <IndustryPicker value={form.industries} onChange={(industries) => setForm({ ...form, industries })}/>
          <div className="mt-4">
          <ChipInput
            label="补充业务关键词"
            values={form.keywords}
            onChange={(keywords) => setForm({ ...form, keywords })}
            placeholder="选填。用于增加更具体的检索表达；目标行业始终是核验硬门槛，关键词不会单独放宽行业范围。"
          />
          </div>
          <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4"><summary className="cursor-pointer text-sm font-medium text-slate-700">高级排除条件（通常无需设置）</summary><div className="mt-4"><ChipInput label="排除关键词" values={form.excluded_keywords} onChange={(excluded_keywords) => setForm({ ...form, excluded_keywords })} minimumLength={3} placeholder="仅用于已知同名噪声，例如 training、school、job；每项至少3个字符，避免误排正常企业。"/></div></details>
        </div>
        <section className="p-5">
          <div className="mb-4 flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><WalletCards size={18}/></span><div><h2 className="font-semibold">3. 成本控制</h2><p className="mt-1 text-xs leading-5 text-slate-500">两种模式使用同一质量门槛；费用模式只决定是否允许超出可核对免费额度。</p></div></div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[
              {
                id: "FREE_ONLY",
                title: "全免费获客",
                text: "允许使用系统可核对的 Google Places 各 SKU 免费额度；任何正金额调用均由后端拦截。",
              },
              {
                id: "ADAPTIVE",
                title: "智能增强获客",
                text: "先免费发现和核验，仅对仍有潜力但证据不足的候选在单任务上限内增强补证。",
              },
            ].map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setForm({ ...form, cost_mode: m.id })}
                aria-pressed={form.cost_mode === m.id}
                className={`rounded-lg border p-4 text-left transition ${form.cost_mode === m.id ? "border-blue-500 bg-blue-50/40 ring-2 ring-blue-100" : "border-slate-200 bg-white hover:border-blue-300"}`}
              >
                <b>{m.title}</b>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {m.text}
                </p>
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
      <aside className={`${panel} p-5 xl:sticky xl:top-5`}><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-emerald-600"/><h2 className="font-semibold">任务确认</h2></div><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-slate-500">目标国家/地区</dt><dd className="mt-1 leading-6">{form.countries.length ? form.countries.map((code)=>COUNTRY_NAMES.of(code)||code).join("、") : "尚未选择"}</dd></div><div><dt className="text-xs text-slate-500">目标行业</dt><dd className="mt-1 leading-6">{form.industries.length ? form.industries.join("、") : "尚未选择"}</dd></div><div><dt className="text-xs text-slate-500">成本模式</dt><dd className="mt-1">{form.cost_mode==="FREE_ONLY"?"全免费获客":`智能增强 · 上限 $${Number(form.task_cost_limit_usd||0).toFixed(2)}`}</dd></div></dl><div className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">非目标、永久停业、证据不足、无可追溯有效联系方式或系统重复的候选均不会进入客户公海。</div>{invalid?<p className="mt-4 text-xs leading-5 text-amber-700">请先填写任务名称，并至少选择1个行业和1个国家/地区。</p>:null}<div className="mt-5 grid gap-2"><button type="button" disabled={invalid} onClick={()=>setConfirm(true)} className={`${primaryButton} w-full`}>创建并自动执行</button><Link href="/ai-acquisition" className={`${button} w-full`}>取消</Link></div></aside>
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
