import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { dedupeVerifiedContactRows } from "@/lib/ai/contact-intelligence";
import { canReadAiOwner } from "@/lib/ai/owner-scope";

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
  const originalExcerpt = typeof row.original_excerpt === "string" && row.original_excerpt.trim()
    ? row.original_excerpt.replace(/\s+/g, " ").trim().slice(0, 320)
    : null;
  return {
    id: row.id,
    channel,
    source_type: CHANNEL_LABELS[channel] || "公开信息来源",
    source_url: typeof row.source_url === "string" ? row.source_url : null,
    title: `${CHANNEL_LABELS[channel] || "公开信息"}关键依据`,
    content: readableFact(row),
    original_excerpt: originalExcerpt,
    evidence_type: row.evidence_type === "支持" || row.evidence_type === "矛盾" ? row.evidence_type : "中性",
    evidence_confidence: typeof row.evidence_confidence === "number" ? row.evidence_confidence : null,
    identity_match_label: MATCH_LABELS[matchStatus] || "主体待核验",
    media_urls: mediaUrls,
    fetched_at: row.captured_at || row.fetched_at || null,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ customerId: string }> }) {
  try {
    const { user, account } = await requirePermission("ai.results.view");
    const { customerId } = await context.params;
    const admin = createAdminClient();
    const requestedTaskId = request.nextUrl.searchParams.get("task")?.trim() || "";
    const customer = await admin.from("customers").select("id,owner_id,created_by,company_name,contact_name,country,phone,whatsapp,email,website,google_url,facebook_url,instagram_url,linkedin_url,tiktok_url,website_email,website_phone,ai_score,ai_level,ai_reason,ai_screening_done,business_relevance,business_scope,company_scale,company_scale_evidence,customer_value,followup_suggestion").eq("id", customerId).maybeSingle();
    if (customer.error) throw customer.error;
    if (!customer.data) throw new Error("CUSTOMER_NOT_FOUND");
    if (requestedTaskId) {
      const task = await admin.from("ai_screening_tasks").select("id,user_id").eq("id", requestedTaskId).maybeSingle();
      if (task.error) throw task.error;
      if (!task.data) throw new Error("TASK_NOT_FOUND");
      if (!await canReadAiOwner(account, task.data.user_id)) throw new Error("FORBIDDEN");
      const item = await admin.from("ai_screening_task_items").select("id").eq("task_id", requestedTaskId).eq("customer_id", customerId).maybeSingle();
      if (item.error) throw item.error;
      if (!item.data) throw new Error("TASK_CUSTOMER_MISMATCH");
    } else {
      const ownRecord = customer.data.owner_id === user.id || customer.data.created_by === user.id;
      const canReadOwner = hasPermission(account, "ai.data_all") && (
        await canReadAiOwner(account, customer.data.owner_id)
        || await canReadAiOwner(account, customer.data.created_by)
      );
      if (!ownRecord && !canReadOwner) throw new Error("FORBIDDEN");
    }
    let resultQuery = admin.from("ai_screening_results").select("*,task:ai_screening_tasks(id,name,task_number,user_id)").eq("customer_id", customerId).eq("writeback_status", "COMPLETED");
    if (requestedTaskId) resultQuery = resultQuery.eq("task_id", requestedTaskId);
    else resultQuery = resultQuery.eq("is_latest_valid", true);
    const result = await resultQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw result.error;
    const evidence = result.data ? await admin.from("ai_screening_evidence").select("*").eq("result_id", result.data.id).order("fetched_at", { ascending: false }) : { data: [], error: null };
    if (evidence.error) throw evidence.error;
    const contacts = await admin.from("customer_contacts")
      .select("id,type,value_raw,value_normalized,source_channel,exact_source_url,source_page_title,captured_at,identity_match_status,verification_status,contact_status")
      .eq("customer_id", customerId)
      .in("verification_status", ["MATCHED_ORIGINAL", "NEW_VERIFIED", "CONFLICTING_VERIFIED"])
      .order("captured_at", { ascending: false });
    if (contacts.error) throw contacts.error;
    return NextResponse.json({
      customer: customer.data,
      result: result.data || null,
      evidence: (evidence.data || [])
        .map((row) => normalizeEvidence(row as Record<string, unknown>))
        .filter(isUsableEvidence),
      verified_contacts: dedupeVerifiedContactRows(contacts.data || []),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI分析依据查询失败";
    const publicMessage = message === "CUSTOMER_NOT_FOUND" ? "客户不存在或已被删除"
      : message === "TASK_NOT_FOUND" ? "AI筛选任务不存在或已归档"
        : message === "TASK_CUSTOMER_MISMATCH" ? "该客户不属于当前AI筛选任务"
          : message === "FORBIDDEN" ? "无权查看该客户的AI分析依据"
            : message === "UNAUTHORIZED" ? "登录已失效，请重新登录"
              : "AI分析依据暂时无法加载，请稍后重试";
    if (!["CUSTOMER_NOT_FOUND", "TASK_NOT_FOUND", "TASK_CUSTOMER_MISMATCH", "FORBIDDEN", "UNAUTHORIZED"].includes(message)) console.error("[ai-evidence] load failed", { message });
    return NextResponse.json({ error: publicMessage }, { status: ["CUSTOMER_NOT_FOUND", "TASK_NOT_FOUND", "TASK_CUSTOMER_MISMATCH"].includes(message) ? 404 : authErrorStatus(message) });
  }
}

