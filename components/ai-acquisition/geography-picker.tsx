"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
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
  const [expanded, setExpanded] = useState(true);
  const [expandedRegion, setExpandedRegion] = useState("");
  const [regionQuery, setRegionQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingCities, setLoadingCities] = useState(false);
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
  }, [country, expandedRegion, citiesByRegion]);

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
    updateScopes(current.length ? scopes.filter((scope) => scope.regionCode !== code) : [...scopes, { regionCode: code, city: null }]);
    if (!current.length) setExpandedRegion(code);
  };
  const toggleCity = (code: string, name: string) => {
    const current = scopes.filter((scope) => scope.regionCode === code && scope.city !== null);
    const selected = current.some((scope) => scope.city === name);
    const nextCities = selected ? current.filter((scope) => scope.city !== name) : [...current, { regionCode: code, city: name }];
    updateScopes([...scopes.filter((scope) => scope.regionCode !== code), ...nextCities]);
  };

  return <section className="rounded-lg border border-slate-200 bg-white p-3">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} className="flex w-full items-center justify-between gap-2 text-left">
      <CountryLabel value={country}/><span className="flex items-center gap-2 text-xs text-slate-500">{scopes.length ? `已限定 ${scopes.length} 处` : "未限定：按全国分片搜索"}<ChevronDown size={15} className={expanded ? "rotate-180" : ""}/></span>
    </button>
    {expanded ? <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      {loading ? <p className="text-xs text-slate-500">正在加载省州与城市…</p> : null}
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
      {limitMessage ? <p role="alert" className="text-xs text-amber-700">{limitMessage}</p> : null}
      {!loading && !regions.length ? <p className="text-xs text-amber-700">该地区暂无可靠省州—城市索引，仅能按全国检索。</p> : null}
      {regions.length ? <>
        <label className="relative block"><Search size={15} className="absolute left-3 top-2.5 text-slate-400"/><input aria-label={`${country}搜索省州`} value={regionQuery} onChange={(event) => setRegionQuery(event.target.value)} placeholder="搜索省/州，可多选" className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-400"/></label>
        <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1" role="group" aria-label={`${country}省州多选`}>
          {visibleRegions.map((region) => {
            const selected = scopes.filter((scope) => scope.regionCode === region.code);
            const wholeRegion = selected.some((scope) => scope.city === null);
            const open = expandedRegion === region.code;
            const cityOptions = citiesByRegion[region.code] || [];
            const query = cityQuery.trim().toLocaleLowerCase();
            const visibleCities = query ? cityOptions.filter((item) => `${item.displayName} ${item.name}`.toLocaleLowerCase().includes(query)) : cityOptions;
            return <div key={region.code} className={`rounded-lg border ${selected.length ? "border-blue-200 bg-blue-50/40" : "border-slate-100"}`}>
              <div className="flex min-w-0 items-center gap-1">
                <button type="button" role="checkbox" aria-checked={wholeRegion ? "true" : selected.length ? "mixed" : "false"} aria-label={`选择${region.displayName}`} onClick={() => toggleRegion(region.code)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm text-slate-700">
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${selected.length ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>{selected.length ? <Check size={12}/> : null}</span>
                  <span className="min-w-0 flex-1 truncate" title={region.displayName}>{region.displayName}</span>
                  {selected.length ? <small className="shrink-0 text-blue-700">{wholeRegion ? "整个省/州" : `${selected.length} 个城市`}</small> : null}
                </button>
                <button type="button" aria-label={`${open ? "收起" : "展开"}${region.displayName}城市`} aria-expanded={open} onClick={() => { setExpandedRegion(open ? "" : region.code); setCityQuery(""); }} className="rounded-md px-2 py-2 text-xs text-blue-700 hover:bg-blue-50">城市 <ChevronDown size={14} className={`inline ${open ? "rotate-180" : ""}`}/></button>
              </div>
              {open ? <div className="border-t border-slate-100 p-2.5">
                {!selected.length ? <p className="text-xs text-slate-500">先勾选此省/州，再多选城市。</p> : <>
                  <button type="button" onClick={() => updateScopes([...scopes.filter((scope) => scope.regionCode !== region.code), { regionCode: region.code, city: null }])} className={`mb-2 rounded-md px-2 py-1 text-xs ${wholeRegion ? "bg-blue-600 text-white" : "bg-white text-blue-700 hover:bg-blue-50"}`}>整个省/州</button>
                  {loadingCities ? <p className="text-xs text-slate-500">正在加载城市…</p> : null}
                  {cityOptions.length ? <><input aria-label={`${country}${region.name}搜索城市`} value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder="搜索城市，可多选" className="mb-2 h-8 w-full rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-400"/>
                    {visibleCities.length > 80 ? <p className="mb-1 text-xs text-slate-500">显示前 80 个地点；输入名称可搜索全部 {cityOptions.length} 个地点。</p> : null}
                    <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3" role="group" aria-label={`${region.displayName}城市多选`}>{visibleCities.slice(0, 80).map((item) => {
                      const checked = selected.some((scope) => scope.city === item.name);
                      return <button key={item.name} type="button" role="checkbox" aria-checked={checked} onClick={() => toggleCity(region.code, item.name)} className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs ${checked ? "bg-blue-100 text-blue-800" : "hover:bg-slate-50"}`}><span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>{checked ? <Check size={10}/> : null}</span><span className="truncate" title={item.displayName}>{item.displayName}</span></button>;
                    })}</div></> : null}
                </>}
              </div> : null}
            </div>;
          })}
          {!visibleRegions.length ? <p className="py-4 text-center text-xs text-slate-500">没有匹配的省/州</p> : null}
        </div>
      </> : null}
    </div> : null}
  </section>;
}

export function GeographyPicker({ countries, value, onChange }: {
  countries: string[];
  value: GeographyScopes;
  onChange: (value: GeographyScopes) => void;
}) {
  const count = Object.values(value).reduce((sum, scopes) => sum + (scopes?.length || 0), 0);
  if (!countries.length) return null;
  return <div className="mt-3 space-y-2">
    <p className="text-xs leading-5 text-slate-500">按国家→省/州→城市逐级多选。仅有可靠中文译名的地点显示中文与原文，其余保留原文供核对；选定地域后只搜索该范围。每国最多8处，单任务最多16处。地域索引：<a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className="text-blue-700 underline">GeoNames</a>（CC BY 4.0）。</p>
    <div className="grid gap-2 lg:grid-cols-2">{countries.map((country) => <CountryGeography key={country} country={country as AcquisitionCountry} scopes={value[country as AcquisitionCountry] || []} totalCount={count} onChange={(scopes) => {
      const next = { ...value };
      if (scopes.length) next[country as AcquisitionCountry] = scopes;
      else delete next[country as AcquisitionCountry];
      onChange(next);
    }}/>)}</div>
    {count >= 16 ? <p className="text-xs text-amber-700">已达到单任务16处地域上限；如需更多地域，请拆分任务。</p> : null}
  </div>;
}
