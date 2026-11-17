"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { AppSelect } from "@/components/ui/app-select";
import { button } from "@/components/ai-screening/ui";
import { CountryLabel } from "@/components/country-label";
import type { GeographyScope, GeographyScopes } from "@/lib/ai-acquisition/geography";
import type { AcquisitionCountry } from "@/lib/ai-acquisition/config";

type RegionOption = { code: string; name: string };

function CountryGeography({ country, scopes, onChange }: {
  country: AcquisitionCountry;
  scopes: GeographyScope[];
  onChange: (value: GeographyScope[]) => void;
}) {
  const [regions, setRegions] = useState<RegionOption[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [regionCode, setRegionCode] = useState("");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/ai-acquisition/geography?country=${encodeURIComponent(country)}`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "地域加载失败"); return body; })
      .then((body) => { setRegions(body.regions || []); setError(""); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "地域加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [country]);
  useEffect(() => {
    setCities([]);
    if (!regionCode) return;
    const controller = new AbortController();
    fetch(`/api/ai-acquisition/geography?country=${encodeURIComponent(country)}&region=${encodeURIComponent(regionCode)}`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "城市加载失败"); return body; })
      .then((body) => { setCities(body.cities || []); setError(""); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "城市加载失败"); });
    return () => controller.abort();
  }, [country, regionCode]);
  const add = () => {
    if (!regionCode || scopes.length >= 8 || scopes.some((scope) => scope.regionCode === regionCode && scope.city === (city || null))) return;
    onChange([...scopes, { regionCode, city: city || null }]);
    setCity("");
  };
  return <div className="rounded-lg border border-slate-200 bg-white p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><CountryLabel value={country}/><span className="text-xs text-slate-500">{scopes.length ? `已限定 ${scopes.length} 处` : "未限定：按全国分片搜索"}</span></div>
    {loading ? <p className="mt-2 text-xs text-slate-500">正在加载省州与城市…</p> : null}
    {error ? <p role="alert" className="mt-2 text-xs text-red-600">{error}</p> : null}
    {!loading && !regions.length ? <p className="mt-2 text-xs text-amber-700">该地区暂无可靠省州—城市索引，仅能按全国检索。</p> : null}
    {regions.length ? <div className="mt-2 flex flex-wrap items-center gap-2">
      <AppSelect aria-label={`${country}省州`} value={regionCode} onChange={(event) => { setRegionCode(event.target.value); setCity(""); }} className="min-w-44 flex-1"><option value="">选择省/州（可选）</option>{regions.map((region) => <option key={region.code} value={region.code}>{region.name}</option>)}</AppSelect>
      <AppSelect aria-label={`${country}城市`} value={city} onChange={(event) => setCity(event.target.value)} disabled={!regionCode} className="min-w-44 flex-1"><option value="">整个省/州</option>{cities.map((name) => <option key={name} value={name}>{name}</option>)}</AppSelect>
      <button type="button" className={button} onClick={add} disabled={!regionCode || scopes.length >= 8}><Plus size={14}/>加入地域</button>
    </div> : null}
    {scopes.length ? <div className="mt-2 flex flex-wrap gap-1.5">{scopes.map((scope) => { const region = regions.find((item) => item.code === scope.regionCode); return <button key={`${scope.regionCode}:${scope.city || ""}`} type="button" aria-label={`移除${scope.city || region?.name || "地域"}`} onClick={() => onChange(scopes.filter((item) => item !== scope))} className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">{scope.city ? `${region?.name || scope.regionCode} · ${scope.city}` : region?.name || scope.regionCode}<X size={12}/></button>; })}</div> : null}
  </div>;
}

export function GeographyPicker({ countries, value, onChange }: {
  countries: string[];
  value: GeographyScopes;
  onChange: (value: GeographyScopes) => void;
}) {
  const count = Object.values(value).reduce((sum, scopes) => sum + (scopes?.length || 0), 0);
  if (!countries.length) return null;
  return <div className="space-y-2">
    <div><h3 className="text-sm font-medium text-slate-800">精确到省/州、城市 <span className="font-normal text-slate-500">（可选）</span></h3><p className="mt-1 text-xs leading-5 text-slate-500">不选择时按国家自动分片；选择后仅搜索所选地域，并用返回地址复核。每国最多8处，单任务最多16处。地域索引：<a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className="text-blue-700 underline">GeoNames</a>（CC BY 4.0）。</p></div>
    <div className="grid gap-2 lg:grid-cols-2">{countries.map((country) => <CountryGeography key={country} country={country as AcquisitionCountry} scopes={value[country as AcquisitionCountry] || []} onChange={(scopes) => {
      const next = { ...value };
      if (scopes.length) next[country as AcquisitionCountry] = scopes;
      else delete next[country as AcquisitionCountry];
      onChange(next);
    }}/>)}</div>
    {count >= 16 ? <p className="text-xs text-amber-700">已达到单任务16处地域上限；如需更多地域，请拆分任务。</p> : null}
  </div>;
}
