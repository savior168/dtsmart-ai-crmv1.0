import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { evaluateAcquisitionGate } from "@/lib/ai-acquisition/quality-gate";
import { acquisitionIndustryMatchesVerifiedResult } from "@/lib/ai-acquisition/industry-match";
import { acquisitionIndustryMismatchReason } from "@/lib/ai-acquisition/decision-reason";
import { officialWebsiteUrl } from "@/lib/public-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { countAcquisitionCandidateDecisions } from "@/lib/ai-acquisition/decision-counts";
import { manualScoreLevel, parseManualReview } from "@/lib/ai-acquisition/manual-review";
import { hasDirectTargetBusinessEvidence } from "@/lib/ai/customer-analysis";

async function refreshTaskCounts(taskId:string) {
  const admin = createAdminClient();
  const counts = await countAcquisitionCandidateDecisions(admin, taskId);
  const saved = await admin.from("ai_acquisition_tasks").update({ ...counts, updated_at:new Date().toISOString() }).eq("id",taskId);
  if (saved.error) throw saved.error;
}

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    const { account } = await requirePermission("ai.acquisition.control");
    const { id } = await params;
    const body = await request.json() as { action?:string; assessment?:unknown };
    const action = String(body.action||"");
    if (!["SAVE_ASSESSMENT","DISCARD","RECHECK_AND_ACCEPT"].includes(action)) return NextResponse.json({error:"不支持的复核操作"},{status:400});
    const admin = createAdminClient();
    const candidate = await admin.from("ai_acquisition_candidates").select("*,task:ai_acquisition_tasks!inner(id,user_id,task_number,industry,industries)").eq("id",id).maybeSingle();
    if (candidate.error) throw candidate.error;
    if (!candidate.data) return NextResponse.json({error:"待复核客户不存在"},{status:404});
    const task = candidate.data.task as unknown as {id:string;user_id:string;task_number:string;industry:string;industries:string[]|null};
    if (task.user_id!==account.id && account.role!=="ADMIN") throw new Error("FORBIDDEN");
    if (candidate.data.decision!=="REVIEW") return NextResponse.json({error:"该客户已处理，请刷新后查看"},{status:409});
    const customerId=String(candidate.data.staging_customer_id||"");
    if (action==="SAVE_ASSESSMENT") {
      let assessment;
      try { assessment=parseManualReview(body.assessment); }
      catch (error) { return NextResponse.json({error:error instanceof Error?error.message:"人工复核内容无效"},{status:400}); }
      const itemId=String(candidate.data.screening_task_item_id||"");
      if (!itemId) return NextResponse.json({error:"该候选缺少可核验的分析记录，不能人工改分"},{status:409});
      const selected=assessment.evidenceIds.length
        ? await admin.from("ai_screening_evidence").select("id,source_url,evidence_strength,evidence_type,translated_fact,original_excerpt").eq("task_item_id",itemId).in("id",assessment.evidenceIds)
        : {data:[],error:null};
      if (selected.error) throw selected.error;
      if ((selected.data||[]).length!==assessment.evidenceIds.length || (selected.data||[]).some((row)=>!/^https?:\/\//i.test(String(row.source_url||"")) || row.evidence_strength==="WEAK_HINT")) return NextResponse.json({error:"只能引用本客户有公开来源且非弱提示的经营证据"},{status:400});
      if (assessment.targetDecision==="VALID") {
        if (!(selected.data||[]).some((row)=>row.evidence_type==="支持"&&hasDirectTargetBusinessEvidence(`${row.translated_fact||""} ${row.original_excerpt||""}`))) return NextResponse.json({error:"所选来源尚无直接证明目标业务的经营事实；电话、邮箱和网址不能单独作为行业证据"},{status:400});
        const targetIndustries=task.industries?.length?task.industries:[task.industry];
        const facts=(selected.data||[]).flatMap((row)=>[row.translated_fact,row.original_excerpt]);
        if (!acquisitionIndustryMatchesVerifiedResult(targetIndustries,assessment.industry,facts)) return NextResponse.json({error:`${acquisitionIndustryMismatchReason(targetIndustries,assessment.industry)}。任务目标：${targetIndustries.join("、")||"未设置"}；请核对所选行业及直接经营证据`},{status:400});
      }
      const now=new Date().toISOString();
      const updated=await admin.from("ai_acquisition_candidates").update({
        manual_score:assessment.score,manual_level:manualScoreLevel(assessment.score),manual_target_decision:assessment.targetDecision,
        manual_industry:assessment.industry,manual_reason:assessment.reason,manual_evidence_ids:assessment.evidenceIds,
        manual_reviewed_by:account.id,manual_reviewed_at:now,updated_at:now,
      }).eq("id",id).eq("decision","REVIEW").eq("updated_at",candidate.data.updated_at).select("id");
      if (updated.error) throw updated.error;
      if (!updated.data?.length) return NextResponse.json({error:"该客户复核内容已被更新，请刷新后重试"},{status:409});
      return NextResponse.json({ok:true});
    }
    if (action==="DISCARD") {
      if (candidate.data.manual_target_decision==="VALID") return NextResponse.json({error:"已人工确认为目标客户；如需舍弃，请先修正人工复核结论"},{status:409});
      const updated=await admin.from("ai_acquisition_candidates").update({decision:"REJECTED",decision_reason:"人工复核确认舍弃，未进入客户公海",processed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id).eq("decision","REVIEW").select("id");
      if (updated.error) throw updated.error;
      if (!updated.data?.length) return NextResponse.json({error:"该客户已被其他人处理"},{status:409});
      if (customerId) {
        const hidden=await admin.from("customers").update({deleted_at:new Date().toISOString(),pool_status:"INVALID",updated_at:new Date().toISOString()}).eq("id",customerId);
        if (hidden.error) throw hidden.error;
      }
    } else {
      if (candidate.data.manual_target_decision==="INVALID") return NextResponse.json({error:"人工已判定为非目标客户，不能入池"},{status:409});
      const itemId=String(candidate.data.screening_task_item_id||"");
      const [result,contacts,evidence]=await Promise.all([
        admin.from("ai_screening_results").select("automation_status,target_decision,score,identity_status,mismatch_signals,industry_type").eq("task_item_id",itemId).eq("is_latest_valid",true).maybeSingle(),
        admin.from("customer_contacts").select("id,type,value_raw,value_normalized,verification_status,identity_match_status,contact_status,source_channel,exact_source_url").eq("customer_id",customerId),
        admin.from("ai_screening_evidence").select("id,source_url,evidence_strength,evidence_type,translated_fact,original_excerpt").eq("task_item_id",itemId),
      ]);
      if (result.error||contacts.error||evidence.error) throw result.error||contacts.error||evidence.error;
      const identityStatus=String(result.data?.identity_status||"");
      const trustedEvidenceUrls=new Set((evidence.data||[]).filter((row)=>/^https?:\/\//i.test(String(row.source_url||""))&&String(row.evidence_strength||"")!=="WEAK_HINT").map((row)=>String(row.source_url)));
      const repairableContacts=(contacts.data||[]).filter((row)=>
        ["PHONE","EMAIL","WHATSAPP","WEBSITE"].includes(String(row.type))
        && ["google_maps","website"].includes(String(row.source_channel||""))
        && trustedEvidenceUrls.has(String(row.exact_source_url||""))
        && ["MATCHED","LIKELY_MATCHED"].includes(identityStatus)
        && !["MATCHED_ORIGINAL","NEW_VERIFIED","SOURCE_CONFIRMED"].includes(String(row.verification_status||"")),
      );
      if(repairableContacts.length){
        const verificationStatus=identityStatus==="MATCHED"?"NEW_VERIFIED":"SOURCE_CONFIRMED";
        const repaired=await admin.from("customer_contacts").update({verification_status:verificationStatus,identity_match_status:identityStatus,updated_at:new Date().toISOString()}).in("id",repairableContacts.map((row)=>row.id));
        if(repaired.error)throw repaired.error;
      }
      const refreshedContacts=repairableContacts.length
        ? await admin.from("customer_contacts").select("type,value_raw,value_normalized,verification_status,identity_match_status,contact_status,source_channel,exact_source_url").eq("customer_id",customerId)
        : contacts;
      if(refreshedContacts.error)throw refreshedContacts.error;
      const manuallyConfirmed=candidate.data.manual_target_decision==="VALID" && candidate.data.manual_score!=null;
      const reviewEvidence=manuallyConfirmed?(evidence.data||[]).filter((row)=>candidate.data.manual_evidence_ids?.includes(row.id)&&row.evidence_type==="支持"&&hasDirectTargetBusinessEvidence(`${row.translated_fact||""} ${row.original_excerpt||""}`)):evidence.data||[];
      const gate=evaluateAcquisitionGate({automationStatus:manuallyConfirmed?"AUTO_DEVELOP":result.data?.automation_status,targetDecision:manuallyConfirmed?"VALID":result.data?.target_decision,score:manuallyConfirmed?candidate.data.manual_score:result.data?.score,identityStatus:result.data?.identity_status,evidenceUrls:reviewEvidence,contacts:refreshedContacts.data||[]});
      const targetIndustries=task.industries?.length?task.industries:[task.industry];
      const industryEvidence=reviewEvidence
        .filter((row)=>/^https?:\/\//i.test(String(row.source_url||""))&&row.evidence_strength!=="WEAK_HINT")
        .flatMap((row)=>[row.translated_fact,row.original_excerpt]);
      const reviewedIndustry=manuallyConfirmed?candidate.data.manual_industry:result.data?.industry_type;
      if(!acquisitionIndustryMatchesVerifiedResult(targetIndustries,reviewedIndustry,industryEvidence)) return NextResponse.json({error:acquisitionIndustryMismatchReason(targetIndustries,reviewedIndustry)},{status:409});
      if (!gate.accepted) {
        const mismatchSignals=Array.isArray(result.data?.mismatch_signals)
          ? result.data.mismatch_signals.filter((signal):signal is string=>typeof signal==="string"&&Boolean(signal.trim())).slice(0,2)
          : [];
        const identityReason=!(["MATCHED","LIKELY_MATCHED"].includes(identityStatus))
          ? identityStatus==="CONFLICTED"||identityStatus==="CONFLICT"
            ? `主体证据存在冲突${mismatchSignals.length?`（${mismatchSignals.join("；")}）`:""}，不能仅凭人工改分入池；请核对是否为同一门店或重新分析`
            : `主体尚未确认是同一商家${mismatchSignals.length?`（${mismatchSignals.join("；")}）`:""}；人工行业和评分复核不会覆盖主体核验，请核对名称、地址和联系方式的具体来源`
          : null;
        const missing = [
          !manuallyConfirmed&&(result.data?.automation_status !== "AUTO_DEVELOP" || result.data?.target_decision !== "VALID") ? "AI最终目标结论尚未通过，请先提交带经营证据的人工复核结论" : null,
          Number(manuallyConfirmed?candidate.data.manual_score:result.data?.score || 0) < 60 ? "当前评分未达到60分" : null,
          identityReason,
          !gate.hasTraceableBusinessEvidence ? "缺少可追溯的非弱经营证据" : null,
          !gate.actionableContacts.length ? "缺少可追溯且已核验的电话、邮箱或WhatsApp" : null,
        ].filter(Boolean);
        return NextResponse.json({error:`当前不能入池：${missing.join("；") || "请核对已保存的证据"}`},{status:409});
      }
      const normalized=gate.actionableContacts.map((row)=>String(row.value_normalized||"")).filter(Boolean);
      const duplicate=normalized.length?await admin.from("customer_contacts")
        .select("customer_id,customer:customers!inner(id)")
        .in("value_normalized",normalized).neq("customer_id",customerId)
        .is("customer.deleted_at",null).neq("customer.pool_status","AI_STAGING")
        .limit(1):{data:[],error:null};
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data?.length) return NextResponse.json({error:"核验联系方式已存在于系统其他客户，不能重复入池"},{status:409});
      const updated=await admin.from("ai_acquisition_candidates").update({decision:"ACCEPTED",decision_reason:manuallyConfirmed?"人工目标行业和评分已复核，来源证据、主体、联系方式和重复校验通过":"人工发起重新校验，全部自动准入门槛通过",imported_customer_id:customerId,has_actionable_contact:true,evidence_complete:true,processed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id).eq("decision","REVIEW").select("id");
      if (updated.error) throw updated.error;
      if (!updated.data?.length) return NextResponse.json({error:"该客户已被其他人处理"},{status:409});
      const promoted=await admin.from("customers").update({source:"AI_ACQUISITION",acquisition_scope:"PUBLIC_POOL",pool_status:"AVAILABLE",status:"UNCLAIMED",owner_id:null,owner_user_id:null,assigned_via:null,deleted_at:null,...(manuallyConfirmed?{ai_score:candidate.data.manual_score,ai_level:candidate.data.manual_level,ai_score_source:"MANUAL_REVIEW",is_target_customer:true,industry:reviewedIndustry}:{}),updated_at:new Date().toISOString()}).eq("id",customerId).select("id").maybeSingle();
      let promotionConfirmed=Boolean(promoted.data);
      if (!promoted.error&&!promotionConfirmed) {
        const current=await admin.from("customers").select("source,acquisition_scope,pool_status,deleted_at").eq("id",customerId).maybeSingle();
        if (current.error) throw current.error;
        promotionConfirmed=current.data?.source==="AI_ACQUISITION"&&current.data?.acquisition_scope==="PUBLIC_POOL"&&["AVAILABLE","CLAIMED"].includes(String(current.data?.pool_status||""))&&!current.data?.deleted_at;
      }
      if (promoted.error||!promotionConfirmed) {
        await admin.from("ai_acquisition_candidates").update({decision:"REVIEW",decision_reason:"重新校验通过，但客户入池写入失败，等待重试",imported_customer_id:null,updated_at:new Date().toISOString()}).eq("id",id).eq("decision","ACCEPTED");
        throw promoted.error||new Error("客户公海写入未确认，请稍后重试");
      }
      const usableContacts=(refreshedContacts.data||[]).filter((row)=>["MATCHED_ORIGINAL","NEW_VERIFIED","SOURCE_CONFIRMED"].includes(String(row.verification_status||"")));
      const first=(type:string)=>usableContacts.find((row)=>row.type===type)?.value_raw||null;
      const profile=await admin.from("customers").select("phone,email,whatsapp,website").eq("id",customerId).maybeSingle();
      if(profile.error)throw profile.error;
      const completed=await admin.from("customers").update({
        phone:profile.data?.phone||first("PHONE"),email:profile.data?.email||first("EMAIL"),whatsapp:profile.data?.whatsapp||first("WHATSAPP"),website:officialWebsiteUrl(profile.data?.website)||officialWebsiteUrl(first("WEBSITE")),updated_at:new Date().toISOString(),
      }).eq("id",customerId);
      if(completed.error)throw completed.error;
    }
    await refreshTaskCounts(task.id);
    await admin.from("audit_logs").insert({user_id:account.id,action:`AI_ACQUISITION_REVIEW_${action}`,target_type:"ai_acquisition_candidate",target_id:id,content:{task_id:task.id,task_number:task.task_number,quality_gate_bypassed:false}});
    return NextResponse.json({ok:true});
  } catch (error) {
    const message=error instanceof Error?error.message:"待复核客户处理失败";
    return NextResponse.json({error:message},{status:message==="UNAUTHORIZED"?401:message==="FORBIDDEN"?403:400});
  }
}
