"use client";
import { useState, type FormEvent } from "react";
import type { Customer } from "@/lib/types";

export function CustomerForm({ customer, onDone, onCancel, analyzeAfterSave = false, editBasicOnly = false }: { customer?: Customer | null; onDone: (customer?: Customer) => void; onCancel: () => void; analyzeAfterSave?: boolean; editBasicOnly?: boolean }) {
  const [form, setForm] = useState<Record<string,string>>({ company_name:customer?.company_name||"",contact_name:customer?.contact_name||"",country:customer?.country||"",phone:customer?.phone||"",whatsapp:customer?.whatsapp||"",email:customer?.email||"",website:customer?.website||"",google_url:customer?.google_url||"",address:customer?.address||"",industry:customer?.industry||"",category:customer?.category||"",source:customer?.source||"手动创建",tags:customer?.tags?.join(",")||"",status:customer?.status||"UNCLAIMED",followup_status:customer?.followup_status||"WAITING_CONTACT",notes:customer?.notes||"" });
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  const set=(key:string,value:string)=>setForm((current)=>({...current,[key]:value}));
  async function submit(event:FormEvent){
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const allPayload:Record<string,string|string[]>={...form,tags:form.tags.split(/[,，]/).map((item)=>item.trim()).filter(Boolean)};
      const basicKeys=["company_name","contact_name","country","phone","whatsapp","email","website","google_url","address","category","tags","notes"];
      const payload=editBasicOnly?Object.fromEntries(basicKeys.map((key)=>[key,allPayload[key]])):allPayload;
      const response=await fetch(customer?`/api/customers/${customer.id}`:"/api/customers",{method:customer?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const result=await response.json().catch(()=>({}));
      if(!response.ok){setError(result.error||"保存失败，请检查填写内容");return;}
      if(result.conflict){
        window.dispatchEvent(new CustomEvent("dtsmart-toast",{detail:{message:result.message||"已加入冲突客户列表",type:"success"}}));
        window.location.assign("/customers/conflicts");
        return;
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
  const input=(key:string,label:string,required=false,type="text")=><label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{label}{required&&<b className="ml-1 text-rose-500">*</b>}</span><input required={required} type={type} value={form[key]} onChange={(e)=>set(key,e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/></label>;
  return <form onSubmit={submit} className="space-y-6"><section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="border-l-4 border-blue-600 pl-3 font-semibold">{editBasicOnly?"编辑客户原始资料":"客户信息"}</h3>{editBasicOnly?<p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">AI评分、AI等级、行业结论、官网核验联系方式及分析依据为只读数据，只能通过AI筛选任务更新。</p>:null}<div className="mt-5 grid gap-4 md:grid-cols-2">{input("company_name","客户/公司名称",true)}{input("country","国家/地区",true)}{input("contact_name","联系人")}{input("category","客户类型")}{input("phone","完整号码")}{input("email","邮箱",false,"email")}{input("whatsapp","WhatsApp")}{input("website","官网网址")}{input("google_url","Google地图网址")}{!editBasicOnly?input("industry","行业"):null}<label className="md:col-span-2"><span className="mb-1.5 block text-sm font-medium text-slate-700">地址</span><input value={form.address} onChange={(e)=>set("address",e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/></label><div className="rounded-lg bg-violet-50 px-3 py-2.5 text-sm text-violet-700"><b>客户阶段和跟进状态由用户单条维护</b><span className="mt-1 block text-xs">新增或导入的私有客户默认为潜在客户；保存后可在客户详情中手动变更，系统单据不会自动改动。</span></div>{input("tags","标签（用逗号分隔）")}<label className="md:col-span-2"><span className="mb-1.5 block text-sm font-medium text-slate-700">备注</span><textarea value={form.notes} onChange={(e)=>set("notes",e.target.value)} rows={3} maxLength={500} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/><span className="float-right text-xs text-slate-400">{form.notes.length}/500</span></label></div><p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">客户名称和国家为必填项；完整号码、邮箱、官网网址或Google地图网址至少填写一项。</p></section>{error&&<div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}<div className="flex justify-end gap-3"><button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm hover:bg-slate-50">取消</button><button disabled={saving} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{saving?"保存中…":analyzeAfterSave?"保存并进行AI筛选":"保存客户"}</button></div></form>;
}
