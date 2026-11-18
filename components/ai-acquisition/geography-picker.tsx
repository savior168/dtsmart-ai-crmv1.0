"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Search } from "lucide-react";
import { CountryLabel } from "@/components/country-label";
import { ACQUISITION_COUNTRY_GROUPS, type AcquisitionCountry } from "@/lib/ai-acquisition/config";
import type { GeographyScope, GeographyScopes } from "@/lib/ai-acquisition/geography";
import { selectedGeographyDisplayLabel, type GeographyDisplayLabels } from "@/lib/ai-acquisition/geography-labels-client";

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
  const activeRegion = regions.find((region) => region.code === regionCode);
  const activeScopes = scopes.filter((scope) => scope.regionCode === regionCode);
  return <div className="grid h-full min-h-0 grid-cols-2 divide-x divide-slate-100">
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="border-b border-slate-100 p-2"><b className="text-xs text-slate-700">② 省/州</b><label className="relative mt-1 block"><Search size={13} className="absolute left-2 top-2 text-slate-400"/><input aria-label={`${country}搜索省州`} value={regionQuery} onChange={(event) => setRegionQuery(event.target.value)} placeholder="搜索省/州" className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-xs outline-none focus:border-blue-400"/></label></div>
      {limitError ? <p role="alert" className="px-2 py-1 text-xs text-amber-700">{limitError}</p> : null}
      {regionError ? <button type="button" onClick={() => setRetry((value) => value + 1)} className="px-2 py-1 text-left text-xs text-red-600 underline">{regionError}，点击重试</button> : null}
      {loading ? <p className="p-2 text-xs text-slate-500">正在加载省/州…</p> : null}
      {!loading && !regionError && !regions.length ? <p className="p-2 text-xs text-slate-500">暂无可靠省/州索引，按全国搜索。</p> : null}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5" role="group" aria-label={`${country}省州城市树`}>
        {visibleRegions.map((region) => {
          const selected = scopes.filter((scope) => scope.regionCode === region.code);
          const whole = selected.some((scope) => scope.city === null);
          const active = regionCode === region.code;
          return <div key={region.code} className={`flex min-h-8 items-center rounded-md ${active ? "bg-blue-50" : "hover:bg-slate-50"}`}>
            <button type="button" role="checkbox" aria-checked={whole ? "true" : selected.length ? "mixed" : "false"} aria-label={`选择整个${region.displayName}`} onClick={() => toggleRegion(region.code)} className="grid h-8 w-7 shrink-0 place-items-center"><span className={`grid h-4 w-4 place-items-center rounded border ${whole ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}>{whole ? <Check size={11}/> : null}</span></button>
            <button type="button" aria-current={active ? "true" : undefined} aria-label={`查看${region.displayName}城市`} onClick={() => { setRegionCode(region.code); setCityQuery(""); }} className="flex min-w-0 flex-1 items-center justify-between gap-1 py-1 pr-1 text-left text-xs text-slate-700"><span className="truncate" title={region.displayName}>{region.displayName}</span><span className="flex shrink-0 items-center gap-0.5 text-[11px] text-blue-700">{whole ? "全省" : selected.length ? `${selected.length}城` : ""}<ChevronRight size={12} className="text-slate-400"/></span></button>
          </div>;
        })}
        {!loading && regionQuery && !visibleRegions.length ? <p className="p-2 text-xs text-slate-500">没有匹配的省/州</p> : null}
      </div>
    </div>
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="border-b border-slate-100 p-2"><b className="block truncate text-xs text-slate-700" title={activeRegion?.displayName}>③ 城市{activeRegion ? ` · ${activeRegion.displayName}` : ""}</b><label className="relative mt-1 block"><Search size={13} className="absolute left-2 top-2 text-slate-400"/><input aria-label={`${country}${activeRegion?.name || ""}搜索城市`} disabled={!activeRegion} value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder={activeRegion ? "搜索城市" : "先选择省/州"} className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-xs outline-none focus:border-blue-400 disabled:bg-slate-50"/></label></div>
      {!activeRegion ? <p className="p-3 text-xs text-slate-500">点击左列省/州，查看并多选城市。</p> : <>
        {loadingCities ? <p className="p-2 text-xs text-slate-500">正在加载城市…</p> : null}
        {cityError ? <button type="button" onClick={() => setRetry((value) => value + 1)} className="p-2 text-left text-xs text-red-600 underline">{cityError}，点击重试</button> : null}
        {!loadingCities && !cityError && !cities.length ? <p className="p-2 text-xs text-slate-500">暂无城市索引，可勾选整个省/州。</p> : null}
        {visibleCities.length > 80 ? <p className="px-2 pt-1 text-[11px] text-slate-500">显示前80个；搜索可找到全部{cities.length}个城市。</p> : null}
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5" role="group" aria-label={`${activeRegion.displayName}城市多选`}>{visibleCities.slice(0, 80).map((city) => {
          const checked = activeScopes.some((scope) => scope.city === city.name);
          return <button key={city.name} type="button" role="checkbox" aria-checked={checked} onClick={() => toggleCity(regionCode, city.name)} className={`flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs ${checked ? "bg-blue-100 text-blue-800" : "hover:bg-slate-50"}`}><span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}>{checked ? <Check size={10}/> : null}</span><span className="truncate" title={city.displayName}>{city.displayName}</span></button>;
        })}{!loadingCities && cityQuery && !visibleCities.length ? <p className="p-2 text-xs text-slate-500">没有匹配的城市</p> : null}</div>
      </>}
    </div>
  </div>;
}

export function GeographyPicker({ countries, value, labels, onCountriesChange, onChange }: {
  countries: string[];
  value: GeographyScopes;
  labels: GeographyDisplayLabels;
  onCountriesChange: (countries: string[]) => void;
  onChange: (value: GeographyScopes) => void;
}) {
  const [open, setOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [groupKey, setGroupKey] = useState<(typeof ACQUISITION_COUNTRY_GROUPS)[number]["key"]>("EUROPE");
  const [expandedCountry, setExpandedCountry] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const totalCount = Object.values(value).reduce((sum, scopes) => sum + (scopes?.length || 0), 0);
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
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
    <button ref={triggerRef} type="button" aria-expanded={open} aria-controls="acquisition-geography-tree" onClick={() => setOpen(!open)} className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-blue-300">
      <span className="min-w-0 truncate">{countries.length ? `已选 ${countries.length} 个国家/地区 · ${totalCount ? `${totalCount} 处省市` : "全国搜索"}` : "选择国家 / 省州 / 城市"}</span><ChevronDown size={15} className={`shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}/>
    </button>
    {countries.length ? <div className="mt-2 flex flex-wrap gap-1.5">{countries.map((code) => <span key={code} className="rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-slate-700" title={(value[code as AcquisitionCountry] || []).map((scope) => selectedGeographyDisplayLabel(code, scope, labels)).join("、") || "全国搜索"}><CountryLabel value={code} className="!text-xs"/><span className="ml-1 text-blue-700">{value[code as AcquisitionCountry]?.length || "全国"}</span></span>)}</div> : null}
    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div id="acquisition-geography-tree" role="dialog" aria-label="选择国家省州城市" aria-modal="true" onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
        if (!elements.length) return;
        if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements[elements.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === elements[elements.length - 1]) { event.preventDefault(); elements[0].focus(); }
      }} className="flex h-[min(38rem,calc(100vh-1.5rem))] w-[min(56rem,100%)] min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
      <div className="border-b border-slate-100 p-3">
        <div className="flex items-center justify-between gap-2"><b className="text-sm text-slate-800">搜索地域</b><span className="text-xs text-slate-500">国家 {countries.length}/8 · 省市 {totalCount}/16</span></div>
        <label className="relative mt-2 block"><Search size={14} className="absolute left-3 top-2.5 text-slate-400"/><input autoFocus aria-label="搜索国家/地区" value={countryQuery} onChange={(event) => setCountryQuery(event.target.value)} placeholder="搜索国家/地区" className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-400"/></label>
        <div className="mt-2 flex flex-wrap gap-1" aria-label="洲别筛选">{ACQUISITION_COUNTRY_GROUPS.map((group) => <button key={group.key} type="button" aria-pressed={!normalizedQuery && group.key === groupKey} onClick={() => { setGroupKey(group.key); setCountryQuery(""); }} className={`rounded-md px-2 py-1 text-xs ${!normalizedQuery && group.key === groupKey ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>{group.label}</button>)}</div>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,8rem)_minmax(0,1fr)] divide-y divide-slate-100 sm:grid-rows-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:divide-x sm:divide-y-0" role="tree" aria-label="国家省州城市三级多选树">
        <div className="flex min-h-0 min-w-0 flex-col">
          <b className="border-b border-slate-100 px-3 py-2 text-xs text-slate-700">① 国家/地区</b>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">{orderedCodes.map((code) => {
          const selected = countries.includes(code);
          const expanded = expandedCountry === code && selected;
          const scopes = value[code as AcquisitionCountry] || [];
          return <div key={code} role="treeitem" aria-expanded={selected ? expanded : undefined} aria-selected={selected} className={`flex min-h-8 items-center rounded-md ${expanded ? "bg-blue-50" : "hover:bg-slate-50"}`}>
              <button type="button" role="checkbox" aria-checked={selected} aria-label={`选择${COUNTRY_NAMES.of(code) || code}`} disabled={!selected && countries.length >= 8} onClick={() => toggleCountry(code)} className="grid h-9 w-9 shrink-0 place-items-center disabled:opacity-40"><span className={`grid h-4 w-4 place-items-center rounded border ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>{selected ? <Check size={11}/> : null}</span></button>
              <button type="button" aria-current={expanded ? "true" : undefined} aria-label={`查看${COUNTRY_NAMES.of(code) || code}省州城市`} onClick={() => { if (!selected) toggleCountry(code); else setExpandedCountry(code); }} className="flex min-w-0 flex-1 items-center justify-between gap-1 py-1 pr-1 text-left text-xs"><span className="min-w-0 truncate"><CountryLabel value={code} className="!text-xs"/></span><span className="flex shrink-0 items-center gap-0.5 text-[11px] text-blue-700">{selected ? scopes.length ? `${scopes.length}处` : "全国" : ""}<ChevronRight size={12} className="text-slate-400"/></span></button>
          </div>;
        })}{!orderedCodes.length ? <p className="p-3 text-xs text-slate-500">没有匹配的国家/地区</p> : null}</div>
        </div>
        <div className="min-h-0 min-w-0">{expandedCountry && countries.includes(expandedCountry) ? <RegionTree key={expandedCountry} country={expandedCountry as AcquisitionCountry} scopes={value[expandedCountry as AcquisitionCountry] || []} totalCount={totalCount} onChange={(nextScopes) => { const next = { ...value }; if (nextScopes.length) next[expandedCountry as AcquisitionCountry] = nextScopes; else delete next[expandedCountry as AcquisitionCountry]; onChange(next); }}/> : <p className="p-3 text-xs text-slate-500">勾选或点击左侧国家，继续选择省/州与城市。</p>}</div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2"><p className="text-[11px] text-slate-500">未选择省市的国家按全国搜索；勾选整省与单选城市互斥。</p><button type="button" onClick={close} className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">完成</button></div>
      </div>
    </div> : null}
  </div>;
}
