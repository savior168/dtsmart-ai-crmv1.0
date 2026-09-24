import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { evaluateAcquisitionGate } from "@/lib/ai-acquisition/quality-gate";
import { acquisitionIndustryMatchesVerifiedResult } from "@/lib/ai-acquisition/industry-match";
import { officialWebsiteUrl } from "@/lib/public-url";
import { createAdminClient } from "@/lib/supabase/admin";

async function refreshTaskCounts(taskId:string) {
  const admin = createAdminClient();
  const rows = await admin.from("ai_acquisition_candidates").select("decision").eq("task_id",taskId);
  if (rows.error) throw rows.error;
  const count = (decision:string)=>(rows.data||[]).filter((row)=>row.decision===decision).length;
  const saved = await admin.from("ai_acquisition_tasks").update({
    accepted_count:count("ACCEPTED"), review_count:count("REVIEW"), rejected_count:count("REJECTED"), duplicate_count:count("DUPLICATE"), updated_at:new Date().toISOString(),
  }).eq("id",taskId);
  if (saved.error) throw saved.error;
}

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    const { account } = await requirePermission("ai.acquisition.control");
    const { id } = await params;
    const body = await request.json() as { action?:string };
    const action = String(body.action||"");
    if (!["DISCARD","RECHECK_AND_ACCEPT"].includes(action)) return NextResponse.json({error:"不支持的复核操作"},{status:400});
    const admin = createAdminClient();
    const candidate = await admin.from("ai_acquisition_candidates").select("*,task:ai_acquisition_tasks!inner(id,user_id,task_number,industry,industries)").eq("id",id).maybeSingle();
    if (candidate.error) throw candidate.error;
    if (!candidate.data) return NextResponse.json({error:"待复核客户不存在"},{status:404});
    const task = candidate.data.task as unknown as {id:string;user_id:string;task_number:string;industry:string;industries:string[]|null};
    if (task.user_id!==account.id && account.role!=="ADMIN") throw new Error("FORBIDDEN");
    if (candidate.data.decision!=="REVIEW") return NextResponse.json({error:"该客户已处理，请刷新后查看"},{status:409});
    const customerId=String(candidate.data.staging_customer_id||"");
    if (action==="DISCARD") {
      const updated=await admin.from("ai_acquisition_candidates").update({decision:"REJECTED",decision_reason:"人工复核确认舍弃，未进入客户公海",processed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id).eq("decision","REVIEW").select("id");
      if (updated.error) throw updated.error;
      if (!updated.data?.length) return NextResponse.json({error:"该客户已被其他人处理"},{status:409});
      if (customerId) {
        const hidden=await admin.from("customers").update({deleted_at:new Date().toISOString(),pool_status:"INVALID",updated_at:new Date().toISOString()}).eq("id",customerId);
        if (hidden.error) throw hidden.error;
      }
    } else {
      const itemId=String(candidate.data.screening_task_item_id||"");
      const [result,contacts,evidence]=await Promise.all([
        admin.from("ai_screening_results").select("automation_status,target_decision,score,identity_status,industry_type").eq("task_item_id",itemId).eq("is_latest_valid",true).maybeSingle(),
        admin.from("customer_contacts").select("id,type,value_raw,value_normalized,verification_status,identity_match_status,contact_status,source_channel,exact_source_url").eq("customer_id",customerId),
        admin.from("ai_screening_evidence").select("source_url,evidence_strength,translated_fact,original_excerpt").eq("task_item_id",itemId),
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
      const gate=evaluateAcquisitionGate({automationStatus:result.data?.automation_status,targetDecision:result.data?.target_decision,score:result.data?.score,identityStatus:result.data?.identity_status,evidenceUrls:evidence.data||[],contacts:refreshedContacts.data||[]});
      const targetIndustries=task.industries?.length?task.industries:[task.industry];
      const industryEvidence=(evidence.data||[])
        .filter((row)=>/^https?:\/\//i.test(String(row.source_url||""))&&row.evidence_strength!=="WEAK_HINT")
        .flatMap((row)=>[row.translated_fact,row.original_excerpt]);
      if(!acquisitionIndustryMatchesVerifiedResult(targetIndustries,result.data?.industry_type,industryEvidence)) return NextResponse.json({error:`已核验行业“${String(result.data?.industry_type||"未知") }”缺少与本任务目标行业直接匹配的经营证据，不能入池`},{status:409});
      if (!gate.accepted) return NextResponse.json({error:"当前证据仍未达到入池门槛，请先补齐目标行业、主体在营和可追溯有效联系方式依据"},{status:409});
      const normalized=gate.actionableContacts.map((row)=>String(row.value_normalized||"")).filter(Boolean);
      const duplicate=normalized.length?await admin.from("customer_contacts")
        .select("customer_id,customer:customers!inner(id)")
        .in("value_normalized",normalized).neq("customer_id",customerId)
        .is("customer.deleted_at",null).neq("customer.pool_status","AI_STAGING")
        .limit(1):{data:[],error:null};
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data?.length) return NextResponse.json({error:"核验联系方式已存在于系统其他客户，不能重复入池"},{status:409});
      const updated=await admin.from("ai_acquisition_candidates").update({decision:"ACCEPTED",decision_reason:"人工发起重新校验，全部自动准入门槛通过",imported_customer_id:customerId,has_actionable_contact:true,evidence_complete:true,processed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id).eq("decision","REVIEW").select("id");
      if (updated.error) throw updated.error;
      if (!updated.data?.length) return NextResponse.json({error:"该客户已被其他人处理"},{status:409});
      const promoted=await admin.from("customers").update({source:"AI_ACQUISITION",acquisition_scope:"PUBLIC_POOL",pool_status:"AVAILABLE",status:"UNCLAIMED",owner_id:null,owner_user_id:null,assigned_via:null,deleted_at:null,updated_at:new Date().toISOString()}).eq("id",customerId).select("id").maybeSingle();
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
