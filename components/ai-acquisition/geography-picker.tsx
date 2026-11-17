"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { CountryLabel } from "@/components/country-label";
import { ACQUISITION_COUNTRY_GROUPS, type AcquisitionCountry } from "@/lib/ai-acquisition/config";
import { geographyScopeDisplayLabel, type GeographyScope, type GeographyScopes } from "@/lib/ai-acquisition/geography";

type RegionOption = { code: string; name: string; displayName: string };
type CityOption = { name: string; displayName: string };
const COUNTRY_NAMES = new Intl.DisplayNames(["zh-CN"], { type: "region" });

function RegionTree({ country, scopes, totalCount, onChange }: {
  country: AcquisitionCountry;
  scopes: GeographyScope[];
  totalCount: number;
  onChange: (value: GeographyScope[]) => void;
}) {
  const [regions, setRegions] = useState<RegionOption[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [regionCode, setRegionCode] = useState(scopes[0]?.regionCode || "");
  const [regionQuery, setRegionQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingCities, setLoadingCities] = useState(false);
  const [regionError, setRegionError] = useState("");
  const [cityError, setCityError] = useState("");
  const [limitError, setLimitError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/ai-acquisition/geography?country=${encodeURIComponent(country)}`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "省/州加载失败"); return body; })
      .then((body) => { setRegions(body.regions || []); setRegionError(""); })
      .catch((cause) => { if (!controller.signal.aborted) setRegionError(cause instanceof Error ? cause.message : "省/州加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [country, retry]);

  useEffect(() => {
    if (!regionCode) return;
    const controller = new AbortController();
    setLoadingCities(true);
    setCities([]);
    setCityError("");
    fetch(`/api/ai-acquisition/geography?country=${encodeURIComponent(country)}&region=${encodeURIComponent(regionCode)}`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "城市加载失败"); return body; })
      .then((body) => setCities(body.cities || []))
      .catch((cause) => { if (!controller.signal.aborted) setCityError(cause instanceof Error ? cause.message : "城市加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoadingCities(false); });
    return () => controller.abort();
  }, [country, regionCode, retry]);

  const changeScopes = (next: GeographyScope[]) => {
    if (next.length > 8 || totalCount - scopes.length + next.length > 16) {
      setLimitError("每个国家最多选8处、单任务最多16处；请移除已有地域或拆分任务。");
      return;
    }
    setLimitError("");
    onChange(next);
  };
  const toggleRegion = (code: string) => {
    const selected = scopes.some((scope) => scope.regionCode === code && scope.city === null);
    changeScopes([...scopes.filter((scope) => scope.regionCode !== code), ...selected ? [] : [{ regionCode: code, city: null }]]);
  };
  const toggleCity = (code: string, name: string) => {
    const selected = scopes.some((scope) => scope.regionCode === code && scope.city === name);
    changeScopes([
      ...scopes.filter((scope) => scope.regionCode !== code),
      ...scopes.filter((scope) => scope.regionCode === code && scope.city !== null && scope.city !== name),
      ...selected ? [] : [{ regionCode: code, city: name }],
    ]);
  };
  const visibleRegions = useMemo(() => regions.filter((region) => `${region.displayName} ${region.name}`.toLocaleLowerCase().includes(regionQuery.trim().toLocaleLowerCase())), [regions, regionQuery]);
  const visibleCities = useMemo(() => cities.filter((city) => `${city.displayName} ${city.name}`.toLocaleLowerCase().includes(cityQuery.trim().toLocaleLowerCase())), [cities, cityQuery]);
  return <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-2.5 pl-8">
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500">省/州 · 可多选，展开后选择城市</span>
      <label className="relative w-44 max-w-[55%]"><Search size={13} className="absolute left-2 top-2 text-slate-400"/><input aria-label={`${country}搜索省州`} value={regionQuery} onChange={(event) => setRegionQuery(event.target.value)} placeholder="搜索省/州" className="h-7 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-xs outline-none focus:border-blue-400"/></label>
    </div>
    {limitError ? <p role="alert" className="mb-2 text-xs text-amber-700">{limitError}</p> : null}
    {regionError ? <button type="button" onClick={() => setRetry((value) => value + 1)} className="text-xs text-red-600 underline">{regionError}，点击重试</button> : null}
    {loading ? <p className="py-2 text-xs text-slate-500">正在加载省/州…</p> : null}
    {!loading && !regionError && !regions.length ? <p className="py-2 text-xs text-slate-500">暂无可靠省/州索引；当前国家将按全国搜索。</p> : null}
    <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1" role="group" aria-label={`${country}省州城市树`}>
      {visibleRegions.map((region) => {
        const selected = scopes.filter((scope) => scope.regionCode === region.code);
        const whole = selected.some((scope) => scope.city === null);
        const expanded = regionCode === region.code;
        return <div key={region.code} className="rounded-md">
          <div className={`flex min-h-8 items-center rounded-md ${expanded ? "bg-blue-50" : "hover:bg-white"}`}>
            <button type="button" role="checkbox" aria-checked={whole ? "true" : selected.length ? "mixed" : "false"} aria-label={`选择整个${region.displayName}`} onClick={() => toggleRegion(region.code)} className="grid h-8 w-8 shrink-0 place-items-center"><span className={`grid h-4 w-4 place-items-center rounded border ${whole ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}>{whole ? <Check size={11}/> : null}</span></button>
            <button type="button" aria-expanded={expanded} aria-label={`展开${region.displayName}城市`} onClick={() => { setRegionCode(expanded ? "" : region.code); setCityQuery(""); }} className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1 pr-2 text-left text-xs text-slate-700"><span className="truncate" title={region.displayName}>{region.displayName}</span><span className="flex shrink-0 items-center gap-1 text-[11px] text-blue-700">{whole ? "全省" : selected.length ? `${selected.length}城` : ""}<ChevronRight size={13} className={`text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}/></span></button>
          </div>
          {expanded ? <div className="ml-8 border-l border-blue-200 py-1 pl-3">
            <div className="mb-1.5 flex items-center justify-between gap-2"><span className="text-[11px] text-slate-500">城市 · 多选</span><label className="relative w-40 max-w-[65%]"><Search size={12} className="absolute left-2 top-1.5 text-slate-400"/><input aria-label={`${country}${region.name}搜索城市`} value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder="搜索城市" className="h-7 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-xs outline-none focus:border-blue-400"/></label></div>
            {loadingCities ? <p className="py-2 text-xs text-slate-500">正在加载城市…</p> : null}
            {cityError ? <button type="button" onClick={() => setRetry((value) => value + 1)} className="text-xs text-red-600 underline">{cityError}，点击重试</button> : null}
            {!loadingCities && !cityError && !cities.length ? <p className="py-2 text-xs text-slate-500">暂无城市索引，可勾选整个省/州。</p> : null}
            {visibleCities.length > 80 ? <p className="mb-1 text-[11px] text-slate-500">显示前80个；搜索可找到全部{cities.length}个城市。</p> : null}
            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2" role="group" aria-label={`${region.displayName}城市多选`}>{visibleCities.slice(0, 80).map((city) => {
              const checked = selected.some((scope) => scope.city === city.name);
              return <button key={city.name} type="button" role="checkbox" aria-checked={checked} onClick={() => toggleCity(region.code, city.name)} className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs ${checked ? "bg-blue-100 text-blue-800" : "hover:bg-white"}`}><span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}>{checked ? <Check size={10}/> : null}</span><span className="truncate" title={city.displayName}>{city.displayName}</span></button>;
            })}</div>
            {!loadingCities && cityQuery && !visibleCities.length ? <p className="py-2 text-xs text-slate-500">没有匹配的城市</p> : null}
          </div> : null}
        </div>;
      })}
      {!loading && regionQuery && !visibleRegions.length ? <p className="py-2 text-xs text-slate-500">没有匹配的省/州</p> : null}
    </div>
  </div>;
}

export function GeographyPicker({ countries, value, onCountriesChange, onChange }: {
  countries: string[];
  value: GeographyScopes;
  onCountriesChange: (countries: string[]) => void;
  onChange: (value: GeographyScopes) => void;
}) {
  const [open, setOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [groupKey, setGroupKey] = useState<(typeof ACQUISITION_COUNTRY_GROUPS)[number]["key"]>("EUROPE");
  const [expandedCountry, setExpandedCountry] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const totalCount = Object.values(value).reduce((sum, scopes) => sum + (scopes?.length || 0), 0);
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onMouseDown); document.removeEventListener("keydown", onKeyDown); };
  }, []);
  const normalizedQuery = countryQuery.trim().toLocaleLowerCase();
  const activeGroup = ACQUISITION_COUNTRY_GROUPS.find((group) => group.key === groupKey) || ACQUISITION_COUNTRY_GROUPS[0];
  const groups = (normalizedQuery ? ACQUISITION_COUNTRY_GROUPS : [activeGroup]).map((group) => ({
    ...group, countries: group.countries.filter((code) => `${code} ${COUNTRY_NAMES.of(code)}`.toLocaleLowerCase().includes(normalizedQuery)),
  })).filter((group) => group.countries.length);
  const toggleCountry = (code: string) => {
    if (countries.includes(code)) {
      onCountriesChange(countries.filter((item) => item !== code));
      if (expandedCountry === code) setExpandedCountry("");
    } else if (countries.length < 8) {
      onCountriesChange([...countries, code]);
      setExpandedCountry(code);
    }
  };
  const orderedCodes = [
    ...countries.filter((code) => !normalizedQuery || `${code} ${COUNTRY_NAMES.of(code)}`.toLocaleLowerCase().includes(normalizedQuery)),
    ...groups.flatMap((group) => group.countries).filter((code) => !countries.includes(code)),
  ];
  return <div ref={ref} className="relative">
    <button type="button" aria-expanded={open} aria-controls="acquisition-geography-tree" onClick={() => setOpen(!open)} className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-blue-300">
      <span className="min-w-0 truncate">{countries.length ? `已选 ${countries.length} 个国家/地区 · ${totalCount ? `${totalCount} 处省市` : "全国搜索"}` : "选择国家 / 省州 / 城市"}</span><ChevronDown size={15} className={`shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}/>
    </button>
    {countries.length ? <div className="mt-2 flex flex-wrap gap-1.5">{countries.map((code) => <span key={code} className="rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-slate-700" title={(value[code as AcquisitionCountry] || []).map((scope) => geographyScopeDisplayLabel(code as AcquisitionCountry, scope)).join("、") || "全国搜索"}><CountryLabel value={code} className="!text-xs"/><span className="ml-1 text-blue-700">{value[code as AcquisitionCountry]?.length || "全国"}</span></span>)}</div> : null}
    {open ? <div id="acquisition-geography-tree" className="absolute right-0 top-full z-40 mt-2 w-[min(42rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
      <div className="border-b border-slate-100 p-3">
        <div className="flex items-center justify-between gap-2"><b className="text-sm text-slate-800">搜索地域</b><span className="text-xs text-slate-500">国家 {countries.length}/8 · 省市 {totalCount}/16</span></div>
        <label className="relative mt-2 block"><Search size={14} className="absolute left-3 top-2.5 text-slate-400"/><input autoFocus aria-label="搜索国家/地区" value={countryQuery} onChange={(event) => setCountryQuery(event.target.value)} placeholder="搜索国家/地区" className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-400"/></label>
        <div className="mt-2 flex flex-wrap gap-1" aria-label="洲别筛选">{ACQUISITION_COUNTRY_GROUPS.map((group) => <button key={group.key} type="button" aria-pressed={!normalizedQuery && group.key === groupKey} onClick={() => { setGroupKey(group.key); setCountryQuery(""); }} className={`rounded-md px-2 py-1 text-xs ${!normalizedQuery && group.key === groupKey ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>{group.label}</button>)}</div>
      </div>
      <div className="max-h-[min(27rem,55vh)] overflow-y-auto p-2" role="tree" aria-label="国家省州城市三级多选树">
        {orderedCodes.map((code) => {
          const selected = countries.includes(code);
          const expanded = expandedCountry === code && selected;
          const scopes = value[code as AcquisitionCountry] || [];
          return <div key={code} role="treeitem" aria-expanded={selected ? expanded : undefined} aria-selected={selected} className="mb-0.5 rounded-lg border border-transparent hover:border-slate-100">
            <div className={`flex min-h-9 items-center rounded-md ${expanded ? "bg-blue-50" : ""}`}>
              <button type="button" role="checkbox" aria-checked={selected} aria-label={`选择${COUNTRY_NAMES.of(code) || code}`} disabled={!selected && countries.length >= 8} onClick={() => toggleCountry(code)} className="grid h-9 w-9 shrink-0 place-items-center disabled:opacity-40"><span className={`grid h-4 w-4 place-items-center rounded border ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>{selected ? <Check size={11}/> : null}</span></button>
              <button type="button" aria-expanded={expanded} aria-label={`展开${COUNTRY_NAMES.of(code) || code}省州城市`} onClick={() => { if (!selected) toggleCountry(code); else setExpandedCountry(expanded ? "" : code); }} className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1 pr-2 text-left text-sm"><CountryLabel value={code} className="min-w-0 !text-sm"/><span className="flex shrink-0 items-center gap-1 text-xs text-blue-700">{selected ? scopes.length ? `${scopes.length}处` : "全国" : ""}<ChevronRight size={14} className={`text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}/></span></button>
            </div>
            {expanded ? <RegionTree key={code} country={code as AcquisitionCountry} scopes={scopes} totalCount={totalCount} onChange={(nextScopes) => { const next = { ...value }; if (nextScopes.length) next[code as AcquisitionCountry] = nextScopes; else delete next[code as AcquisitionCountry]; onChange(next); }}/> : null}
          </div>;
        })}
        {!orderedCodes.length ? <p className="p-6 text-center text-sm text-slate-500">没有匹配的国家/地区</p> : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2"><p className="text-[11px] text-slate-500">未选择省市的国家按全国搜索；勾选整省与单选城市互斥。</p><button type="button" onClick={() => setOpen(false)} className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">完成</button></div>
    </div> : null}
  </div>;
}
