"use client";

import { Plus, Trash2 } from "lucide-react";

export type SocialPlatform = "facebook" | "instagram" | "tiktok" | "youtube" | "linkedin" | "x" | "other";
export type SocialLinkRow = { id: string; platform: SocialPlatform; url: string };

const labels: Record<SocialPlatform, string> = {
  facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube",
  linkedin: "LinkedIn", x: "X（Twitter）", other: "其他社媒",
};

export function CustomerSocialLinksEditor({ rows, onChange }: { rows: SocialLinkRow[]; onChange: (rows: SocialLinkRow[]) => void }) {
  const update = (id: string, patch: Partial<SocialLinkRow>) => onChange(rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  return <fieldset className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
    <div className="flex items-center justify-between gap-3"><div><legend className="text-sm font-semibold text-slate-800">社媒主页</legend><p className="mt-1 text-xs text-slate-500">选择平台并填写企业主页链接；系统按平台和规范化网址去重。</p></div><button type="button" onClick={()=>onChange([...rows,{id:crypto.randomUUID(),platform:"facebook",url:""}])} className="inline-flex h-9 items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 text-xs font-medium text-blue-700 hover:bg-blue-50"><Plus size={14}/>添加</button></div>
    <div className="mt-3 space-y-2">{rows.map((row)=><div key={row.id} className="grid grid-cols-[150px_minmax(0,1fr)_36px] gap-2"><select aria-label="社媒平台" value={row.platform} onChange={event=>update(row.id,{platform:event.target.value as SocialPlatform})} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm">{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><input type="url" value={row.url} onChange={event=>update(row.id,{url:event.target.value})} placeholder="https://..." className="h-10 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/><button type="button" aria-label="删除社媒链接" onClick={()=>onChange(rows.filter((item)=>item.id!==row.id))} className="grid h-10 w-9 place-items-center rounded-lg border border-rose-100 bg-white text-rose-600 hover:bg-rose-50"><Trash2 size={15}/></button></div>)}</div>
  </fieldset>;
}
