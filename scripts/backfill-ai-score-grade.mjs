import { createClient } from "@supabase/supabase-js";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) throw new Error(`缺少环境变量：${key}`);
}

const apply = process.argv.includes("--apply");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data, error } = await db
  .from("ai_screening_results")
  .select("id,customer_id,score,grade,confidence_score,customer_type,industry_type,evidence_sufficiency,target_fit,lead_priority,decision_status,manual_review_status,is_latest_valid,created_at")
  .or("score.is.null,grade.is.null")
  .order("created_at", { ascending: true })
  .limit(5000);

if (error) throw error;
const rows = data || [];
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", pending: rows.length }, null, 2));

let resultUpdates = 0;
let customerUpdates = 0;
for (const row of apply ? rows : []) {
  const confidence = Number(row.confidence_score);
  const score = Number.isFinite(confidence)
    ? Math.max(5, Math.min(39, Math.round(confidence * 0.4)))
    : 20;
  const industry = row.industry_type || row.customer_type || "其他";
  const { error: resultError } = await db.from("ai_screening_results").update({
    score,
    grade: "D",
    customer_type: row.customer_type || industry,
    industry_type: industry,
    evidence_sufficiency: row.evidence_sufficiency === "不足" || !row.evidence_sufficiency ? "一般" : row.evidence_sufficiency,
    target_fit: row.target_fit || "NOT_TARGET",
    lead_priority: row.lead_priority || "LOW",
    decision_status: row.decision_status || "AUTO_HOLD",
    manual_review_status: row.manual_review_status || "NEEDS_REVIEW",
  }).eq("id", row.id);
  if (resultError) throw new Error(`更新分析结果 ${row.id} 失败：${resultError.message}`);
  resultUpdates += 1;

  if (row.is_latest_valid && row.customer_id) {
    const { data: customer, error: customerReadError } = await db.from("customers")
      .select("id,ai_last_result_id")
      .eq("id", row.customer_id)
      .maybeSingle();
    if (customerReadError) throw new Error(`读取客户 ${row.customer_id} 失败：${customerReadError.message}`);
    if (customer?.ai_last_result_id === row.id) {
      const { error: customerError } = await db.from("customers").update({
        ai_score: score,
        ai_level: "D",
        industry,
        ai_screening_done: true,
        ai_status: "COMPLETED",
      }).eq("id", row.customer_id).eq("ai_last_result_id", row.id);
      if (customerError) throw new Error(`回写客户 ${row.customer_id} 失败：${customerError.message}`);
      customerUpdates += 1;
    }
  }
}

console.log(JSON.stringify({ result_updates: resultUpdates, customer_updates: customerUpdates }, null, 2));
