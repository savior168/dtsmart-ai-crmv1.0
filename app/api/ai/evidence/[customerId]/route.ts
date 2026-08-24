import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

const CHANNEL_LABELS: Record<string, string> = {
  website: "企业官网",
  google_maps: "谷歌地图商家页",
  linkedin: "领英企业页",
  facebook: "脸书商家页",
  instagram: "照片墙商家页",
  tiktok: "短视频商家页",
  other: "其他公开来源",
};

const MATCH_LABELS: Record<string, string> = {
  matched: "主体一致",
  MATCHED: "主体一致",
  likely_matched: "主体基本一致",
  LIKELY_MATCHED: "主体基本一致",
  unverified: "主体待核验",
  AMBIGUOUS: "主体待核验",
  CONFLICTED: "主体冲突",
  NOT_FOUND: "主体未定位",
};

function hasChinese(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}

function readableFact(row: Record<string, unknown>) {
  const translated = typeof row.translated_fact === "string" ? row.translated_fact.trim() : "";
  if (translated && hasChinese(translated) && !translated.startsWith("{") && !translated.startsWith("[")) return translated;
  const normalized = typeof row.normalized_fact === "string" ? row.normalized_fact.trim() : "";
  if (normalized && hasChinese(normalized) && !normalized.startsWith("{") && !normalized.startsWith("[")) return normalized;
  const content = typeof row.content === "string" ? row.content.trim() : "";
  if (content && hasChinese(content) && !content.startsWith("{") && !content.startsWith("[")) return content;
  return "";
}

function isUsableEvidence(row: ReturnType<typeof normalizeEvidence>) {
  return Boolean(row.content)
    && /[\u3400-\u9fff]/.test(row.content)
    && !/读取失败|未能取得|未保存|请重新执行|GOOGLE_MAPS_API_KEY|fetch failed/i.test(row.content)
    && Boolean(row.source_url && /^https?:\/\//i.test(row.source_url));
}

function normalizeEvidence(row: Record<string, unknown>) {
  const channel = typeof row.channel === "string" ? row.channel : typeof row.source_type === "string" ? row.source_type : "other";
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {};
  const mediaUrls = Array.isArray(metadata.media_urls) ? metadata.media_urls.filter((item): item is string => typeof item === "string" && /^https?:\/\//i.test(item)) : [];
  const matchStatus = typeof row.identity_match_status === "string" ? row.identity_match_status : "unverified";
  return {
    id: row.id,
    source_type: CHANNEL_LABELS[channel] || "公开信息来源",
    source_url: typeof row.source_url === "string" ? row.source_url : null,
    title: `${CHANNEL_LABELS[channel] || "公开信息"}关键依据`,
    content: readableFact(row),
    evidence_type: row.evidence_type === "支持" || row.evidence_type === "矛盾" ? row.evidence_type : "中性",
    evidence_confidence: typeof row.evidence_confidence === "number" ? row.evidence_confidence : null,
    identity_match_label: MATCH_LABELS[matchStatus] || "主体待核验",
    media_urls: mediaUrls,
    fetched_at: row.captured_at || row.fetched_at || null,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ customerId: string }> }) {
  try {
    const { supabase, user } = await requireUser();
    const { customerId } = await context.params;
    const visible = await supabase.from("customers").select("id,company_name,contact_name,country,phone,email,website,google_url,website_email,website_phone,ai_score,ai_level,ai_reason,business_relevance,customer_value,followup_suggestion").eq("id", customerId).single();
    if (visible.error || !visible.data) throw visible.error || new Error("客户不存在或无权访问");
    const admin = createAdminClient();
    const requestedTaskId = request.nextUrl.searchParams.get("task")?.trim() || "";
    let resultQuery = admin.from("ai_screening_results").select("*,task:ai_screening_tasks(id,name,task_number,user_id)").eq("customer_id", customerId);
    if (requestedTaskId) resultQuery = resultQuery.eq("task_id", requestedTaskId);
    const result = await resultQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw result.error;
    const task = result.data ? (Array.isArray(result.data.task) ? result.data.task[0] : result.data.task) : null;
    if (task && task.user_id !== user.id) throw new Error("无权查看该客户的AI分析依据");
    const evidence = result.data ? await admin.from("ai_screening_evidence").select("*").eq("result_id", result.data.id).order("fetched_at", { ascending: false }) : { data: [], error: null };
    if (evidence.error) throw evidence.error;
    const contacts = await admin.from("customer_contacts")
      .select("id,type,value_raw,value_normalized,source_channel,exact_source_url,source_page_title,captured_at,identity_match_status,verification_status,contact_status")
      .eq("customer_id", customerId)
      .order("captured_at", { ascending: false });
    if (contacts.error) throw contacts.error;
    return NextResponse.json({
      customer: visible.data,
      result: result.data || null,
      evidence: (evidence.data || [])
        .map((row) => normalizeEvidence(row as Record<string, unknown>))
        .filter(isUsableEvidence),
      verified_contacts: contacts.data || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI分析依据查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
