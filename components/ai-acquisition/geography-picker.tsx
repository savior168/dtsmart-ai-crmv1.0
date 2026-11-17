"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Search } from "lucide-react";
import { CountryLabel } from "@/components/country-label";
import type { GeographyScope, GeographyScopes } from "@/lib/ai-acquisition/geography";
import type { AcquisitionCountry } from "@/lib/ai-acquisition/config";

type RegionOption = { code: string; name: string; displayName: string };
type CityOption = { name: string; displayName: string };

function CountryGeography({ country, scopes, totalCount, onChange }: {
  country: AcquisitionCountry;
  scopes: GeographyScope[];
  totalCount: number;
  onChange: (value: GeographyScope[]) => void;
}) {
  const [regions, setRegions] = useState<RegionOption[]>([]);
  const [citiesByRegion, setCitiesByRegion] = useState<Record<string, CityOption[]>>({});
  const [expandedRegion, setExpandedRegion] = useState(scopes[0]?.regionCode || "");
  const [regionQuery, setRegionQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingCities, setLoadingCities] = useState(false);
  const [cityRetry, setCityRetry] = useState(0);
  const [error, setError] = useState("");
  const [limitMessage, setLimitMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/ai-acquisition/geography?country=${encodeURIComponent(country)}`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "地域加载失败"); return body; })
      .then((body) => { setRegions(body.regions || []); setError(""); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "地域加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [country]);

  useEffect(() => {
    if (!expandedRegion || citiesByRegion[expandedRegion]) return;
    const controller = new AbortController();
    setLoadingCities(true);
    fetch(`/api/ai-acquisition/geography?country=${encodeURIComponent(country)}&region=${encodeURIComponent(expandedRegion)}`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "城市加载失败"); return body; })
      .then((body) => { setCitiesByRegion((current) => ({ ...current, [expandedRegion]: body.cities || [] })); setError(""); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "城市加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoadingCities(false); });
    return () => controller.abort();
  }, [country, expandedRegion, citiesByRegion, cityRetry]);

  const visibleRegions = useMemo(() => {
    const query = regionQuery.trim().toLocaleLowerCase();
    return query ? regions.filter((region) => `${region.displayName} ${region.name}`.toLocaleLowerCase().includes(query)) : regions;
  }, [regions, regionQuery]);

  const updateScopes = (next: GeographyScope[]) => {
    if (next.length > 8 || totalCount - scopes.length + next.length > 16) {
      setLimitMessage("每国最多8处、单任务最多16处；请移除已有地域或拆分任务。");
      return;
    }
    setLimitMessage("");
    onChange(next);
  };
  const toggleRegion = (code: string) => {
    const current = scopes.filter((scope) => scope.regionCode === code);
    const whole = current.some((scope) => scope.city === null);
    updateScopes([...scopes.filter((scope) => scope.regionCode !== code), ...(!whole ? [{ regionCode: code, city: null }] : [])]);
    setExpandedRegion(code);
    setCityQuery("");
  };
  const toggleCity = (code: string, name: string) => {
    const current = scopes.filter((scope) => scope.regionCode === code && scope.city !== null);
    const selected = current.some((scope) => scope.city === name);
    const nextCities = selected ? current.filter((scope) => scope.city !== name) : [...current, { regionCode: code, city: name }];
    updateScopes([...scopes.filter((scope) => scope.regionCode !== code), ...nextCities]);
  };
  const activeOption = regions.find((region) => region.code === expandedRegion);
  const activeScopes = scopes.filter((scope) => scope.regionCode === expandedRegion);
  const wholeActiveRegion = activeScopes.some((scope) => scope.city === null);
  const activeCityOptions = citiesByRegion[expandedRegion] || [];
  const citySearch = cityQuery.trim().toLocaleLowerCase();
  const visibleCities = citySearch ? activeCityOptions.filter((city) => `${city.displayName} ${city.name}`.toLocaleLowerCase().includes(citySearch)) : activeCityOptions;

  return <section role="tabpanel" id="geography-country-panel" aria-label={`${country}省州与城市`} className="rounded-b-xl border border-t-0 border-slate-200 bg-white p-3">
    <div className="space-y-2">
      {loading ? <p className="text-xs text-slate-500">正在加载省州与城市…</p> : null}
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
      {limitMessage ? <p role="alert" className="text-xs text-amber-700">{limitMessage}</p> : null}
      {!loading && !regions.length ? <p className="text-xs text-amber-700">该地区暂无可靠省州—城市索引，仅能按全国检索。</p> : null}
      {regions.length ? <div className="grid gap-3 md:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
        <div className="min-w-0">
          <label className="relative block"><Search size={14} className="absolute left-2.5 top-2.5 text-slate-400"/><input aria-label={`${country}搜索省州`} value={regionQuery} onChange={(event) => setRegionQuery(event.target.value)} placeholder="搜索省/州" className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-xs outline-none focus:border-blue-400"/></label>
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1" role="group" aria-label={`${country}省州多选`}>
            {visibleRegions.map((region) => {
              const selected = scopes.filter((scope) => scope.regionCode === region.code);
              const whole = selected.some((scope) => scope.city === null);
              return <div key={region.code} className={`flex min-w-0 items-center rounded-lg border ${expandedRegion === region.code ? "border-blue-300 bg-blue-50" : "border-slate-100 hover:bg-slate-50"}`}>
                <button type="button" role="checkbox" aria-checked={whole ? "true" : selected.length ? "mixed" : "false"} aria-label={`选择整个${region.displayName}`} onClick={() => toggleRegion(region.code)} className="grid h-8 w-8 shrink-0 place-items-center"><span className={`grid h-4 w-4 place-items-center rounded border ${selected.length ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>{selected.length ? <Check size={11}/> : null}</span></button>
                <button type="button" aria-label={`查看${region.displayName}城市`} aria-current={expandedRegion === region.code ? "true" : undefined} onClick={() => { setExpandedRegion(region.code); setCityQuery(""); }} className="flex min-w-0 flex-1 items-center gap-1 py-1.5 pr-2 text-left text-xs text-slate-700"><span className="min-w-0 flex-1 truncate" title={region.displayName}>{region.displayName}</span>{selected.length ? <span className="shrink-0 text-[11px] text-blue-700">{whole ? "全省" : `${selected.length}城`}</span> : null}<ChevronRight size={13} className="shrink-0 text-slate-400"/></button>
              </div>;
            })}
            {!visibleRegions.length ? <p className="py-4 text-center text-xs text-slate-500">没有匹配的省/州</p> : null}
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
          {activeOption ? <>
            <div className="mb-2 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-xs font-medium text-slate-700" title={activeOption.displayName}>{activeOption.displayName} · 城市</span><button type="button" onClick={() => updateScopes([...scopes.filter((scope) => scope.regionCode !== expandedRegion), { regionCode: expandedRegion, city: null }])} className={`shrink-0 rounded-md px-2 py-1 text-[11px] ${wholeActiveRegion ? "bg-blue-600 text-white" : "border border-blue-200 bg-white text-blue-700 hover:bg-blue-50"}`}>整个省/州</button></div>
            <label className="relative block"><Search size={14} className="absolute left-2.5 top-2.5 text-slate-400"/><input aria-label={`${country}${activeOption.name}搜索城市`} value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder="搜索城市，可直接多选" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs outline-none focus:border-blue-400"/></label>
            {loadingCities ? <p className="py-4 text-xs text-slate-500">正在加载城市…</p> : null}
            {!loadingCities && error ? <button type="button" onClick={() => setCityRetry((count) => count + 1)} className="my-2 text-xs text-blue-700 underline">重试加载城市</button> : null}
            {!loadingCities && !error && !activeCityOptions.length ? <p className="py-4 text-xs text-slate-500">暂无城市索引，可选择整个省/州。</p> : null}
            {visibleCities.length > 80 ? <p className="mt-1 text-[11px] text-slate-500">显示前 80 个；搜索可找到全部 {activeCityOptions.length} 个城市。</p> : null}
            <div className="mt-2 grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2" role="group" aria-label={`${activeOption.displayName}城市多选`}>{visibleCities.slice(0, 80).map((city) => {
              const checked = activeScopes.some((scope) => scope.city === city.name);
              return <button key={city.name} type="button" role="checkbox" aria-checked={checked} onClick={() => toggleCity(expandedRegion, city.name)} className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs ${checked ? "border-blue-200 bg-blue-100 text-blue-800" : "border-transparent bg-white text-slate-700 hover:border-slate-200"}`}><span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>{checked ? <Check size={10}/> : null}</span><span className="truncate" title={city.displayName}>{city.displayName}</span></button>;
            })}</div>
            {!loadingCities && citySearch && !visibleCities.length ? <p className="py-4 text-center text-xs text-slate-500">没有匹配的城市</p> : null}
          </> : <p className="grid min-h-32 place-items-center text-center text-xs text-slate-500">点击左侧省/州查看城市，或勾选整个省/州。</p>}
        </div>
      </div> : null}
    </div>
  </section>;
}

export function GeographyPicker({ countries, value, onChange }: {
  countries: string[];
  value: GeographyScopes;
  onChange: (value: GeographyScopes) => void;
}) {
  const [activeCountry, setActiveCountry] = useState("");
  const previousCountries = useRef(countries);
  useEffect(() => {
    const added = countries.find((code) => !previousCountries.current.includes(code));
    if (added) setActiveCountry(added);
    previousCountries.current = countries;
  }, [countries]);
  const currentCountry = countries.includes(activeCountry) ? activeCountry : countries[0];
  const count = Object.values(value).reduce((sum, scopes) => sum + (scopes?.length || 0), 0);
  if (!currentCountry) return null;
  const country = currentCountry as AcquisitionCountry;
  return <div className="mt-2">
    <div role="tablist" aria-label="选择国家并设置省州城市" className="flex flex-wrap gap-1 rounded-t-xl border border-slate-200 bg-slate-50 p-1.5">{countries.map((code) => {
      const selected = code === currentCountry;
      const scoped = value[code as AcquisitionCountry]?.length || 0;
      return <button key={code} type="button" role="tab" aria-selected={selected} aria-controls={selected ? "geography-country-panel" : undefined} onClick={() => setActiveCountry(code)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${selected ? "bg-white font-medium text-blue-700 shadow-sm ring-1 ring-blue-200" : "text-slate-600 hover:bg-white"}`}><CountryLabel value={code}/><span className={`rounded-full px-1.5 text-[11px] ${scoped ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{scoped || "全国"}</span></button>;
    })}</div>
    <CountryGeography key={country} country={country} scopes={value[country] || []} totalCount={count} onChange={(scopes) => {
      const next = { ...value };
      if (scopes.length) next[country] = scopes;
      else delete next[country];
      onChange(next);
    }}/>
    <p className="mt-1.5 text-[11px] leading-5 text-slate-500">按国家→省/州→城市多选；未限定的国家按全国搜索。每国最多8处，单任务最多16处。中文名称仅展示已核实译名，其余保留原文。地域索引：<a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className="text-blue-700 underline">GeoNames</a>；补充译名：<a href="https://github.com/unicode-org/cldr" target="_blank" rel="noreferrer" className="text-blue-700 underline">Unicode CLDR</a>。</p>
    {count >= 16 ? <p className="text-xs text-amber-700">已达到单任务16处地域上限；如需更多地域，请拆分任务。</p> : null}
  </div>;
}
