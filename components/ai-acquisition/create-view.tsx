"use client";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { ACQUISITION_COMMON_INDUSTRIES, ACQUISITION_COUNTRY_GROUPS, MAX_ACQUISITION_INDUSTRIES, MAX_ACQUISITION_KEYWORDS, acquisitionIndustrySuggestions, acquisitionKeywordRecommendationGroups, acquisitionKeywordRecommendations, acquisitionSearchLanguage, normalizeAcquisitionCountries, planAcquisitionSearchTerms } from "@/lib/ai-acquisition/config";
import {
  PageHeader,
  ConfirmDialog,
  button,
  input,
  panel,
  primaryButton,
  useToast,
} from "@/components/ai-screening/ui";
import { AppDialog, DialogActions } from "@/components/ui/app-dialog";
import { ScheduleControl } from "@/components/ai-screening/schedule-control";
import { CountryLabel } from "@/components/country-label";

const COUNTRY_NAMES = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const splitBulkValues = (text: string) => text.split(/[\r\n,，;；|]+/).map((item)=>item.trim()).filter(Boolean);
function mergeUniqueValues(current: string[], incoming: string[], max: number, valid: (value:string)=>boolean) {
  const next = [...current];
  for (const value of incoming) if (valid(value) && !next.some((item)=>item.toLowerCase()===value.toLowerCase()) && next.length < max) next.push(value);
  return next;
}
function CountryPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [groupKey, setGroupKey] = useState<(typeof ACQUISITION_COUNTRY_GROUPS)[number]["key"]>("EUROPE");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", close);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);
  const activeGroup =
    ACQUISITION_COUNTRY_GROUPS.find((group) => group.key === groupKey) ||
    ACQUISITION_COUNTRY_GROUPS[0];
  const normalizedQuery = q.trim().toLowerCase();
  const visibleCountryGroups = (normalizedQuery
    ? ACQUISITION_COUNTRY_GROUPS
    : [activeGroup]
  )
    .map((group) => ({
      ...group,
      countries: group.countries.filter((code) =>
        `${code} ${COUNTRY_NAMES.of(code)}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    }))
    .filter((group) => group.countries.length > 0);
  const resultCount = visibleCountryGroups.reduce(
    (total, group) => total + group.countries.length,
    0,
  );
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (open) setQ("");
          setOpen(!open);
        }}
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
        <div className="absolute z-40 mt-1 w-[min(30rem,calc(100vw-2rem))] max-w-full rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
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
          {value.length ? (
            <div className="mt-2 flex min-w-0 items-center gap-2 border-b border-slate-100 pb-2">
              <span className="shrink-0 text-xs text-slate-500">已选 {value.length}/8</span>
              <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                {value.map((code) => (
                  <button
                    key={code}
                    type="button"
                    aria-label={`移除${COUNTRY_NAMES.of(code) || code}`}
                    onClick={() => onChange(value.filter((item) => item !== code))}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700"
                  >
                    <CountryLabel value={code} className="!text-xs" />
                    <X size={11} />
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onChange([])}
                className="shrink-0 text-xs text-slate-500 hover:text-blue-700"
              >
                清空
              </button>
            </div>
          ) : null}
          <div className="mt-2 border-b border-slate-100 pb-2">
            <div className="mb-1.5 flex items-center justify-between px-1 text-xs text-slate-500">
              <span>按洲选择</span>
              <span>最多选择8个</span>
            </div>
            <div className="grid grid-cols-3 gap-1" aria-label="洲别筛选">
              {ACQUISITION_COUNTRY_GROUPS.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  aria-pressed={!normalizedQuery && groupKey === group.key}
                  onClick={() => {
                    setGroupKey(group.key);
                    setQ("");
                  }}
                  className={`flex items-center justify-center rounded-md px-2 py-1.5 text-xs transition ${
                    !normalizedQuery && groupKey === group.key
                      ? "bg-blue-600 font-medium text-white"
                      : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {group.label}
                  <span
                    className={`ml-1 ${
                      !normalizedQuery && groupKey === group.key
                        ? "text-blue-100"
                        : "text-slate-400"
                    }`}
                  >
                    {group.countries.length}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between px-1 text-xs text-slate-500">
            <span>{normalizedQuery ? "跨洲搜索结果" : `${activeGroup.label}国家/地区`}</span>
            <span>{resultCount} 个</span>
          </div>
          <div
            role="listbox"
            aria-multiselectable="true"
            className="mt-1 max-h-52 overflow-auto"
          >
            {visibleCountryGroups.map((group) => (
              <div key={group.key} className="mb-0.5 last:mb-0">
                {normalizedQuery ? (
                  <div className="sticky top-0 z-10 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                    {group.label} · {group.countries.length}
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-x-1 gap-y-0.5">
                  {group.countries.map((code) => {
                    const checked = value.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        role="option"
                        aria-selected={checked}
                        disabled={!checked && value.length >= 8}
                        onClick={() =>
                          onChange(
                            checked
                              ? value.filter((item) => item !== code)
                              : [...value, code],
                          )
                        }
                        className={`flex min-h-7 min-w-0 items-center justify-between gap-1 rounded-md px-2 py-0.5 text-left text-[13px] leading-5 disabled:opacity-40 ${
                          checked
                            ? "bg-blue-50 text-blue-700"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        <span className="truncate"><CountryLabel value={code} className="!text-xs" /></span>
                        {checked ? <Check size={14} /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {!resultCount ? (
            <p className="px-3 py-6 text-center text-sm text-slate-400">
              没有匹配的国家/地区
            </p>
          ) : null}
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
  onNotice,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  required?: boolean;
  placeholder: string;
  onNotice: (message:string, tone?:"error")=>void;
}) {
  const [draft, setDraft] = useState("");
  const addMany = (text:string) => {
    const incoming = splitBulkValues(text);
    const next = mergeUniqueValues(values, incoming, MAX_ACQUISITION_KEYWORDS, (value)=>value.length<=80);
    onChange(next);
    setDraft("");
    if (incoming.length > 1) onNotice(`已批量加入 ${next.length-values.length} 个关键词${incoming.length > next.length-values.length ? "，重复或超出上限的内容已忽略" : ""}`);
  };
  const add = () => {
    const v = draft.trim();
    if (
      v &&
      !values.some((x) => x.toLowerCase() === v.toLowerCase()) &&
      values.length < MAX_ACQUISITION_KEYWORDS
    )
      onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="block">
      <span className="mb-1.5 flex h-5 items-center justify-between gap-3 text-sm font-medium text-slate-700">
        <span>
        {label}
        {required ? <b className="text-rose-500"> *</b> : null}
        </span>
        <span className="flex items-center gap-3 text-xs font-normal"><span className={values.length>=MAX_ACQUISITION_KEYWORDS?"text-amber-700":"text-slate-500"}>已选 {values.length}/{MAX_ACQUISITION_KEYWORDS}</span>{values.length ? <button type="button" onClick={()=>onChange([])} className="text-blue-700 hover:underline">清空关键词</button> : null}</span>
      </span>
      <div className="h-11 overflow-x-auto overflow-y-hidden rounded-lg border border-slate-200 bg-white p-1.5 transition focus-within:border-[#1763e8]">
        <div className="flex min-w-max flex-nowrap gap-1.5">
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
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(event)=>{const text=event.clipboardData.getData("text");if(splitBulkValues(text).length>1){event.preventDefault();addMany(text)}}}
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
      <small className="mt-1 block text-slate-400">{placeholder} 最多 {MAX_ACQUISITION_KEYWORDS} 个；{values.length>=MAX_ACQUISITION_KEYWORDS?"已达上限，请移除或拆分任务。":`还可添加 ${MAX_ACQUISITION_KEYWORDS-values.length} 个。`}</small>
    </div>
  );
}

function IndustryPicker({ value, onChange, onNotice }: { value: string[]; onChange: (value: string[]) => void; onNotice:(message:string,tone?:"error")=>void }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [recommendationBasis, setRecommendationBasis] = useState("");
  const [relatedRecommendations, setRelatedRecommendations] = useState<string[]>([]);
  const [recentIndustries, setRecentIndustries] = useState<string[]>([]);
  const [preferenceKey, setPreferenceKey] = useState("");
  const normalized = query.trim();
  const options = normalized ? acquisitionIndustrySuggestions(normalized, MAX_ACQUISITION_INDUSTRIES) : [];
  const canAddCustom = normalized.length >= 2 && normalized.length <= 60 && !value.some((item) => item.toLowerCase() === normalized.toLowerCase()) && !options.includes(normalized) && value.length < MAX_ACQUISITION_INDUSTRIES;
  useEffect(()=>{
    let active=true;
    void fetch("/api/users/me",{cache:"no-store"}).then((response)=>response.ok?response.json():null).then((profile)=>{
      if (!active||!profile?.id) return;
      const key=`dtsmart-ai-acquisition:recent-industries:${profile.id}`;
      setPreferenceKey(key);
      try {
        const saved=JSON.parse(window.localStorage.getItem(key)||"[]");
        if (Array.isArray(saved)) setRecentIndustries(saved.filter((item):item is string=>typeof item==="string").slice(0,8));
      } catch { /* Ignore invalid account preference data. */ }
    }).catch(()=>undefined);
    return ()=>{active=false};
  },[]);
  const rememberIndustry = (item:string) => {
    const next = [item,...recentIndustries.filter((industry)=>industry!==item)].slice(0,8);
    setRecentIndustries(next);
    if (preferenceKey) try { window.localStorage.setItem(preferenceKey,JSON.stringify(next)); } catch { /* Private browsing may block storage. */ }
  };
  const showRelatedFor = (item:string, sourceOptions?:string[]) => {
    setRecommendationBasis(item);
    setRelatedRecommendations((sourceOptions||acquisitionIndustrySuggestions(item,MAX_ACQUISITION_INDUSTRIES)).filter((industry)=>industry!==item));
  };
  const toggle = (item: string) => {
    if (value.includes(item)) onChange(value.filter((selected) => selected !== item));
    else if (value.length < MAX_ACQUISITION_INDUSTRIES) {
      onChange([...value, item]);
      rememberIndustry(item);
      showRelatedFor(item);
      setQuery("");
    }
  };
  const addCustom = () => {
    if (!canAddCustom) return;
    onChange([...value, normalized]);
    rememberIndustry(normalized);
    showRelatedFor(normalized,options);
    setQuery("");
  };
  const confirmBestMatch = () => {
    if (!normalized || value.length >= MAX_ACQUISITION_INDUSTRIES) return;
    const exact = options.find((item)=>item.toLowerCase()===normalized.toLowerCase());
    const selected = exact || (options.length===1?options[0]:"") || (!options.length&&canAddCustom ? normalized : "");
    if (!selected&&options.length>1) {
      setRecommendationBasis(normalized);
      setRelatedRecommendations(options);
      onNotice(`已找到 ${options.length} 个“${normalized}”相关细分行业，请选择实际目标行业`);
      return;
    }
    if (!selected || value.some((item)=>item.toLowerCase()===selected.toLowerCase())) return;
    onChange([...value,selected]);
    rememberIndustry(selected);
    showRelatedFor(selected,options);
    setQuery("");
    onNotice(selected===normalized?`已加入“${selected}”并补充精准关键词`:`已采用最匹配的“${selected}”并补充精准关键词`);
  };
  const addMany = (text:string) => {
    const incoming = splitBulkValues(text);
    const next = mergeUniqueValues(value, incoming, MAX_ACQUISITION_INDUSTRIES, (item)=>item.length>=2&&item.length<=60&&!/[<>\r\n]/.test(item));
    onChange(next);
    if (next.length>value.length) {
      const latest=next[next.length-1];
      rememberIndustry(latest);
      showRelatedFor(latest);
    }
    setQuery("");
    if (incoming.length > 1) onNotice(`已批量加入 ${next.length-value.length} 个行业${incoming.length > next.length-value.length ? "，重复、无效或超出上限的内容已忽略" : ""}`);
  };
  const personalizedRecommendations=[...new Set([...recentIndustries,...ACQUISITION_COMMON_INDUSTRIES])];
  const recommendations=(normalized ? options : recommendationBasis ? relatedRecommendations : personalizedRecommendations).filter((item)=>!value.includes(item));
  const visibleRecommendations=normalized||recommendationBasis||showAll?recommendations:recommendations.slice(0,6);
  const addRecommendedIndustries=()=>onChange(mergeUniqueValues(value,recommendations,MAX_ACQUISITION_INDUSTRIES,(item)=>item.length>=2&&item.length<=60));
  return <div className="space-y-2">
    <label className="relative block">
      <Search size={16} className="absolute left-3 top-3 text-slate-400"/>
      <input value={query} onChange={(event)=>setQuery(event.target.value)} onPaste={(event)=>{const text=event.clipboardData.getData("text");if(splitBulkValues(text).length>1){event.preventDefault();addMany(text)}}} onKeyDown={(event)=>{if(event.key==="Enter"){event.preventDefault();confirmBestMatch();}}} className={`${input} h-11 w-full pl-9 pr-3`} placeholder="输入目标行业，回车采用最匹配的标准行业" maxLength={60}/>
    </label>
    <p className="min-h-5 text-xs text-slate-400">可直接批量粘贴；多项用逗号、分号或换行分隔。</p>
    {value.length ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3"><span className="text-xs font-medium text-slate-500">已选 {value.length}/{MAX_ACQUISITION_INDUSTRIES}</span>{value.map((item)=><button key={item} type="button" aria-label={`移除${item}`} onClick={()=>toggle(item)} className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-sm text-blue-700 shadow-sm ring-1 ring-blue-100">{item}<X size={13}/></button>)}<button type="button" onClick={()=>onChange([])} className="ml-auto text-xs text-slate-500 hover:text-blue-700">清空</button></div>:null}
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs font-medium text-slate-500">{normalized?"相近标准行业（按匹配度）":recommendationBasis?`基于“${recommendationBasis}”继续推荐`:"为你推荐（近期偏好优先）"}</p><span className="flex shrink-0 items-center gap-3">{recommendations.length?<button type="button" disabled={value.length>=MAX_ACQUISITION_INDUSTRIES} onClick={addRecommendedIndustries} className="text-xs font-medium text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400">批量选择</button>:null}{recommendationBasis&&!normalized?<button type="button" onClick={()=>{setRecommendationBasis("");setRelatedRecommendations([])}} className="text-xs text-slate-500 hover:text-blue-700">返回常用推荐</button>:null}{!normalized&&!recommendationBasis&&recommendations.length>6?<button type="button" onClick={()=>setShowAll((current)=>!current)} className="text-xs text-blue-700 hover:underline">{showAll?"收起":"展开更多"}</button>:null}</span></div>
      <div className="flex flex-wrap gap-2">
        {visibleRecommendations.map((item)=><button key={item} type="button" disabled={value.length>=MAX_ACQUISITION_INDUSTRIES} aria-pressed="false" onClick={()=>toggle(item)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-600 transition hover:border-blue-300 disabled:opacity-40"><Plus size={12}/> {item}</button>)}
        {canAddCustom?<button type="button" onClick={addCustom} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-blue-400 bg-blue-50/40 px-3 text-sm font-medium text-blue-700"><Plus size={14}/>添加“{normalized}”</button>:null}
      </div>
      {normalized && !options.length && !canAddCustom ? <p className="mt-2 text-xs text-slate-400">行业名称需为2–60个字符，且最多选择{MAX_ACQUISITION_INDUSTRIES}个。</p> : null}
    </div>
  </div>;
}

const LEGACY_DRAFT_KEY = "dtsmart-ai-acquisition-create:v4";
const DRAFT_KEY = "dtsmart-ai-acquisition-create:manual:v1";
const emptyAcquisitionForm = () => ({
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

export function AcquisitionCreateView() {
  const router = useRouter();
  const { toast, node } = useToast();
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [cancelConfirm, setCancelConfirm] = useState(false),
    [flowOpen, setFlowOpen] = useState(false),
    [costLimitOpen, setCostLimitOpen] = useState(false),
    [showAllKeywordGroups, setShowAllKeywordGroups] = useState(false),
    [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [form, setForm] = useState(emptyAcquisitionForm);
  const keywordRecommendationGroups = acquisitionKeywordRecommendationGroups(form.industries);
  const keywordRecommendations = acquisitionKeywordRecommendations(form.industries);
  const visibleKeywordRecommendationGroups = showAllKeywordGroups ? keywordRecommendationGroups : keywordRecommendationGroups.slice(0, 4);
  const searchPlans = normalizeAcquisitionCountries(form.countries).map((country) => ({ country, ...planAcquisitionSearchTerms(country, form.industries, form.keywords) }));
  const requestKeyRef = useRef(crypto.randomUUID());
  useEffect(() => {
    window.sessionStorage.removeItem(LEGACY_DRAFT_KEY);
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
      setHasSavedDraft(true);
    } catch { window.sessionStorage.removeItem(DRAFT_KEY); }
  }, []);
  const automaticName = (() => {
    const country = form.countries.length === 1 ? COUNTRY_NAMES.of(form.countries[0]) || form.countries[0] : form.countries.length > 1 ? `${COUNTRY_NAMES.of(form.countries[0]) || form.countries[0]}等${form.countries.length}国` : "";
    const industry = form.industries.length === 1 ? form.industries[0] : form.industries.length > 1 ? `${form.industries[0]}等${form.industries.length}行业` : "";
    return [country, industry, form.cost_mode === "FREE_ONLY" ? "标准获客" : "智能获客"].filter(Boolean).join("｜").slice(0, 100);
  })();
  const hasDraftContent = Boolean(form.name.trim() || form.countries.length || form.industries.length || form.keywords.length || form.task_cost_limit_usd || form.schedule_type === "scheduled");
  function updateIndustries(industries:string[]) {
    setForm((current)=>{
      const newlyAdded=industries.filter((industry)=>!current.industries.includes(industry));
      const removed=current.industries.filter((industry)=>!industries.includes(industry));
      const recommendedKeywords=acquisitionKeywordRecommendations(newlyAdded);
      const removedRecommendations=new Set(acquisitionKeywordRecommendations(removed));
      const retainedRecommendations=new Set(acquisitionKeywordRecommendations(industries));
      const retainedKeywords=current.keywords.filter((keyword)=>!removedRecommendations.has(keyword)||retainedRecommendations.has(keyword));
      return {...current,industries,keywords:mergeUniqueValues(retainedKeywords,recommendedKeywords,MAX_ACQUISITION_KEYWORDS,(keyword)=>keyword.length<=80)};
    });
  }
  useEffect(() => {
    if (form.name_mode !== "AUTO" || form.name === automaticName) return;
    setForm((current)=>current.name_mode === "AUTO" ? {...current,name:automaticName} : current);
  }, [automaticName, form.name, form.name_mode]);
  function saveDraft() {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    setHasSavedDraft(true);
    toast("草稿已暂存，下次进入本页可继续填写");
  }
  function clearDraft() {
    window.sessionStorage.removeItem(DRAFT_KEY);
    setHasSavedDraft(false);
    setForm(emptyAcquisitionForm());
    requestKeyRef.current = crypto.randomUUID();
    toast("草稿和当前填写内容已清空");
  }
  const invalid =
    !form.name.trim() ||
    !form.industries.length ||
    !form.keywords.length ||
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
      setHasSavedDraft(false);
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
        actions={<button type="button" onClick={()=>hasDraftContent?setCancelConfirm(true):router.push("/ai-acquisition")} className={button}>返回任务中心</button>}
      />
      {hasSavedDraft?<div className="flex items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-2 text-sm text-blue-800"><span>存在已暂存草稿</span><button type="button" onClick={clearDraft} className="shrink-0 font-medium text-blue-700 hover:underline">清空并新建</button></div>:null}
        <section className={`${panel} overflow-visible`}>
          <div className="border-b border-[#e8ecf2] px-4 py-[14px]"><h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-[#1763e8] text-sm text-white">1</span>任务与目标市场</h2><p className="ml-[38px] mt-1 text-sm text-[#778397]">设置任务名称、目标国家和执行时间。</p></div>
          <div className="grid items-start gap-3 p-4 lg:grid-cols-2 xl:grid-cols-[minmax(250px,.85fr)_minmax(230px,.75fr)_minmax(520px,1.4fr)]"><label>
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
          </div><div><span className="mb-1.5 block text-sm font-medium">执行时间</span><ScheduleControl scheduleType={form.schedule_type} scheduledAt={form.scheduled_at} onScheduleTypeChange={(schedule_type)=>setForm((current)=>({...current,schedule_type}))} onScheduledAtChange={(scheduled_at)=>setForm((current)=>({...current,scheduled_at}))}/></div></div>
        </section>
        <section className={`${panel} overflow-visible`}>
          <div className="border-b border-[#e8ecf2] px-4 py-[14px]"><h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-[#1763e8] text-sm text-white">2</span>目标客户条件</h2><p className="ml-[38px] mt-1 text-sm text-[#778397]">行业可多选或自定义；系统按任一目标行业匹配，并逐家核验真实业务。</p></div>
          <div className="grid items-start gap-4 p-4 xl:grid-cols-2">
          <div><span className="mb-1.5 flex h-5 items-center justify-between gap-3 text-sm font-medium text-slate-700"><span>目标行业 <b className="text-rose-500">*</b></span><span className={`text-xs font-normal ${form.industries.length>=MAX_ACQUISITION_INDUSTRIES?"text-amber-700":"text-slate-500"}`}>已选 {form.industries.length}/{MAX_ACQUISITION_INDUSTRIES}</span></span>
          <IndustryPicker value={form.industries} onChange={updateIndustries} onNotice={(message,tone)=>toast(message,tone)}/>
          <p className="mt-1 text-xs text-slate-400">最多 {MAX_ACQUISITION_INDUSTRIES} 个行业；{form.industries.length>=MAX_ACQUISITION_INDUSTRIES?"已达上限，请移除或拆分任务。":`还可添加 ${MAX_ACQUISITION_INDUSTRIES-form.industries.length} 个。`}</p>
          </div>
          <div>
          <ChipInput
            label="搜索关键词"
            required
            values={form.keywords}
            onChange={(keywords) => setForm({ ...form, keywords })}
            placeholder="必填，可直接批量粘贴；多项用逗号、分号或换行分隔，不会放宽目标行业范围。"
            onNotice={(message,tone)=>toast(message,tone)}
          />
          {searchPlans.length && form.industries.length && form.keywords.length ? <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2 text-xs leading-5 text-slate-600">
            <b className="text-slate-700">实际搜索词预览</b><span className="ml-2 text-slate-500">每国最多 32 条表达；此处不是 API 调用次数。</span>
            <div className="mt-1 space-y-1">{searchPlans.map((plan)=>{
              const localCount=plan.terms.filter((term)=>acquisitionSearchLanguage(plan.country,term)!=="en").length;
              return <details key={plan.country} className="rounded-md bg-white/70 px-2 py-1"><summary className="cursor-pointer text-blue-700"><CountryLabel value={plan.country} className="!text-xs"/>：{plan.terms.length} 条（本地语种 {localCount}）；{plan.unplannedKeywords.length?<b className="text-amber-700">未纳入 {plan.unplannedKeywords.length} 个关键词，建议拆分任务</b>:"每个所填词至少纳入一条表达"}</summary><ol className="mt-1 list-inside list-decimal space-y-0.5 text-slate-600">{plan.terms.map((term)=><li key={term}>{term}<span className="ml-1 text-slate-400">{acquisitionSearchLanguage(plan.country,term)==="en"?"英语":"本地语种"}</span></li>)}</ol>{plan.unplannedKeywords.length?<p className="mt-1 text-amber-700">未纳入：{plan.unplannedKeywords.join("、")}</p>:null}</details>;
            })}</div>
          </div> : null}
          {keywordRecommendations.length ? <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium text-slate-500">精准关键词推荐 <span className="font-normal text-slate-400">· 已随目标行业自动补入，可继续增删</span></span><span className="flex items-center gap-3"><button type="button" disabled={keywordRecommendations.every((keyword)=>form.keywords.includes(keyword))||form.keywords.length>=MAX_ACQUISITION_KEYWORDS} onClick={()=>setForm((current)=>({...current,keywords:[...new Set([...current.keywords,...keywordRecommendations])].slice(0,MAX_ACQUISITION_KEYWORDS)}))} className="text-xs font-medium text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400">补齐全部推荐</button>{keywordRecommendationGroups.length>4?<button type="button" aria-expanded={showAllKeywordGroups} onClick={()=>setShowAllKeywordGroups((current)=>!current)} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">{showAllKeywordGroups?"收起":"查看全部"}<ChevronDown size={13} className={`transition ${showAllKeywordGroups?"rotate-180":""}`}/></button>:null}</span></div><div className={`space-y-3 ${showAllKeywordGroups?"max-h-[360px] overflow-y-auto pr-1":""}`}>{visibleKeywordRecommendationGroups.map((group)=>{const originalIndex=keywordRecommendationGroups.findIndex((item)=>item.industry===group.industry);return <div key={group.industry} className="grid gap-2 sm:grid-cols-[8.5rem_minmax(0,1fr)]"><div className="pt-1.5 text-xs font-medium text-slate-600"><span className="mr-1 text-slate-400">{originalIndex+1}.</span>{group.industry}</div><div className="flex flex-wrap items-center gap-2">{group.keywords.map((keyword)=>{const selected=form.keywords.includes(keyword);return <button key={`${group.industry}:${keyword}`} type="button" aria-pressed={selected} disabled={!selected&&form.keywords.length>=MAX_ACQUISITION_KEYWORDS} onClick={()=>setForm((current)=>({...current,keywords:selected?current.keywords.filter((item)=>item!==keyword):[...current.keywords,keyword]}))} className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs transition disabled:opacity-40 ${selected?"border-blue-400 bg-blue-50 font-medium text-blue-700":"border-slate-200 bg-white text-slate-600 hover:border-blue-300"}`}>{selected?<Check size={12}/>:<Plus size={12}/>} {keyword}</button>})}</div></div>})}</div>{keywordRecommendationGroups.length>4&&!showAllKeywordGroups?<p className="mt-3 text-xs text-slate-400">默认展示前 4 个目标行业，可展开选择其余 {keywordRecommendationGroups.length-4} 个行业的推荐词。</p>:<p className="mt-3 text-xs text-slate-400">推荐词只细化对应行业，不会放宽本次目标行业范围；可手动增删。</p>}</div>:null}
          </div>
          </div>
        </section>
        <div className="grid items-stretch gap-[14px] xl:grid-cols-[minmax(0,1.45fr)_minmax(290px,.55fr)]">
        <section className={`${panel} h-full`}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e8ecf2] px-4 py-[14px]"><div><h2 className="text-[17px] font-semibold"><span className="mr-2 inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-[#1763e8] text-sm text-white">3</span>AI获客模式</h2><p className="ml-[38px] mt-1 text-sm text-[#778397]">质量门槛相同，仅付费补证权限不同。</p></div><button type="button" onClick={()=>setFlowOpen(true)} className={`${button} h-8 px-3 text-xs`}>查看获客规则</button></div>
          <div className="p-4"><div className="grid gap-[14px] md:grid-cols-2">
            {[
              {
                id: "ADAPTIVE",
                title: "智能获客",
                text: "免费发现与核验优先；仅对高相关、证据不足的候选在限额内补证。",
                facts: [["数据来源","官网、公开页面、Google免费额度"],["补证策略","高相关候选按需付费"],["停止条件","达标、非目标或触及上限"],["适用场景","兼顾数量、质量与成本"]],
                steps: ["免费发现", "目标初判", "按需付费补证", "高可信入池"],
                badge: "推荐",
              },
              {
                id: "FREE_ONLY",
                title: "标准获客",
                text: "仅使用官网、公开页面和系统记录金额为0的额度；需要进入付费路径时停止并留痕。",
                facts: [["数据来源","官网、公开页面、免费额度"],["补证策略","禁止正金额调用"],["停止条件","免费证据用尽或确认非目标"],["适用场景","零预算，证据不足待复核"]],
                steps: ["免费发现", "免费核验", "同等证据门槛", "入池或待复核"],
                badge: "零付费调用",
              },
            ].map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setForm({ ...form, cost_mode: m.id })}
                aria-pressed={form.cost_mode === m.id}
                className={`relative rounded-xl border p-[18px] text-left transition ${form.cost_mode === m.id ? "border-[#1763e8] shadow-[0_0_0_2px_#e7efff]" : "border-[#dfe5ee] hover:border-blue-300"}`}
              >
                <span className={`absolute right-3 top-3 rounded-[5px] px-[7px] py-[3px] text-xs ${m.id==="FREE_ONLY"?"bg-emerald-50 text-emerald-700":"bg-[#eaf1ff] text-[#1763e8]"}`}>{m.badge}</span>
                <h3 className="pr-24 text-[17px] font-semibold">{m.title}</h3>
                <p className="mb-3 mt-2 min-h-12 text-sm leading-6 text-slate-500">
                  {m.text}
                </p>
                <dl className="mb-3 grid gap-x-4 gap-y-2 border-y border-slate-100 py-3 text-xs sm:grid-cols-2">{m.facts.map(([label,value])=><div key={label} className="min-w-0"><dt className="mb-0.5 font-medium text-slate-500">{label}</dt><dd className="leading-5 text-slate-700">{value}</dd></div>)}</dl>
                <span className="flex flex-wrap items-center gap-1 pr-7 text-xs text-[#46546a]">{m.steps.map((step,index)=><span key={step} className="contents"><span className="rounded-md border border-[#dfe5ee] bg-[#f4f7fb] px-2 py-[5px]">{step}</span>{index<m.steps.length-1?<span className="text-[#9aa6b6]">→</span>:null}</span>)}</span>
                {form.cost_mode===m.id?<Check className={`absolute bottom-4 right-4 ${m.id==="FREE_ONLY"?"text-emerald-600":"text-[#1763e8]"}`} size={19}/>:null}
              </button>
            ))}
          </div>
          {form.cost_mode === "ADAPTIVE" ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60">
              <button type="button" aria-expanded={costLimitOpen} onClick={()=>setCostLimitOpen((current)=>!current)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm"><span><b>单任务费用保护</b><span className="ml-1 text-slate-400">（可选）</span></span><span className="flex items-center gap-2 text-xs text-slate-500"><span>{form.task_cost_limit_usd?`上限 $${Number(form.task_cost_limit_usd).toFixed(2)}`:"继承全局上限"}</span><ChevronDown size={15} className={`transition ${costLimitOpen?"rotate-180":""}`}/></span></button>
              {costLimitOpen?<div className="border-t border-slate-200 px-3 py-3"><label className="block max-w-xs"><span className="mb-1.5 block text-sm font-medium">费用上限（USD）</span><input type="text" inputMode="decimal" className={`${input} w-full`} value={form.task_cost_limit_usd} placeholder="留空则继承全局上限" onChange={(event)=>{const value=event.target.value.trim();if(/^\d*(\.\d{0,2})?$/.test(value))setForm({...form,task_cost_limit_usd:value})}}/></label><p className="mt-2 text-xs leading-5 text-slate-500">仍受AI获客设置的日、周、月及单客户上限约束；任一限制先触发即停止付费补证。</p></div>:null}
            </div>
          ) : null}</div>
        </section>
      <aside className="h-full rounded-[9px] border border-[#dce5f4] bg-[#f8faff] p-[14px]"><h3 className="mb-[10px] font-semibold">创建前确认</h3><dl className="text-sm">{[
        ["目标国家/地区",form.countries.length ? (form.countries.length<=2?form.countries.map((code)=>COUNTRY_NAMES.of(code)||code).join("、"):`已选 ${form.countries.length} 个`) : "尚未选择",form.countries.map((code)=>COUNTRY_NAMES.of(code)||code).join("、")],
        ["目标行业",form.industries.length ? (form.industries.length<=2?form.industries.join("、"):`已选 ${form.industries.length} 个`) : "尚未选择",form.industries.join("、")],
        ["搜索关键词",form.keywords.length?`已选择 ${form.keywords.length} 个`:"尚未选择",form.keywords.join("、")],
        ["执行时间",form.schedule_type==="scheduled"&&form.scheduled_at?new Date(form.scheduled_at).toLocaleString("zh-CN",{hour12:false}):"创建后立即执行",""],
        ["获客模式",form.cost_mode==="FREE_ONLY"?"标准获客":"智能获客",""],
        ["任务费用上限",form.cost_mode==="FREE_ONLY"?"$0.00":form.task_cost_limit_usd?`$${Number(form.task_cost_limit_usd).toFixed(2)}`:"继承全局上限",""],
      ].map(([label,value,title])=><div key={label} className="flex justify-between gap-[10px] border-b border-dashed border-[#dbe2ec] py-[7px]"><dt className="shrink-0 text-[#6f7c90]">{label}</dt><dd title={title||undefined} className="max-w-[190px] break-words text-right font-semibold">{label==="目标国家/地区"&&form.countries.length<=2?form.countries.length?form.countries.map((code)=><CountryLabel key={code} value={code} className="!text-xs"/>):value:value}</dd></div>)}</dl><p className={`mt-2 text-xs leading-5 ${invalid?"text-amber-700":"text-slate-500"}`}>{invalid?"请完整填写任务名称、目标行业、搜索关键词、国家/地区和有效执行时间。":"仅通过目标、在营、证据、联系方式和系统去重门槛的客户进入公海。"}</p><button type="button" disabled={invalid} onClick={()=>setConfirm(true)} className={`${primaryButton} mt-[14px] w-full justify-center`}>{form.schedule_type==="scheduled"?"预约并创建":"创建并自动执行"}</button><button type="button" disabled={!hasDraftContent} onClick={saveDraft} className={`${button} mt-2 w-full justify-center`}>{hasSavedDraft?"更新草稿":"暂存草稿"}</button></aside>
      </div>
      {node}
      <ConfirmDialog open={cancelConfirm} title="返回任务中心？" description="已经暂存的草稿会保留；当前未再次暂存的修改将丢失。" confirmLabel="确认返回" onClose={()=>setCancelConfirm(false)} onConfirm={()=>router.push("/ai-acquisition")}/>
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
              ["1. 固定任务范围","根据国家/地区、目标行业和搜索关键词生成有限搜索计划；部分标准行业和常用关键词有经核对的本地语种表达，同时保留英语原词。未覆盖的自定义关键词不会假装已翻译，创建前可查看未纳入计划的词。"],
              ["2. 低成本发现","优先使用公开来源和可核对免费额度，按本地化检索表达发现商家；连续分页无新候选即提前结束。"],
              ["3. 前置早停","Google 商家永久停业、基础类别明显不相关或系统已有相同 Place ID 的候选立即停止，不继续产生补证费用。"],
              ["4. 主体与在营核验","交叉核对名称、地址、电话、官网域名、Google 商家和公开页面，主体冲突或缺少当前在营依据不进入公海。"],
              ["5. 按需补证","只对行业高度相关但缺少关键证据的候选继续采集官网、地图和社媒公开信息；智能模式才允许在费用边界内调用付费能力。"],
              ["6. 联系方式核验","电话、邮箱和 WhatsApp 必须保存发现该联系方式的具体页面；列表可直接打开来源核验，WhatsApp 另可直达对话。"],
              ["7. AI评分与准入","基于已核验事实形成行业、等级、评分和理由；行业、主体、在营、证据、有效联系方式任一门槛不通过都不进入客户公海。"],
              ["8. 全局去重入池","按 Place ID、规范化电话、邮箱、WhatsApp 等强身份与现有客户、历史获客结果去重，只把新的合格客户送入待认领公海。"],
            ].map(([title,text])=><li key={title} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"><b className="text-slate-800">{title}</b><p className="mt-1.5 leading-6">{text}</p></li>)}
          </ol>
          <section className="rounded-xl border border-cyan-100 bg-cyan-50/50 p-4"><h3 className="font-semibold text-cyan-900">云端执行与页面关闭</h3><p className="mt-1.5 leading-6 text-cyan-800">新建、继续和失败重试任务均由绑定账户的 Vercel 云端 Workflow 调度，本地页面不参与任务执行，创建成功后关闭页面不会中断任务。系统保存任务进度和检查点；发生可恢复异常时从最近检查点继续，不重新处理已完成客户。</p></section>
          <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-4"><h3 className="font-semibold text-blue-900">暂停、恢复、重试与完成</h3><p className="mt-1.5 leading-6 text-blue-800">暂停在安全节点停止新调用，恢复应从最近成功检查点继续；失败重试只处理未完成步骤，不重复已入账调用和已处理客户。系统按创建前预览的有限搜索词计划执行，并受每国搜索范围、分页及费用上限保护；不会保证遍历所有行业与关键词的笛卡尔组合，停止原因会留痕。</p></section>
          <section className="rounded-xl border border-amber-100 bg-amber-50/60 p-4"><h3 className="font-semibold text-amber-900">费用、耗时与质量边界</h3><p className="mt-1.5 leading-6 text-amber-800">智能获客任务同时受付费渠道开关、单任务费用上限、每日/每周/每月上限及单客户调用次数限制，任一限制先触发即停止付费调用；标准获客只允许系统记录金额为 0 的调用。创建前不展示无法保证准确的耗时或费用预估，任务详情会记录具体来源页、判断依据、API SKU、免费/计价状态、成本参考和有效执行耗时；服务商最终结算以其账单为准。系统通过多来源交叉验证降低误判，但公开数据可能变化，因此保留人工核对入口，不作绝对无误承诺。</p></section>
          <section className="rounded-xl border border-violet-100 bg-violet-50/50 p-4"><h3 className="font-semibold text-violet-900">候选进入AI筛选后的底层核验</h3><p className="mt-1.5 leading-6 text-violet-800">候选先规范化名称、地址、电话、邮箱域名、官网和 Place ID，再按“官网与关键子页 → 免费公开来源 → 必要时 Google 主体候选 → 已核验社媒”的顺序采集。确定性规则先判断明确经营事实；仅在主体通过且证据确有歧义时，模型才综合已采集证据。最后执行证据门控、评分一致性校准、联系方式具体来源校验和原子写回；抓取失败、主体冲突或证据不足不会被伪造成有效或无效结论。</p></section>
        </div>
      </AppDialog>
      <AppDialog
        open={confirm}
        title="确认创建AI获客任务"
        description="创建后将按设定时间执行；智能获客可能在费用限制内产生付费调用。"
        onClose={() => !busy && setConfirm(false)}
        width="max-w-xl"
      >
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-3.5 py-3"><p className="text-xs text-blue-600">任务名称</p><p className="mt-1 font-semibold text-slate-900">{form.name}</p></div>
          <dl className="grid grid-cols-2 gap-x-5 rounded-lg border border-slate-200 bg-white px-3.5 py-1">
            {[
              ["国家/地区",form.countries.length<=2?form.countries.map((code)=>COUNTRY_NAMES.of(code)||code).join("、"):`已选 ${form.countries.length} 个`],
              ["目标行业",`已选 ${form.industries.length} 个`],
              ["搜索关键词",`已选 ${form.keywords.length} 个`],
              ["执行时间",form.schedule_type==="scheduled"&&form.scheduled_at?new Date(form.scheduled_at).toLocaleString("zh-CN",{hour12:false}):"立即执行"],
              ["获客模式",form.cost_mode === "FREE_ONLY"?"标准获客":"智能获客"],
              ["费用保护",form.cost_mode === "FREE_ONLY"?"禁止正金额调用":form.task_cost_limit_usd?`任务上限 $${Number(form.task_cost_limit_usd).toFixed(2)}`:"遵循全局上限"],
            ].map(([label,value])=><div key={label} className="flex min-w-0 items-center justify-between gap-3 border-b border-dashed border-slate-200 py-2.5"><dt className="shrink-0 text-slate-500">{label}</dt><dd className="truncate text-right font-medium text-slate-800">{label==="国家/地区"&&form.countries.length<=2?form.countries.length?form.countries.map((code)=><CountryLabel key={code} value={code} className="!text-xs"/>):value:value}</dd></div>)}
          </dl>
          <details className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5"><summary className="cursor-pointer font-medium text-slate-700">查看已选行业和关键词</summary><div className="mt-2 space-y-2 border-t border-slate-200 pt-2 text-xs leading-5 text-slate-600"><p><b className="text-slate-700">目标行业：</b>{form.industries.join("、")}</p><p><b className="text-slate-700">搜索关键词：</b>{form.keywords.join("、")}</p></div></details>
          <p className="rounded-lg bg-blue-50 px-3.5 py-2.5 text-xs leading-5 text-blue-800">任务由云端工作流执行；创建成功后可关闭页面，任务会按计划继续。</p>
          <p className={`rounded-lg px-3.5 py-2.5 text-xs leading-5 ${form.cost_mode === "FREE_ONLY"?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-800"}`}>{form.cost_mode === "FREE_ONLY"?"仅执行系统记录金额为 0 的发现与核验；免费证据不足的候选进入待复核。":"免费渠道优先；仅对高度相关但证据不足的候选，在全局及单任务费用限制内付费补证。"}</p>
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
