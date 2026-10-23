"use client";
import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Customer } from "@/lib/types";
import { countryInfo } from "@/lib/countries";
import { CustomerSocialLinksEditor, type SocialLinkRow, type SocialPlatform } from "@/components/customer-social-links-editor";
import { AppDialog } from "@/components/ui/app-dialog";
import { normalizeManualPhone } from "@/lib/contacts/manual-phone";
import { customerStageContactError } from "@/lib/customer-contact-requirement";
import { CUSTOMER_GRADE_DESCRIPTIONS, CUSTOMER_GRADE_OPTIONS, customerGradeDescription } from "@/lib/customers/customer-grade";
import { displayAddressList, displayShippingContacts, MAX_CUSTOMER_ADDRESSES, validateAddressList, validateShippingContacts, type ShippingContact } from "@/lib/customers/address-list";

type PotentialCustomer = {
  id?: string;
  company_name?: string;
  country?: string;
  website?: string | null;
  google_url?: string | null;
  match_reasons?: string[];
  ownership_status?: string;
  ownership_disposition?: "OWN_CUSTOMER" | "PUBLIC_POOL_AVAILABLE" | "OTHER_OWNED_CUSTOMER" | "UNOWNED_REVIEW_REQUIRED";
  owner_name?: string | null;
};

export function PotentialDuplicateCandidate({ item }: { item: PotentialCustomer }) {
  const href = item.id && item.ownership_disposition === "PUBLIC_POOL_AVAILABLE"
    ? `/customers/pool?tab=available&customer=${encodeURIComponent(item.id)}`
    : item.id && item.ownership_disposition === "OWN_CUSTOMER"
      ? `/customers/${encodeURIComponent(item.id)}`
      : null;
  return <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><b>{item.company_name || "未命名客户"}</b><span className="rounded-full bg-white px-2 py-1 text-xs text-slate-600">{item.ownership_disposition === "OTHER_OWNED_CUSTOMER" && item.owner_name ? `当前归属人：${item.owner_name}` : item.ownership_status}</span></div>
    <p className="mt-2 text-sm text-slate-600">国家/地区：{item.country || "—"} · 匹配依据：{item.match_reasons?.join("、") || "资料相似"}</p>
    {item.website ? <p className="mt-1 truncate text-xs text-blue-700">官网：{item.website}</p> : null}
    {item.google_url ? <p className="mt-1 truncate text-xs text-blue-700">Google 地图：{item.google_url}</p> : null}
    {href ? <Link href={href} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">{item.ownership_disposition === "PUBLIC_POOL_AVAILABLE" ? "去客户公海核对并认领" : "查看我的客户"}（新窗口）</Link> : <p className="mt-3 text-xs text-amber-800">{item.ownership_disposition === "OTHER_OWNED_CUSTOMER" ? "该客户已有归属人，不在可认领公海；如确认是同一客户，请勿重复新增，联系主管或管理员核对。" : "该客户不在可认领公海，请联系管理员核对归属。"}</p>}
  </div>;
}

function initialSocialLinks(customer?: Customer | null): SocialLinkRow[] {
  const fixed: Array<[SocialPlatform, string | null | undefined]> = [
    ["facebook", customer?.facebook_url], ["instagram", customer?.instagram_url],
    ["tiktok", customer?.tiktok_url], ["linkedin", customer?.linkedin_url],
  ];
  const other = (customer?.other_public_urls || []).map((url, index) => ({
    id: `other-${index}`,
    platform: (/youtu\.be|youtube\.com/i.test(url) ? "youtube" : /(?:^|\.)x\.com|twitter\.com/i.test(url) ? "x" : "other") as SocialPlatform,
    url,
  }));
  return [...fixed.filter(([, url]) => Boolean(url)).map(([platform, url]) => ({ id: `fixed-${platform}`, platform, url: String(url) })), ...other];
}

const socialHosts: Partial<Record<SocialPlatform, RegExp>> = {
  facebook: /(^|\.)facebook\.com$|(^|\.)fb\.com$/, instagram: /(^|\.)instagram\.com$/,
  tiktok: /(^|\.)tiktok\.com$/, youtube: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/,
  linkedin: /(^|\.)linkedin\.com$/, x: /(^|\.)x\.com$|(^|\.)twitter\.com$/,
};

function validateSocialLinks(rows: SocialLinkRow[]) {
  const fixedSeen = new Set<string>();
  for (const row of rows) {
    let parsed: URL;
    try { parsed = new URL(row.url); } catch { throw new Error("社媒链接必须是完整的 http:// 或 https:// 网址"); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("社媒链接只支持 http:// 或 https:// 网址");
    const rule = socialHosts[row.platform];
    if (rule && !rule.test(parsed.hostname.toLowerCase())) throw new Error(`所选社媒平台与链接域名不匹配：${row.url}`);
    if (!["youtube", "x", "other"].includes(row.platform)) {
      if (fixedSeen.has(row.platform)) throw new Error("同一社媒平台只能保留一个企业主页链接");
      fixedSeen.add(row.platform);
    }
  }
}

function validateBasicContacts(form: Record<string, string>) {
  normalizeManualPhone(form.phone, "联系电话");
  const email = form.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("邮箱格式不正确");
  normalizeManualPhone(form.whatsapp, "WhatsApp号码");
  for (const [label, value] of [["官网", form.website], ["Google地图网址", form.google_url]] as const) {
    if (!value.trim()) continue;
    let parsed: URL;
    try { parsed = new URL(value.trim()); } catch { throw new Error(`${label}必须是完整的 http:// 或 https:// 链接`); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`${label}只支持 http:// 或 https:// 链接`);
  }
}

function ShippingContactEditor({ label, values, onChange }: { label: "客户收货信息" | "货代收货信息"; values: ShippingContact[]; onChange: (values: ShippingContact[]) => void }) {
  const rows = values;
  const update = (index: number, key: keyof ShippingContact, value: string) => onChange(rows.map((row, current) => current === index ? { ...row, [key]: value } : row));
  return <fieldset className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
    <legend className="text-sm font-semibold text-slate-800">{label}</legend>
    <p className="mb-3 mt-1 text-xs text-slate-500">选填；收货人、联系电话和详细地址可分别填写，未填写的字段留空即可。</p>
    <div className="space-y-3">{rows.map((row, index) => <div key={index} className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between"><b className="text-xs text-slate-600">收货信息 {index + 1}</b><button type="button" onClick={() => onChange(rows.filter((_, current) => current !== index))} className="text-xs text-rose-600">删除</button></div>
      <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs text-slate-600">收货人<input value={row.recipient} maxLength={200} onChange={(event) => update(index, "recipient", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label><label className="text-xs text-slate-600">联系电话<input type="tel" value={row.phone} maxLength={100} onChange={(event) => update(index, "phone", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label></div>
      <label className="mt-2 block text-xs text-slate-600">详细收货地址<input value={row.address} maxLength={500} onChange={(event) => update(index, "address", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
    </div>)}</div>
    {rows.length < MAX_CUSTOMER_ADDRESSES ? <button type="button" onClick={() => onChange([...rows, { address: "", recipient: "", phone: "" }])} className="mt-3 w-full rounded-lg border border-dashed border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700">+ 添加{label}</button> : null}
  </fieldset>;
}

export function CustomerForm({ customer, onDone, onCancel, onDirtyChange, onChangeStage, analyzeAfterSave = false, editBasicOnly = false, destination = "PRIVATE" }: { customer?: Customer | null; onDone: (customer?: Customer) => void; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void; onChangeStage?: (status: string) => void; analyzeAfterSave?: boolean; editBasicOnly?: boolean; destination?: "PRIVATE" | "PUBLIC_POOL" }) {
  const [form, setForm] = useState<Record<string,string>>({ company_name:customer?.company_name||"",contact_name:customer?.contact_name||"",country:customer?.country?countryInfo(customer.country).name:"",phone:customer?.phone||"",whatsapp:customer?.whatsapp||"",wechat:customer?.wechat||"",email:customer?.email||"",tax_number:customer?.tax_number||"",manual_grade:customer?.manual_grade||"",website:customer?.website||"",google_url:customer?.google_url||"",address:customer?.address||"",shipping_address:customer?.shipping_address||"",forwarder_address:customer?.forwarder_address||"",tally_requirements:customer?.tally_requirements||"",industry:customer?.industry||"",category:customer?.category||"",source:customer?.source||"手动创建",status:customer?.status||(destination==="PRIVATE"?"CLAIMED":"UNCLAIMED"),followup_status:customer?.followup_status||"WAITING_CONTACT",notes:customer?.notes||"" });
  const [shippingContacts, setShippingContacts] = useState<ShippingContact[]>(() => displayShippingContacts(customer?.shipping_contact_entries, displayAddressList(customer?.shipping_addresses, customer?.shipping_address)));
  const [shippingContactsChanged, setShippingContactsChanged] = useState(false);
  const [forwarderContacts, setForwarderContacts] = useState<ShippingContact[]>(() => displayShippingContacts(customer?.forwarder_contact_entries, displayAddressList(customer?.forwarder_addresses, customer?.forwarder_address)));
  const [forwarderContactsChanged, setForwarderContactsChanged] = useState(false);
  const [stageFile, setStageFile] = useState<File | null>(null);
  const [socialLinks,setSocialLinks]=useState<SocialLinkRow[]>(()=>initialSocialLinks(customer));
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  const [resolution,setResolution]=useState<{label:string;href:string}|null>(null);
  const [potentialDuplicate,setPotentialDuplicate]=useState(false);
  const [potentialCustomers,setPotentialCustomers]=useState<PotentialCustomer[]>([]);
  const [potentialDialogOpen,setPotentialDialogOpen]=useState(false);
  const [conflictCustomer,setConflictCustomer]=useState<PotentialCustomer|null>(null);
  const [conflictActionUrl,setConflictActionUrl]=useState("");
  const formRef=useRef<HTMLFormElement>(null);
  const originalDraft=useRef<string|null>(null);
  const draft=JSON.stringify({form,shippingContacts,forwarderContacts,socialLinks,stageFile:stageFile?.name||null});
  if(originalDraft.current===null)originalDraft.current=draft;
  useEffect(()=>{onDirtyChange?.(draft!==originalDraft.current)},[draft,onDirtyChange]);
  const set=(key:string,value:string)=>setForm((current)=>({...current,[key]:value}));
  async function submit(event:FormEvent){
    event.preventDefault();
    setSaving(true);
    setError("");
    setResolution(null);
    try {
      validateBasicContacts(form);
      const stage = !customer && destination === "PRIVATE" ? form.status : "CLAIMED";
      const contactError = customerStageContactError(stage, form);
      if (contactError) throw new Error(contactError);
      if (stage === "FOLLOWING" && !stageFile) throw new Error("意向客户必须上传真实佐证凭证");
      if (stageFile && (stageFile.size <= 0 || stageFile.size > 15 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(stageFile.type))) {
        throw new Error("凭证仅支持 JPG、PNG、WebP 或 PDF，大小不超过15MB");
      }
      const uniqueSocial=[...new Map(socialLinks.map((row)=>({ ...row,url:row.url.trim() })).filter((row)=>row.url).map((row)=>[`${row.platform}|${row.url.toLowerCase().replace(/\/$/,"")}`,row])).values()];
      validateSocialLinks(uniqueSocial);
      const fixed=(platform:SocialPlatform)=>uniqueSocial.find((row)=>row.platform===platform)?.url||"";
      const normalizedContacts = shippingContactsChanged || !customer ? validateShippingContacts(shippingContacts) : null;
      const normalizedShipping = validateAddressList((normalizedContacts || shippingContacts).map((row) => row.address), "客户收货地址");
      const normalizedForwarderContacts = forwarderContactsChanged || !customer ? validateShippingContacts(forwarderContacts, "货代收货信息") : null;
      const normalizedForwarder = validateAddressList((normalizedForwarderContacts || forwarderContacts).map((row) => row.address), "货代地址");
      const allPayload:Record<string,unknown>={...form,shipping_addresses:normalizedShipping,forwarder_addresses:normalizedForwarder,shipping_address:normalizedShipping[0]||"",forwarder_address:normalizedForwarder[0]||"",status:stage === "DEAL" ? "DEAL" : "CLAIMED",requested_stage:stage,phone:normalizeManualPhone(form.phone,"联系电话"),whatsapp:normalizeManualPhone(form.whatsapp,"WhatsApp号码"),country:countryInfo(form.country).name,destination,facebook_url:fixed("facebook"),instagram_url:fixed("instagram"),tiktok_url:fixed("tiktok"),linkedin_url:fixed("linkedin"),other_public_urls:uniqueSocial.filter((row)=>["youtube","x","other"].includes(row.platform)).map((row)=>row.url),confirm_potential_duplicate:potentialDuplicate};
      if (normalizedContacts) allPayload.shipping_contact_entries = normalizedContacts;
      if (normalizedForwarderContacts) allPayload.forwarder_contact_entries = normalizedForwarderContacts;
      const basicKeys=["company_name","contact_name","country","phone","whatsapp","wechat","email","tax_number","manual_grade","website","google_url","address","shipping_address","forwarder_address","shipping_addresses","shipping_contact_entries","forwarder_addresses","forwarder_contact_entries","tally_requirements","notes","facebook_url","instagram_url","tiktok_url","linkedin_url","other_public_urls"];
      const editableKeys=destination==="PUBLIC_POOL"?basicKeys.filter((key)=>key!=="manual_grade"):basicKeys;
      const payload=editBasicOnly?Object.fromEntries(editableKeys.filter((key)=>key in allPayload).map((key)=>[key,allPayload[key]])):allPayload;
      const response=await fetch(customer?`/api/customers/${customer.id}`:"/api/customers",{method:customer?"PATCH":"POST",headers:{"Content-Type":"application/json","x-dtsmart-toast":"manual-error"},body:JSON.stringify(payload)});
      const result=await response.json().catch(()=>({}));
      if(!response.ok){setError(result.error||"保存失败，请检查填写内容");if(result.status==="POTENTIAL_DUPLICATE"){setPotentialDuplicate(false);setPotentialCustomers(Array.isArray(result.potential_customers)?result.potential_customers:[]);setPotentialDialogOpen(true);}if(typeof result.action_url==="string")setResolution({label:result.status==="PUBLIC_POOL_AVAILABLE"?"前往客户公海认领":"查看已有客户",href:result.action_url});return;}
      if(result.conflict){
        setConflictCustomer(result.conflict_customer&&typeof result.conflict_customer==="object"?result.conflict_customer:{});
        setConflictActionUrl(typeof result.action_url==="string"?result.action_url:"/customers/conflicts");
        return;
      }
      if (!customer && stage === "DEAL" && result.status !== "DEAL") {
        setError("系统已存在该客户，当前已接管归属，但不能以手动新增免凭证规则将已有客户改为成交；请在客户详情提交成交凭证。");
        setResolution({ label: "打开客户详情", href: `/customers/${result.id}` });
        return;
      }
      if (stage === "FOLLOWING" && !customer) {
        const evidence = new FormData();
        evidence.set("action", "STAGE");
        evidence.set("status", "FOLLOWING");
        evidence.set("reason", "手动新增客户时提交的意向佐证");
        evidence.set("file", stageFile!);
        const staged = await fetch(`/api/customers/${result.id}/workflow`, { method: "POST", body: evidence });
        if (!staged.ok) {
          const stageResult = await staged.json().catch(() => ({}));
          setError(`客户已保存为潜在客户，但意向阶段未生效：${stageResult.error || "请到客户详情重试"}`);
          setResolution({ label: "打开客户详情", href: `/customers/${result.id}` });
          return;
        }
        result.status = "FOLLOWING";
      }
      if(analyzeAfterSave&&!customer){
        const analyzed=await fetch("/api/ai/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customer_id:result.id})});
        if(!analyzed.ok){const body=await analyzed.json().catch(()=>({}));setError(`客户已保存，但AI筛选失败：${body.error||"未知错误"}`);return;}
      }
      onDone(result);
    } catch (saveError) {
      setError(saveError instanceof Error ? `保存失败：${saveError.message}` : "保存失败，请检查网络后重试");
    } finally {
      setSaving(false);
    }
  }
  const input=(key:string,label:string,required=false,type="text")=>key === "category" || label === "行业" ? null : <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{label === "WhatsApp" ? "whatsapp" : label}{required&&<b className="ml-1 text-rose-500">*</b>}</span><input required={required} type={type} value={form[key]} onChange={(e)=>set(key,e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/></label>;
  return <><form ref={formRef} onSubmit={submit} className="space-y-6"><section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="border-l-4 border-blue-600 pl-3 font-semibold">{editBasicOnly?"编辑客户原始资料":"客户信息"}</h3>{editBasicOnly?<p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">AI评分、AI等级、行业结论、官网核验联系方式及分析依据为只读数据，只能通过AI筛选任务更新。</p>:null}<div className="mt-5 grid gap-4 md:grid-cols-2">{input("contact_name","客户名称",!customer)}{input("country","国家/地区",true)}{input("company_name","公司名称")}{input("tax_number","客户税号")}{destination==="PRIVATE"?<label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">客户等级</span><select value={form.manual_grade} onChange={(event)=>set("manual_grade",event.target.value)} title={customerGradeDescription(form.manual_grade) || "选择人工客户等级；业绩区间以美元计"} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">未标记</option>{CUSTOMER_GRADE_OPTIONS.map((grade)=><option key={grade} value={grade}>{grade} — {CUSTOMER_GRADE_DESCRIPTIONS[grade]}</option>)}</select><span className="mt-1 block text-xs text-slate-500" title={customerGradeDescription(form.manual_grade)}>{form.manual_grade ? customerGradeDescription(form.manual_grade) : "等级对应业绩区间（USD）；留空表示未标记。"}</span></label>:null}{customer && destination==="PRIVATE"?<label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">客户阶段</span><select aria-label="变更客户阶段" value={customer.status} disabled={!onChangeStage} onChange={(event)=>onChangeStage?.(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm disabled:bg-slate-50 disabled:text-slate-500">{!["CLAIMED","FOLLOWING","DEAL"].includes(customer.status)?<option value={customer.status}>{customer.status}</option>:null}<option value="CLAIMED">潜在客户</option><option value="FOLLOWING">意向客户</option><option value="DEAL">已成交客户</option></select>{onChangeStage?<span className="mt-1 block text-xs text-slate-500">选择新阶段后填写原因及所需凭证</span>:null}</label>:null}{!customer && destination === "PRIVATE" && !editBasicOnly ? <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">客户阶段 <b className="text-rose-500">*</b></span><select value={form.status} onChange={(event)=>{set("status",event.target.value);setStageFile(null)}} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="CLAIMED">潜在客户</option><option value="FOLLOWING">意向客户</option><option value="DEAL">已成交客户</option></select></label> : null}{!customer && destination === "PRIVATE" && form.status === "FOLLOWING" ? <div className="md:col-span-2 rounded-xl border border-blue-200 bg-blue-50/40 p-4"><div className="mb-3"><span className="text-sm font-semibold text-slate-800">意向佐证凭证 <b className="text-rose-500">*</b></span><p className="mt-1 text-xs text-slate-500">选择意向客户时需提供佐证，保存后会随阶段变更记录。</p></div><input id="customer-intent-evidence" type="file" accept="image/jpeg,image/png,image/webp,.pdf" onChange={(event)=>setStageFile(event.target.files?.[0]||null)} className="sr-only" aria-label="选择意向佐证凭证" aria-describedby="customer-intent-evidence-hint"/><div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-blue-300 bg-white p-3"><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><FilePlus2 size={20}/></span><span className="min-w-0 flex-1 truncate text-sm text-slate-600" title={stageFile?.name}>{stageFile ? stageFile.name : "尚未选择文件"}</span><label htmlFor="customer-intent-evidence" className="cursor-pointer rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">{stageFile ? "更换文件" : "选择文件"}</label>{stageFile ? <button type="button" onClick={()=>{setStageFile(null);const fileInput=document.getElementById("customer-intent-evidence") as HTMLInputElement|null;if(fileInput)fileInput.value="";}} className="rounded-lg px-2 py-2 text-sm text-slate-500 hover:bg-slate-100">移除</button> : null}</div><p id="customer-intent-evidence-hint" className="mt-2 text-xs text-slate-500">支持 JPG、PNG、WebP、PDF，最大 15 MB。</p></div> : null}{["FOLLOWING","DEAL"].includes(stage)?<p className="md:col-span-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">意向客户和已成交客户至少填写微信、邮箱或电话其中一项（任选其一，无需全部填写）。</p>:null}{input("phone","联系电话")}{input("email","邮箱",false,"email")}{input("whatsapp","WhatsApp")}{input("wechat","微信号码")}{input("website","官网")}{input("google_url","Google地图网址")}<CustomerSocialLinksEditor rows={socialLinks} onChange={setSocialLinks}/><label className="md:col-span-2"><span className="mb-1.5 block text-sm font-medium text-slate-700">公司地址</span><input value={form.address} onChange={(e)=>set("address",e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/></label><div className="md:col-span-2"><div className="mb-3"><h4 className="text-sm font-semibold text-slate-800">客户与货代收货信息</h4><p className="mt-1 text-xs text-slate-500">两类信息均可不填；点击添加后，收货人、联系电话和详细地址可分别填写，未填写的字段留空即可。</p></div><div className="grid gap-4 lg:grid-cols-2"><ShippingContactEditor label="客户收货信息" values={shippingContacts} onChange={(rows) => { setShippingContacts(rows); setShippingContactsChanged(true); }}/><ShippingContactEditor label="货代收货信息" values={forwarderContacts} onChange={(rows) => { setForwarderContacts(rows); setForwarderContactsChanged(true); }}/></div></div><div className="md:col-span-2 grid gap-4 md:grid-cols-2"><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">理货要求</span><textarea value={form.tally_requirements} onChange={(e)=>set("tally_requirements",e.target.value)} rows={5} className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/></label><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">备注</span><textarea value={form.notes} onChange={(e)=>set("notes",e.target.value)} rows={5} maxLength={500} className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/><span className="float-right text-xs text-slate-400">{form.notes.length}/500</span></label></div></div><p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{destination === "PRIVATE" && ["FOLLOWING", "DEAL"].includes(!customer ? form.status : customer.status) ? "意向客户和已成交客户至少填写微信、邮箱或电话其中一项；意向客户还需上传佐证凭证。" : "仅客户名称和国家/地区为必填项；其余资料均可选填。"}</p></section>{error&&<div className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><span>{error}</span>{resolution?<Link href={resolution.href} className="ml-auto rounded-lg border border-rose-300 bg-white px-3 py-2 font-medium text-rose-700 hover:bg-rose-100">{resolution.label}</Link>:null}{error&&potentialDuplicate===false&&error.includes("疑似重复客户")?<button type="button" onClick={()=>setPotentialDialogOpen(true)} className="ml-auto rounded-lg border border-amber-300 bg-white px-3 py-2 font-medium text-amber-800 hover:bg-amber-100">查看候选并核对</button>:null}</div>}<div className="flex justify-end gap-3"><button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm hover:bg-slate-50">取消</button><button disabled={saving} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{saving?"保存中…":analyzeAfterSave?"保存并进行AI筛选":"保存客户"}</button></div></form><AppDialog open={potentialDialogOpen} onClose={()=>setPotentialDialogOpen(false)} title="核对疑似重复客户" description="仅显示核对所需的公开主档信息；他人已归属客户的联系方式不会在此展示。" width="max-w-3xl"><div className="space-y-3">{potentialCustomers.map((item,index)=><PotentialDuplicateCandidate key={item.id||index} item={item}/>)}</div><div className="mt-5 flex justify-end gap-2 border-t pt-4"><button type="button" onClick={()=>setPotentialDialogOpen(false)} className="h-10 rounded-lg border px-4 text-sm">返回修改</button><button type="button" onClick={()=>{setPotentialDialogOpen(false);setPotentialDuplicate(true);queueMicrotask(()=>formRef.current?.requestSubmit());}} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white">已核对，仍要新增</button></div></AppDialog><AppDialog open={Boolean(conflictCustomer)} onClose={()=>setConflictCustomer(null)} title="核对归属冲突客户" description="系统已保留唯一客户主档。请先核对匹配依据，再决定返回修改或进入冲突客户处理。" width="max-w-2xl">{conflictCustomer?<div><div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><b>{conflictCustomer.company_name||"未命名客户"}</b><span className="rounded-full bg-white px-2 py-1 text-xs text-slate-600">{conflictCustomer.ownership_status||"已有归属"}</span></div><p className="mt-2 text-sm text-slate-600">国家/地区：{conflictCustomer.country||"—"} · 匹配依据：{conflictCustomer.match_reasons?.join("、")||"联系方式一致"}</p><p className="mt-2 truncate text-xs text-blue-700">官网：{conflictCustomer.website||"—"}</p><p className="mt-1 truncate text-xs text-blue-700">Google 地图：{conflictCustomer.google_url||"—"}</p></div><div className="mt-5 flex justify-end gap-2 border-t pt-4"><button type="button" onClick={()=>setConflictCustomer(null)} className="h-10 rounded-lg border px-4 text-sm">返回修改</button><Link href={conflictActionUrl} className="inline-flex h-10 items-center rounded-lg bg-blue-600 px-5 text-sm font-medium text-white">进入冲突客户处理</Link></div></div>:null}</AppDialog></>;
}
