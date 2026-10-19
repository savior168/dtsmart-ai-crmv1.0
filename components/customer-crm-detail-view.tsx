"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarClock, ExternalLink, FilePlus2, History, LoaderCircle, Pencil, ShieldCheck, UserRoundCheck, X } from "lucide-react";
import { GroupedEvidenceSection, VerifiedContactsSection, type EvidenceDisplayItem, type VerifiedContactDisplayItem } from "@/components/ai-screening/evidence-sections";
import { CountryLabel } from "@/components/country-label";
import { CustomerForm } from "@/components/customer-form";
import { AppDialog, DialogActions } from "@/components/ui/app-dialog";
import { AppDateTimeField } from "@/components/ui/app-date-time-field";
import { AppSelect } from "@/components/ui/app-select";
import { AttachmentPreview } from "@/components/ui/attachment-preview";
import { CustomerContactSummary } from "@/components/customer-contact-summary";
import { CustomerPublicLink } from "@/components/ui/customer-public-link";
import { CustomerPublicChannels } from "@/components/customer-public-channels";
import { customerSourceLabel } from "@/lib/customers/source-display";
import type { Customer, CustomerStatus, Followup, FollowupStage, FollowupType } from "@/lib/types";
import { CUSTOMER_STATUS_LABELS, FOLLOWUP_STAGE_LABELS, FOLLOWUP_STAGES, FOLLOWUP_TYPE_LABELS, FOLLOWUP_TYPES, QUOTE_STATUS_LABELS } from "@/lib/types";
import { cleanChineseAiNarrative } from "@/lib/ai/presentation";
import { auditActionLabel } from "@/lib/audit-log";
import { localDateTimeInput } from "@/lib/date-time";

type EffectiveProtection = { source:"EXPLICIT"|"DEFAULT_90_DAYS"|"NONE"; start_date:string|null; expire_date:string|null; status:"ACTIVE"|"RELEASED"|"EXPIRED"; remaining_days:number|null; permanent:boolean };
type HistoryUser = { id:string; name?:string|null; email?:string|null };
type Claim = { id:string; action:string; claim_type?:string|null; owner_name?:string|null; release_reason?:string|null; source_owner_id?:string|null; created_at:string; actor?:HistoryUser|null; source_owner?:HistoryUser|null };
type AuditLog = { id:string; action:string; content?:Record<string,unknown>|null; created_at:string };
type AiFact = EvidenceDisplayItem;
type AiResult = { id?:string|null; task_id?:string|null; target_decision?:"VALID"|"INVALID"|"REVIEW"|null; ai_reason?:string|null; summary?:string|null; business_relevance?:string|null; business_scope?:string|null; company_scale_evidence?:string|null; customer_value?:string|null; followup_suggestion?:string|null };
type VerifiedContact = VerifiedContactDisplayItem;
type DecisionMaker={id:string;full_name:string;job_title:string;role_type:"PROCUREMENT"|"OWNER"|"EXECUTIVE"|"OPERATIONS"|"OTHER";contact_type:"EMAIL"|"PHONE"|"WHATSAPP"|"NONE";contact_value?:string|null;exact_source_url:string;source_excerpt:string;confidence:number;verified_at:string};
type CustomerDetailCustomer = Customer & { facebook_url?:string|null; instagram_url?:string|null; linkedin_url?:string|null; tiktok_url?:string|null; other_public_urls?:string[]|null };
type Attachment={id:string;followup_id:string|null;quote_id:string|null;filename:string;mime_type:string|null;size_bytes:number|null;kind?:string|null;created_at:string};
type QuoteRow={id:string;quote_number:string;status:string;currency:string;total_amount:number;valid_until:string|null;created_at:string;updated_at:string};
type Data = { customer:CustomerDetailCustomer; profile:{id:string;role:string}; can_edit:boolean; can_change_stage:boolean; can_sales_operate:boolean; can_view_ai_evidence:boolean; access_scope?:"PUBLIC_POOL"|"BUSINESS"; current_owner?:HistoryUser|null; effective_protection:EffectiveProtection; followups:Followup[]; attachments:Attachment[]; quotes:QuoteRow[]; claims:Claim[]; audit_logs:AuditLog[]; ai_result?:AiResult|null; ai_facts?:AiFact[]; verified_contacts?:VerifiedContact[]; decision_makers?:DecisionMaker[] };
const tabs = ["资料","AI分析","跟进记录","报价记录","归属与操作"] as const;
type Tab = typeof tabs[number];
type EditableStage = Exclude<CustomerStatus,"UNCLAIMED"|"RELEASED">;
const editableStages: EditableStage[] = ["CLAIMED","FOLLOWING","DEAL"];
function CustomerEditWorkflowSummary({ customer, canSalesOperate, onFollowup }: { customer: CustomerDetailCustomer; canSalesOperate: boolean; onFollowup: () => void }) {
  return <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3 text-sm">
    <div><span className="text-slate-500">当前跟进状态</span><div className="mt-1 flex items-center gap-3"><b>{FOLLOWUP_STAGE_LABELS[customer.followup_status as FollowupStage] || "待联系"}</b>{canSalesOperate ? <button type="button" onClick={onFollowup} className="text-blue-700 hover:underline">记录跟进并更新</button> : null}</div></div>
    <p className="mt-1 text-xs leading-5 text-slate-600">客户阶段通过下方选择并留痕；跟进状态通过真实跟进记录更新，均不随基本资料保存而被覆盖。</p>
  </div>;
}
const followupAttachmentTypes=new Set(["image/jpeg","image/png","image/webp","application/pdf","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/msword"]);
function attachmentError(file:File|null){return file&&(file.size<=0||file.size>15*1024*1024)?"附件必须大于 0 且不超过 15MB":file&&!followupAttachmentTypes.has(file.type)?"跟进附件仅支持 JPG、PNG、WebP、PDF、Excel 和 Word":""}

function value(input?:string|number|null){return input===undefined||input===null||input===""?"-":String(input)}
function cleanAiText(input?:string|null){return cleanChineseAiNarrative(input).split("\n").filter((line)=>!/事实边界[：:]\s*未核验的信息不会写成既定事实/.test(line)).join("\n").trim()}
function FollowupScheduleField({value,onChange}:{value:string;onChange:(value:string)=>void}){return <AppDateTimeField value={value} onChange={onChange} label="约定下次跟进时间" help="仅在您明确选择后创建提醒；留空的客户进入“待安排”。" presets/>}
function FollowupEvidenceField({file,required,onChange,inputRef}:{file:File|null;required:boolean;onChange:(file:File|null)=>void;inputRef:RefObject<HTMLInputElement|null>}){
  return <div className="mt-4"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-700">跟进证明 <span className={required?"text-amber-700":"text-slate-400"}>{required?"（意向反馈必传）":"（可选）"}</span></span><span className="text-xs text-slate-400">单文件 ≤15MB</span></div><input id="followup-evidence-file" ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.xlsx,.xls,.docx,.doc" onChange={event=>onChange(event.target.files?.[0]||null)} className="sr-only"/><div className={`mt-2 flex min-h-14 items-center gap-3 rounded-lg border border-dashed px-3 py-2 ${required&&!file?"border-amber-300 bg-amber-50/50":"border-slate-200 bg-slate-50/50"}`}><FilePlus2 size={18} className="shrink-0 text-blue-600"/><span className="min-w-0 flex-1 break-all text-sm text-slate-700">{file?.name||"聊天截图、邮件截图或业务文件"}</span><label htmlFor="followup-evidence-file" className="shrink-0 cursor-pointer rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">{file?"更换文件":"选择文件"}</label>{file?<button type="button" onClick={()=>{onChange(null);if(inputRef.current)inputRef.current.value=""}} className="shrink-0 text-xs text-slate-500 hover:text-rose-600">移除</button>:null}</div><p className="mt-1.5 text-xs text-slate-500">每次 1 个文件；JPG、PNG、WebP、PDF、Excel、Word。图片与 PDF 可预览原件，Office 文件可下载原件</p></div>;
}
function FollowupCorrectionHistory({log}:{log:AuditLog}){
  if(log.action!=="FOLLOWUP_UPDATE")return null;
  const snapshot=(input:unknown)=>typeof input==="object"&&input!==null&&!Array.isArray(input)?input as Record<string,unknown>:null;
  const before=snapshot(log.content?.before);const after=snapshot(log.content?.after);
  if(!before||!after)return null;
  const revisions:Array<[string,Record<string,unknown>]>=[["更正前",before],["更正后",after]];
  return <details className="mt-2 text-sm"><summary className="cursor-pointer text-blue-600">查看更正前后</summary><div className="mt-2 grid gap-3 sm:grid-cols-2">{revisions.map(([label,data])=>{const type=String(data.type||"");const date=typeof data.next_follow_date==="string"?new Date(data.next_follow_date):null;return <div key={label} className="rounded-lg bg-slate-50 p-3"><b className="text-xs text-slate-500">{label}</b><p className="mt-1 text-xs">{FOLLOWUP_TYPE_LABELS[type as FollowupType]||type||"—"}</p><p className="mt-2 whitespace-pre-wrap leading-6">{typeof data.content==="string"?data.content:"—"}</p><p className="mt-2 text-xs text-slate-500">下次跟进：{date&&!Number.isNaN(date.getTime())?date.toLocaleString("zh-CN"):"未安排"}</p></div>})}</div></details>;
}
function Row({label,children}:{label:string;children:ReactNode}){return <div className="grid grid-cols-[110px_1fr] gap-3 border-b border-slate-100 py-3 text-sm"><dt className="text-slate-500">{label}</dt><dd className="min-w-0 break-words font-medium text-slate-800">{children}</dd></div>}
function Info({title,content}:{title:string;content?:string|null}){const cleaned=cleanAiText(content);return <section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">{title}</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{cleaned||"暂无数据"}</p></section>}
function Empty({text}:{text:string}){return <div className="grid min-h-52 place-items-center p-5 text-slate-400"><div className="text-center"><CalendarClock className="mx-auto mb-2"/><p>{text}</p></div></div>}
function claimActionLabel(action:string){return action.includes("：")?action:({CLAIM:"认领客户",TRANSFER:"转移客户归属",RELEASE:"释放客户"} as Record<string,string>)[action]||"客户归属变更"}
function historyUserName(user?:HistoryUser|null,fallback?:string|null){return user?.name?.trim()||user?.email||fallback?.trim()||"系统记录缺少姓名"}
function OwnershipHistory({ data }: { data: Data }) {
  const people = new Map<string, string>();
  for (const claim of data.claims) {
    const id = claim.actor?.id || claim.owner_name || "";
    if (id) people.set(id, historyUserName(claim.actor, claim.owner_name));
  }
  for (const followup of data.followups) {
    const name = followup.creator?.name?.trim() || followup.creator?.email || "";
    if (name) people.set(followup.user_id, name);
  }
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-800">归属与跟进历程</h2>
          <p className="mt-1 text-xs text-slate-500">认领、转移、释放和实际跟进人员均保留记录。</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-600">
          当前归属：{data.current_owner ? historyUserName(data.current_owner) : "公海（未归属）"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="text-slate-500">曾跟进：</span>
        {people.size ? [...people.values()].map((name) => <span key={name} className="rounded-full border bg-white px-2.5 py-1 text-slate-700">{name}</span>) : <span className="text-slate-400">暂无已记录跟进人</span>}
      </div>
      <div className="mt-4 space-y-2">
        {data.claims.map((item) => (
          <article key={item.id} className="flex gap-3 rounded-lg border bg-white px-3 py-2.5">
            <History size={16} className="mt-0.5 shrink-0 text-blue-600" />
            <div className="min-w-0">
              <b className="text-sm text-slate-800">{claimActionLabel(item.action)}</b>
              <time className="mt-1 block text-xs text-slate-400">{new Date(item.created_at).toLocaleString("zh-CN")}</time>
            </div>
          </article>
        ))}
        {!data.claims.length ? <p className="rounded-lg border border-dashed bg-white p-3 text-sm text-slate-400">暂无归属变更记录</p> : null}
      </div>
    </section>
  );
}

function CustomerAiAnalysis({data}:{data:Data}){
  if (!data.customer.ai_screening_done) return <div className="p-5"><Empty text="该客户尚未完成AI筛选，暂无AI分析结论或依据"/></div>;
  const result=data.ai_result;
  if (!data.can_view_ai_evidence) return <div className="grid gap-4 p-5 md:grid-cols-2"><Info title="分析摘要" content={result?.ai_reason||result?.summary||data.customer.ai_reason}/><Info title="经营范围" content={result?.business_scope||data.customer.business_scope}/><Info title="业务相关性" content={result?.business_relevance||data.customer.business_relevance}/><Info title="客户价值" content={result?.customer_value||data.customer.customer_value}/><Info title="跟进建议" content={result?.followup_suggestion||data.customer.followup_suggestion}/></div>;
  const facts=(data.ai_facts||[]).filter(item=>{const text=item.normalized_fact||item.content||"";return /[\u3400-\u9fff]/.test(text)&&!/未保存|未提炼|请重新执行|读取失败|未能取得|GOOGLE_MAPS_API_KEY|fetch failed/i.test(text)&&/^https?:\/\//i.test(item.source_url||"")});
  const roleLabel={PROCUREMENT:"采购/供应链",OWNER:"老板/创始人",EXECUTIVE:"管理决策人",OPERATIONS:"运营负责人",OTHER:"其他人员"};
  return <div className="space-y-4 p-5">
    <div className="grid gap-4 md:grid-cols-2">
      <Info title="分析摘要" content={result?.ai_reason||result?.summary||data.customer.ai_reason}/>
      <Info title="经营范围" content={result?.business_scope||data.customer.business_scope}/>
      <Info title="业务相关性" content={result?.business_relevance||data.customer.business_relevance}/>
      <Info title="客户价值" content={result?.customer_value||data.customer.customer_value}/>
      <Info title="跟进建议" content={result?.followup_suggestion||data.customer.followup_suggestion}/>
      {(result?.company_scale_evidence||data.customer.company_scale_evidence)?<Info title="可核验采购/规模记录" content={result?.company_scale_evidence||data.customer.company_scale_evidence}/>:null}
    </div>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h3 className="flex items-center gap-2 font-semibold"><UserRoundCheck size={18} className="text-blue-600"/>已核验决策联系人</h3><p className="mt-1 text-sm text-slate-500">仅展示可在同一公开页面原文中同时复核姓名与当前职位的人员；联系方式还需与该人员明确关联。</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">{data.decision_makers?.length||0} 人</span></header><div className="grid gap-3 p-4 lg:grid-cols-2">{(data.decision_makers||[]).map(person=><article key={person.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><b>{person.full_name}</b><p className="mt-1 text-sm text-slate-600">{person.job_title}</p></div><span className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{roleLabel[person.role_type]}</span></div>{person.contact_type!=="NONE"&&person.contact_value?<a href={person.contact_type==="EMAIL"?`mailto:${person.contact_value}`:person.contact_type==="WHATSAPP"?`https://wa.me/${person.contact_value.replace(/\D/g,"")}`:`tel:${person.contact_value}`} target={person.contact_type==="WHATSAPP"?"_blank":undefined} rel="noreferrer" className="mt-3 block break-all text-sm font-medium text-blue-600">{person.contact_type==="WHATSAPP"?"WhatsApp":person.contact_type==="EMAIL"?"邮箱":"电话"}：{person.contact_value}</a>:<p className="mt-3 text-xs text-amber-700">已核验身份与职位，未发现明确归属于本人的直接联系方式</p>}<details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer text-blue-600">查看来源原文</summary><p className="mt-2 leading-5">{person.source_excerpt}</p><a href={person.exact_source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-blue-600">打开原始页面<ExternalLink size={12}/></a></details></article>)}{!data.decision_makers?.length?<p className="col-span-full rounded-lg border border-dashed p-6 text-center text-sm text-slate-400">尚未发现满足严格来源核验要求的采购负责人或老板；不会用推测信息代替。</p>:null}</div></section>
    <VerifiedContactsSection contacts={data.verified_contacts||[]} customer={data.customer} evidence={facts}/>
    <GroupedEvidenceSection evidence={facts} compact/>
  </div>
}

export function CustomerCrmDetailView({customerId,returnTo="/customers",returnLabel="返回客户列表"}:{customerId:string;returnTo?:string;returnLabel?:string}){
  const searchParams=useSearchParams();const requestedAction=searchParams.get("action");const handledAction=useRef<string|null>(null);
  const [data,setData]=useState<Data|null>(null);const [loading,setLoading]=useState(true);const [editing,setEditing]=useState(false);const [stageOpen,setStageOpen]=useState(false);const [stageForm,setStageForm]=useState<{status:EditableStage;reason:string}>({status:"CLAIMED",reason:""});const [stageFile,setStageFile]=useState<File|null>(null);const [editingFollowup,setEditingFollowup]=useState<Followup|null>(null);const [editReason,setEditReason]=useState("");const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [tab,setTab]=useState<Tab>("资料");const [followupFile,setFollowupFile]=useState<File|null>(null);const [form,setForm]=useState({type:"EMAIL" as FollowupType,outcome:"CONTACT_ONLY",content:"",next_follow_date:"",followup_status:"" as ""|FollowupStage});
  const followupSubmission=useRef<{requestId:string;draft:typeof form;file:File|null}|null>(null);
  const [retryingSubmission,setRetryingSubmission]=useState(false);
  const [pendingUpload,setPendingUpload]=useState<{followupId:string;file:File;error:string}|null>(null);
  const followupFileInput=useRef<HTMLInputElement>(null);
  const load=useCallback(async(clearError=true)=>{
    setLoading(true);if(clearError)setError("");
    try{
      const response=await fetch(`/api/customers/${customerId}/crm`,{cache:"no-store"});
      const body=await response.json().catch(()=>({}));
      if(!response.ok||!body?.customer)throw new Error(body.error||"客户资料加载失败");
      if(!body.customer.ai_screening_done){body.customer={...body.customer,industry:"未完成AI筛选",ai_score:null,ai_level:null,is_target_customer:null,ai_reason:null,business_scope:null,business_relevance:null,customer_value:null,followup_suggestion:null,company_scale_evidence:null}}
      setData(body);
    }catch(cause){setError(current=>current||(cause instanceof Error?cause.message:"客户资料加载失败，请检查网络后重试"))}
    finally{setLoading(false)}
  },[customerId]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{if(!data||!requestedAction||handledAction.current===requestedAction)return;if(requestedAction==="followup"&&data.can_sales_operate){setTab("跟进记录");handledAction.current=requestedAction;return}if(requestedAction==="stage"&&data.can_change_stage){setStageForm({status:data.customer.status==="UNCLAIMED"?"CLAIMED":data.customer.status as EditableStage,reason:""});setStageFile(null);setStageOpen(true);handledAction.current=requestedAction}},[data,requestedAction]);
  async function uploadFollowupAttachment(followupId:string,file:File){
    const upload=new FormData();upload.set("file",file);upload.set("followup_id",followupId);
    const response=await fetch("/api/attachments",{method:"POST",body:upload});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||"附件上传失败")}
  }
  async function retryFollowupAttachment(){
    if(!pendingUpload||busy)return;setBusy(true);
    try{await uploadFollowupAttachment(pendingUpload.followupId,pendingUpload.file);setPendingUpload(null);await load(false)}
    catch(cause){setPendingUpload(current=>current?{...current,error:cause instanceof Error?cause.message:"网络连接异常"}:null)}
    finally{setBusy(false)}
  }
  async function addFollowup(event:FormEvent){
    event.preventDefault();if(busy||pendingUpload)return;
    if(form.outcome==="INTEREST"&&!followupFile&&!followupSubmission.current){setError("客户明确有采购意向时必须上传真实沟通凭证");return}
    if(!followupSubmission.current&&attachmentError(followupFile)){setError(attachmentError(followupFile));return}
    const submission=followupSubmission.current||{requestId:crypto.randomUUID(),draft:{...form},file:followupFile};
    followupSubmission.current=submission;setBusy(true);setError("");
    try{
      const draft=submission.draft;
      const response=await fetch(`/api/customers/${customerId}/followups`,{method:"POST",headers:{"Content-Type":"application/json","x-dtsmart-toast":"manual-error"},body:JSON.stringify({...draft,client_request_id:submission.requestId,next_follow_date:draft.next_follow_date?new Date(draft.next_follow_date).toISOString():null,has_attachment:Boolean(submission.file)})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok){
        if(response.status<500){followupSubmission.current=null;setRetryingSubmission(false)}else setRetryingSubmission(true);
        setError(body.error||"跟进保存失败，请重试");return;
      }
      if(typeof body.id!=="string")throw new Error("保存结果暂未确认，请重试核对同一条记录");
      followupSubmission.current=null;setRetryingSubmission(false);
      setForm({type:"EMAIL",outcome:"CONTACT_ONLY",content:"",next_follow_date:"",followup_status:""});setFollowupFile(null);
      if(followupFileInput.current)followupFileInput.current.value="";
      if(submission.file){
        try{await uploadFollowupAttachment(body.id,submission.file)}
        catch(cause){setPendingUpload({followupId:body.id,file:submission.file,error:cause instanceof Error?cause.message:"网络连接异常"})}
      }
      await load(false);
    }catch(cause){setRetryingSubmission(true);setError(cause instanceof Error?cause.message:"网络连接异常，请重试保存同一条记录")}
    finally{setBusy(false)}
  }
  async function saveFollowup(event:FormEvent){
    event.preventDefault();if(!editingFollowup||busy)return;setBusy(true);setError("");
    try{
      const response=await fetch(`/api/followups/${editingFollowup.id}`,{method:"PATCH",headers:{"Content-Type":"application/json","x-dtsmart-toast":"manual-error"},body:JSON.stringify({type:editingFollowup.type,content:editingFollowup.content,next_follow_date:editingFollowup.next_follow_date?new Date(editingFollowup.next_follow_date).toISOString():null,edit_reason:editReason.trim()})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||"跟进记录更正失败");
      setEditingFollowup(null);setEditReason("");await load(false);
    }catch(cause){setError(cause instanceof Error?cause.message:"网络连接异常，请检查记录后重试")}
    finally{setBusy(false)}
  }
  async function changeStage(event:FormEvent){event.preventDefault();if(!data)return;const needsEvidence=["FOLLOWING","DEAL"].includes(stageForm.status);if(needsEvidence&&(!data.customer.phone?.trim()||!data.customer.email?.trim())){setError("意向客户和成交客户必须填写联系电话及邮箱，请先编辑客户资料");return}if(!stageForm.reason.trim()){setError("请填写真实、可追溯的阶段变更原因");return}if(needsEvidence&&!stageFile){setError("变更为意向客户或成交客户时必须上传真实凭证");return}setBusy(true);setError("");const payload=new FormData();payload.set("action","STAGE");payload.set("status",stageForm.status);payload.set("reason",stageForm.reason.trim());if(stageFile)payload.set("file",stageFile);const response=await fetch(`/api/customers/${customerId}/workflow`,{method:"POST",headers:{"x-dtsmart-toast":"manual-error"},body:payload});const body=await response.json().catch(()=>({}));setBusy(false);if(!response.ok){setError(body.error||"客户阶段修改失败");return}setStageOpen(false);setStageFile(null);setStageForm({status:stageForm.status,reason:""});window.dispatchEvent(new CustomEvent("dtsmart-toast",{detail:{message:`客户阶段已更新为${CUSTOMER_STATUS_LABELS[stageForm.status]}`,type:"success"}}));await load()}
  if(!data)return <main className="grid min-h-[70vh] place-items-center"><div className="text-center">{loading?<><LoaderCircle className="mx-auto animate-spin text-blue-600"/><p className="mt-3 text-sm text-slate-500">正在加载客户资料…</p></>:<><p className="text-rose-600">{error||"客户资料加载失败"}</p><button onClick={()=>void load()} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">重新加载</button></>}</div></main>;
  const {customer}=data;const publicReadOnly=data.access_scope==="PUBLIC_POOL";const effective=data.effective_protection;const protectionText=effective.permanent?"永久":effective.status==="ACTIVE"?`${effective.remaining_days??0}天`:effective.status==="RELEASED"?"已释放":"已到期";const scoreLabel=customer.ai_score??"-";const gradeLabel=customer.ai_level||"待筛选";const targetLabel=data.ai_result?.target_decision==="VALID"?"是":data.ai_result?.target_decision==="INVALID"?"否":customer.ai_screening_done?"待复核":"待筛选";const visibleTabs=publicReadOnly?tabs.slice(0,2):tabs;
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1600px]">
    <nav aria-label="客户详情导航" className="mb-4 flex min-w-0 items-center gap-2 text-sm">
      {returnTo==="/customers"?<Link href="/customers" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 font-medium text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"><ArrowLeft size={16}/><span>返回客户列表</span></Link>:<Link href={returnTo} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 font-medium text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"><ArrowLeft size={16}/><span>{returnLabel}</span></Link>}
    </nav>
    <section className="rounded-xl border bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-5 border-b p-5">
        <div><h1 className="text-2xl font-bold">{customer.company_name}</h1><div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span className="rounded bg-slate-100 px-2 py-1"><CountryLabel value={customer.country}/></span><span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">AI评分 {scoreLabel}</span><span className="rounded bg-blue-50 px-2 py-1 text-blue-700">AI等级 {gradeLabel}</span><span className="rounded bg-violet-50 px-2 py-1 text-violet-700">{CUSTOMER_STATUS_LABELS[customer.status]}</span></div></div>
        <div className="flex flex-wrap items-center gap-3">{!publicReadOnly?<div className="border-r pr-5 text-center"><small className="text-slate-500">保护剩余</small><b className={`mt-1 block text-2xl ${effective.status==="ACTIVE"?"text-emerald-600":"text-slate-500"}`}>{protectionText}</b></div>:null}{data.can_view_ai_evidence&&customer.ai_screening_done&&data.ai_result?<Link prefetch={false} href={`/ai-screening/customers/${customer.id}/evidence`} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100">查看AI分析依据<ExternalLink size={15}/></Link>:null}{data.can_edit?<><button onClick={()=>setEditing(true)} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:border-blue-300 hover:bg-blue-50"><Pencil size={16}/>编辑客户</button>{data.can_change_stage?<button onClick={()=>{setStageForm({status:customer.status==="UNCLAIMED"?"CLAIMED":customer.status as EditableStage,reason:""});setStageFile(null);setStageOpen(true)}} className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100"><History size={16}/>变更阶段</button>:null}</>:<span className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">{publicReadOnly?"公海基础资料，仅认领后可跟进":"其他用户数据仅供查看"}</span>}</div>
      </header>
      <nav className="flex gap-7 overflow-x-auto border-b px-5 text-sm">{visibleTabs.map(item=><button key={item} onClick={()=>setTab(item)} className={`whitespace-nowrap py-3 ${tab===item?"border-b-2 border-blue-600 font-medium text-blue-600":"text-slate-500"}`}>{item}</button>)}</nav>
      {error?<div className="m-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>:null}
      {tab==="资料"?<div className="grid gap-5 p-5 xl:grid-cols-[1.15fr_.85fr]"><section className="rounded-xl border p-5"><h2 className="font-semibold">客户基本信息</h2><dl className="mt-3 grid gap-x-8 md:grid-cols-2"><Row label="公司名称">{value(customer.company_name)}</Row><Row label="客户名称">{value(customer.contact_name)}</Row><Row label="公司税号">{value(customer.tax_number)}</Row><Row label="客户等级">{value(customer.manual_grade)}</Row><Row label="国家/地区"><CountryLabel value={customer.country}/></Row><Row label="AI判定行业">{value(customer.industry||customer.category)}</Row><Row label="联系方式"><CustomerContactSummary customer={{...customer,verified_contacts:data.verified_contacts}} source="all"/></Row><Row label="官网"><CustomerPublicLink value={customer.website} kind="website" size="normal"/></Row><Row label="公开渠道"><CustomerPublicChannels customer={customer}/></Row><Row label="公司地址">{value(customer.address)}</Row><Row label="客户收货地址">{value(customer.shipping_address)}</Row><Row label="货代地址">{value(customer.forwarder_address)}</Row><Row label="其他地址">{value(customer.other_address)}</Row><Row label="微信号码">{value(customer.wechat)}</Row><Row label="理货要求">{value(customer.tally_requirements)}</Row>{customer.notes?.trim()?<Row label="备注"><span className="whitespace-pre-wrap font-normal leading-6 text-slate-700">{customer.notes.trim()}</span></Row>:null}<Row label="数据来源">{customerSourceLabel(customer.source)}</Row><Row label="创建时间">{new Date(customer.created_at).toLocaleString("zh-CN")}</Row><Row label="更新时间">{customer.updated_at?new Date(customer.updated_at).toLocaleString("zh-CN"):"-"}</Row></dl></section><section className="rounded-xl border p-5"><h2 className="font-semibold">AI分析结果（只读）</h2><div className="mt-4 grid grid-cols-3 gap-3">{[["AI评分",scoreLabel],["AI等级",gradeLabel],["目标客户",targetLabel]].map(([label,item])=><div key={label} className="rounded-lg bg-slate-50 p-3 text-center"><small className="text-slate-500">{label}</small><b className="mt-1 block text-xl text-blue-600">{item}</b></div>)}</div><p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-600">{cleanAiText(customer.ai_reason)||"尚未完成AI筛选"}</p><div className="mt-4 rounded-lg bg-violet-50 p-3 text-sm text-violet-800"><b>跟进建议</b><p className="mt-1 whitespace-pre-line leading-6">{cleanAiText(customer.followup_suggestion)||"暂无建议"}</p></div></section></div>:null}
      {tab==="AI分析"?<CustomerAiAnalysis data={data}/>:null}
{tab==="跟进记录"?<div className={`grid gap-5 p-5 ${data.can_sales_operate?"xl:grid-cols-[1fr_.8fr]":""}`}><section className="space-y-3">{data.followups.map(item=>{const files=data.attachments.filter(file=>file.followup_id===item.id);const corrections=data.audit_logs.filter(log=>log.action==="FOLLOWUP_UPDATE"&&log.content?.followup_id===item.id);const canEditFollowup=data.can_sales_operate&&(data.profile.role==="ADMIN"||item.user_id===data.profile.id);return <article key={item.id} className="rounded-xl border p-4"><div className="flex items-center justify-between gap-3"><span className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{FOLLOWUP_TYPE_LABELS[item.type]}</span><div className="flex items-center gap-2">{canEditFollowup?<button disabled={busy} onClick={()=>{setEditReason("");setError("");setEditingFollowup({...item,next_follow_date:localDateTimeInput(item.next_follow_date)})}} className="inline-flex items-center gap-1 text-xs text-blue-600"><Pencil size={13}/>更正</button>:null}<time className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString("zh-CN")}</time></div></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.content}</p>{item.next_follow_date?<p className="mt-3 text-xs text-emerald-600">下次提醒：{new Date(item.next_follow_date).toLocaleString("zh-CN")}</p>:null}{files.length?<div className="mt-3 flex flex-wrap gap-2">{files.map(file=><AttachmentPreview key={file.id} attachment={file} label={file.filename}/>)}</div>:null}{corrections.length?<details className="mt-3 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium text-blue-700">更正历史（{corrections.length}）</summary><div className="mt-2 space-y-3 border-t border-slate-100 pt-2">{corrections.map(log=><div key={log.id} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0"><time className="text-slate-500">{new Date(log.created_at).toLocaleString("zh-CN")}</time><p className="mt-1 whitespace-pre-wrap text-slate-700">原因：{typeof log.content?.reason==="string"?log.content.reason:"未记录"}</p><FollowupCorrectionHistory log={log}/></div>)}</div></details>:null}</article>})}{!data.followups.length?<p className="rounded-xl border border-dashed p-10 text-center text-slate-400">暂无跟进记录</p>:null}</section>{data.can_sales_operate?<form onSubmit={addFollowup} className="h-fit rounded-xl border p-5"><h2 className="font-semibold">新增跟进</h2>{pendingUpload?<div role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>跟进记录已保存，附件尚未上传成功：{pendingUpload.error}</p><p className="mt-1 break-all text-xs">{pendingUpload.file.name}</p><button type="button" disabled={busy} onClick={()=>void retryFollowupAttachment()} className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm disabled:opacity-50">{busy?"上传中…":"重试上传附件"}</button></div>:null}{retryingSubmission?<p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">上次保存结果尚未确认，请重试核对同一条记录；确认完成前保留原填写内容。</p>:null}<fieldset disabled={busy||retryingSubmission||Boolean(pendingUpload)}><AppSelect aria-label="本次跟进方式" value={form.type} onChange={event=>setForm({...form,type:event.target.value as FollowupType})} className="mt-4 w-full rounded-lg border px-3 py-2">{FOLLOWUP_TYPES.map(type=><option key={type} value={type}>{FOLLOWUP_TYPE_LABELS[type]}</option>)}</AppSelect><AppSelect aria-label="本次沟通结果" value={form.outcome} onChange={event=>setForm({...form,outcome:event.target.value})} className="mt-3 w-full rounded-lg border px-3 py-2"><option value="CONTACT_ONLY">已联系/记录进展（不改变客户阶段）</option><option value="INTEREST">客户明确有采购意向（需凭证，不自动改阶段）</option><option value="NO_INTEREST">客户明确无需求（保留事实记录）</option></AppSelect><AppSelect aria-label="本次跟进后的状态" value={form.followup_status} onChange={event=>setForm({...form,followup_status:event.target.value as ""|FollowupStage})} className="mt-3 w-full rounded-lg border px-3 py-2"><option value="">跟进后状态：保持当前</option>{FOLLOWUP_STAGES.map(status=><option key={status} value={status}>{FOLLOWUP_STAGE_LABELS[status]}</option>)}</AppSelect><textarea aria-label="本次跟进内容" required rows={5} value={form.content} onChange={event=>setForm({...form,content:event.target.value})} placeholder="客观记录沟通原话、客户反馈和下一步计划" className="mt-3 w-full rounded-lg border p-3"/><FollowupEvidenceField file={followupFile} required={form.outcome==="INTEREST"} onChange={setFollowupFile} inputRef={followupFileInput}/><FollowupScheduleField value={form.next_follow_date} onChange={next_follow_date=>setForm(current=>({...current,next_follow_date}))}/><p className="mt-2 text-xs leading-5 text-slate-500">客户阶段不会自动改变；跟进状态仅在您明确选择时同步更新，默认保持当前状态。</p></fieldset><button disabled={busy||Boolean(pendingUpload)} className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm text-white disabled:opacity-40">{busy?"保存中…":retryingSubmission?"重试保存同一条记录":"保存跟进"}</button></form>:null}</div>:null}
      {tab==="报价记录"?<div className="space-y-3 p-5"><div className="flex justify-end">{data.can_sales_operate?<Link href={`/orders/new?customer_id=${customer.id}`} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">为该客户创建PI订单</Link>:null}</div>{data.quotes.map(quote=><Link key={quote.id} href={`/quotes/${quote.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 hover:border-blue-300 hover:bg-blue-50/40"><div><b>{quote.quote_number}</b><p className="mt-1 text-xs text-slate-500">更新于 {new Date(quote.updated_at).toLocaleString("zh-CN")}</p></div><div className="text-right"><b className="text-blue-700">{quote.currency} {Number(quote.total_amount||0).toFixed(2)}</b><p className="mt-1 text-xs text-slate-500">{QUOTE_STATUS_LABELS[quote.status as keyof typeof QUOTE_STATUS_LABELS]||quote.status}</p></div></Link>)}{!data.quotes.length?<Empty text="暂无历史报价或PI记录"/>:null}</div>:null}
{tab==="归属与操作"?<div className="space-y-3 p-5"><OwnershipHistory data={data}/>{data.audit_logs.map(item=>{const evidenceId=String(item.content?.evidence_attachment_id||"");const evidence=data.attachments.find(file=>file.id===evidenceId&&file.kind==="STAGE_EVIDENCE");const reason=typeof item.content?.reason==="string"?item.content.reason:"";return <div key={item.id} className="flex gap-3 rounded-xl border p-4"><History className="shrink-0 text-blue-600" size={18}/><div className="min-w-0"><b className="text-sm">{auditActionLabel(item.action)}</b>{reason?<p className="mt-1 text-sm leading-6 text-slate-600">原因：{reason}</p>:null}<FollowupCorrectionHistory log={item}/>{evidence?<div className="mt-2"><AttachmentPreview attachment={evidence} label={`预览阶段变更凭证：${evidence.filename}`}/></div>:null}<p className="mt-1 text-xs text-slate-500">{new Date(item.created_at).toLocaleString("zh-CN")}</p></div></div>})}{!data.audit_logs.length&&!data.claims.length?<Empty text="暂无归属与操作记录"/>:null}</div>:null}
    </section>
    <div className={`mt-4 flex items-center gap-3 rounded-xl border p-4 text-sm ${effective.status==="ACTIVE"?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-slate-200 bg-slate-50 text-slate-600"}`}><ShieldCheck/>{effective.permanent?"成交客户永久保护":effective.status==="ACTIVE"?`客户保护有效，截止 ${effective.expire_date?new Date(effective.expire_date).toLocaleDateString("zh-CN"):"永久"}，剩余 ${effective.remaining_days??0} 天${effective.source==="DEFAULT_90_DAYS"?"（按归属日起默认90天）":""}`:effective.status==="RELEASED"?"客户已主动释放，当前保护期为0天":"客户保护期已到期"}</div>
  </div>
  {editing?<div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={event=>{if(event.target===event.currentTarget)setEditing(false)}}><div role="dialog" aria-modal="true" aria-label="编辑客户原始资料" className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-semibold">编辑客户</h2><p className="mt-1 text-sm text-slate-500">{publicReadOnly?"公海客户的所属行业在此展示；已核验行业只能通过AI筛选更新。":"基本资料在此修改；客户阶段可在下方选择，仍需提交原因与必要凭证。"}</p></div><button onClick={()=>setEditing(false)} aria-label="关闭编辑窗口" className="rounded-lg p-2 hover:bg-slate-100"><X size={19}/></button></div>{!publicReadOnly?<CustomerEditWorkflowSummary customer={customer} canSalesOperate={data.can_sales_operate} onFollowup={()=>{setEditing(false);setTab("跟进记录")}}/>:null}<CustomerForm customer={customer} destination={publicReadOnly?"PUBLIC_POOL":"PRIVATE"} editBasicOnly onChangeStage={data.can_change_stage?(status)=>{setError("");setStageForm({status:status as EditableStage,reason:""});setStageFile(null);setStageOpen(true)}:undefined} onCancel={()=>setEditing(false)} onDone={updated=>{if(updated)setData(current=>current?{...current,customer:{...current.customer,...updated}}:current);setEditing(false);window.dispatchEvent(new CustomEvent("dtsmart-toast",{detail:{message:"客户原始资料已更新",type:"success"}}));void load()}}/></div></div>:null}
  {editingFollowup?<div className="fixed inset-0 z-[95] grid place-items-center bg-slate-950/40 p-4" onMouseDown={event=>{if(!busy&&event.target===event.currentTarget)setEditingFollowup(null)}}><form onSubmit={saveFollowup} role="dialog" aria-modal="true" aria-label="更正跟进记录" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">更正跟进记录</h2><button type="button" disabled={busy} onClick={()=>setEditingFollowup(null)} aria-label="关闭" className="rounded-lg p-2 hover:bg-slate-100"><X size={18}/></button></div>{error?<p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}<p className="mt-2 text-xs text-slate-500">更正会保留修改前后内容和操作记录；仅最新一条记录的日期影响当前待办。</p><AppSelect disabled={busy} aria-label="更正跟进方式" value={editingFollowup.type} onChange={event=>setEditingFollowup({...editingFollowup,type:event.target.value as FollowupType})} className="mt-4 w-full rounded-lg border px-3 py-2">{FOLLOWUP_TYPES.map(type=><option key={type} value={type}>{FOLLOWUP_TYPE_LABELS[type]}</option>)}</AppSelect><textarea disabled={busy} aria-label="更正跟进内容" required rows={6} value={editingFollowup.content} onChange={event=>setEditingFollowup({...editingFollowup,content:event.target.value})} className="mt-3 w-full rounded-lg border p-3"/><FollowupScheduleField value={editingFollowup.next_follow_date||""} onChange={next_follow_date=>setEditingFollowup(current=>current?{...current,next_follow_date:next_follow_date||null}:null)}/><label className="mt-3 block text-sm font-medium text-slate-700">更正原因（必填）<textarea disabled={busy} required minLength={5} rows={2} value={editReason} onChange={event=>setEditReason(event.target.value)} placeholder="说明原记录哪里有误以及本次更正依据" className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm"/></label><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={()=>setEditingFollowup(null)} className="rounded-lg border px-4 py-2 text-sm">取消</button><button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">{busy?"保存中…":"保存更正"}</button></div></form></div>:null}
  {stageOpen?<AppDialog title="变更客户阶段" description="仅修改当前客户。系统会保留变更原因、操作人、时间和凭证；主动释放不属于阶段变更。" onClose={()=>!busy&&setStageOpen(false)} width="max-w-lg"><form onSubmit={changeStage}>{error?<p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}<label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">目标阶段</span><AppSelect value={stageForm.status} onChange={event=>{setStageForm({...stageForm,status:event.target.value as EditableStage});setStageFile(null)}} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">{editableStages.map(status=><option key={status} value={status} disabled={status===customer.status}>{CUSTOMER_STATUS_LABELS[status]}{status===customer.status?"（当前）":""}</option>)}</AppSelect></label>{["FOLLOWING","DEAL"].includes(stageForm.status)?<p className="mt-3 text-xs text-slate-600">联系电话 <b className="text-rose-600">*</b>：{customer.phone||"未填写"}　邮箱 <b className="text-rose-600">*</b>：{customer.email||"未填写"}{!customer.phone||!customer.email?"；请先到资料页编辑补全。":""}</p>:null}<label className="mt-4 block"><span className="mb-1.5 block text-sm font-medium text-slate-700">变更原因</span><textarea required rows={4} maxLength={500} value={stageForm.reason} onChange={event=>setStageForm({...stageForm,reason:event.target.value})} placeholder="如实填写客户反馈、意向证据或成交确认" className="w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/><span className="mt-1 block text-right text-xs text-slate-400">{stageForm.reason.length}/500</span></label>{["FOLLOWING","DEAL"].includes(stageForm.status)?<div><label className={`mt-4 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed p-4 text-sm ${["FOLLOWING","DEAL"].includes(stageForm.status)&&!stageFile?"border-amber-300 bg-amber-50 text-amber-800":"border-slate-200 text-slate-600"}`}><FilePlus2 size={18}/><span className="min-w-0 flex-1 truncate">{stageFile?.name||`上传真实凭证（必传）`}</span><input type="file" accept="image/jpeg,image/png,image/webp,.pdf" onChange={event=>setStageFile(event.target.files?.[0]||null)} className="hidden"/></label><p className="mt-2 text-xs leading-5 text-slate-500">支持 JPG、PNG、WebP、PDF，最大 15MB。</p></div>:<p className="mt-3 text-xs text-slate-500">潜在客户只需填写真实的阶段变更原因，无需上传凭证。</p>}<DialogActions busy={busy} onCancel={()=>setStageOpen(false)} confirmLabel="确认变更"/></form></AppDialog>:null}
  </main>
}
