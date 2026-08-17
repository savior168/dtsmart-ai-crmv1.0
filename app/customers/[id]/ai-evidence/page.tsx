"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";

type Evidence = { website?: { url?: string; title?: string; description?: string; headings?: string[]; important_pages?: Array<{ url: string; title?: string }>; image_alts?: string[]; image_urls?: string[]; video_urls?: string[]; emails?: string[]; phones?: string[] }; google_maps?: { name?: string; address?: string; business_status?: string; rating?: number; review_count?: number; categories?: string[]; reviews?: string[] } };

export default function AiEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const [evidence, setEvidence] = useState<Evidence>(); const [error, setError] = useState("");
  useEffect(() => { fetch(`/api/customers/${id}/crm`).then(async (res) => { const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || "加载失败"); return body; }).then((body) => setEvidence(body.ai_evidence?.content?.evidence)).catch((reason: Error) => setError(reason.message)); }, [id]);
  if (error) return <main className="p-6"><p className="rounded-lg bg-rose-50 p-4 text-rose-700">{error}</p></main>;
  if (!evidence) return <main className="grid min-h-[60vh] place-items-center"><LoaderCircle className="animate-spin text-blue-600"/></main>;
  const site=evidence.website; const maps=evidence.google_maps;
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-6xl"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-500">客户详情 / AI 分析</p><h1 className="mt-2 text-3xl font-bold">AI 评分依据</h1></div><Link href={`/customers/${id}`} className="rounded-lg border bg-white px-4 py-2 text-sm">返回客户详情</Link></div><p className="mt-3 text-sm text-slate-500">以下为本次评分读取到的公开信息摘要，用于人工核对；不是模型臆测内容。</p><div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="rounded-xl border bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">官网及重要页面证据</h2><p className="mt-4 break-all text-blue-600">{site?.url||"未提供官网"}</p><p className="mt-3"><b>页面标题：</b>{site?.title||"-"}</p><p className="mt-3 whitespace-pre-wrap leading-7"><b>业务描述：</b>{site?.description||"-"}</p><List label="关键标题" items={site?.headings}/><List label="重要页面" items={site?.important_pages?.map((item)=>item.title||item.url)}/><List label="图片线索" items={site?.image_alts}/><List label="视频链接" items={site?.video_urls}/><List label="发现的邮箱" items={site?.emails}/><List label="发现的电话" items={site?.phones}/></section><section className="rounded-xl border bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">Google Maps 证据</h2><p className="mt-4"><b>商家：</b>{maps?.name||"未获取"}</p><p className="mt-3"><b>地址：</b>{maps?.address||"未获取"}</p><p className="mt-3"><b>营业状态：</b>{maps?.business_status||"未获取"}</p><p className="mt-3"><b>分类：</b>{maps?.categories?.join("、")||"未获取"}</p><p className="mt-3"><b>评分 / 评论数：</b>{maps?.rating??"-"} / {maps?.review_count??"-"}</p><List label="评论摘要" items={maps?.reviews}/></section></div></div></main>;
}
function List({label,items}:{label:string;items?:string[]}){if(!items?.length)return null;return <div className="mt-4"><b>{label}：</b><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{items.map((item,index)=><li className="break-all" key={`${item}-${index}`}>{item}</li>)}</ul></div>}
