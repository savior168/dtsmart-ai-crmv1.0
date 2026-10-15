"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { ArrowLeft, FileDown, LoaderCircle, Printer } from "lucide-react";
import { CountryLabel } from "@/components/country-label";
import { downloadFilteredExport } from "@/lib/ui/download-filtered-export";

type PiItem = { line_number:number; item_name:string; brand:string|null; model:string|null; quality:string|null; description:string|null; quantity:number; unit_price:number; amount:number };
type PiPayload = { order:{ order_number:string; warehouse_reference_number:string|null; confirmation_method:string|null; status:string; customer_short_name:string; currency:string; created_at:string; pi_valid_until:string|null; delivery_date:string|null; payment_method:string|null; payment_account_snapshot:string|null; seller_company_name:string|null; seller_company_address:string|null; seller_website:string|null; seller_contact_name:string|null; seller_contact_phone:string|null; seller_contact_email:string|null; delivery_recipient:string|null; delivery_phone:string|null; delivery_email:string|null; delivery_address:string|null; subtotal:number; shipping_cost:number; total_amount:number }; items:PiItem[]; can_export:boolean };
type StockItem = { line_number:number; item_name:string; brand:string|null; model:string|null; quality:string|null; description:string|null; description_zh:string|null; quantity:number; estimated_unit_cost_cny:number|null; preparation_requirement:string|null; internal_note:string|null };
type StockPayload = { order:{ stock_number:string; warehouse_reference_number:string|null; order_number:string; customer_short_name:string; destination_country:string|null; status:string; stocking_requirements:string|null; expected_ready_at:string|null; created_at:string }; items:StockItem[]; can_export:boolean };

const printable = (status:string) => !["DRAFT","CANCELLED"].includes(status);
const date = (value:string|null|undefined) => value?.slice(0,10) || "—";
const money = (value:number|null|undefined) => Number(value || 0).toFixed(2);

export function OrderPrintPreview({kind,id}:{kind:"pi"|"stock";id:string}) {
  const [payload,setPayload]=useState<PiPayload|StockPayload|null>(null);
  const [error,setError]=useState("");
  const [downloading,setDownloading]=useState(false);
  useEffect(()=>{let active=true;void(async()=>{
    try {
      const response=await fetch(kind==="pi"?`/api/orders/${id}`:`/api/stock-orders/${id}`,{cache:"no-store"});
      const body=await response.json().catch(()=>({}));
      if(!active)return;
      if(!response.ok){setError(body.message||body.error||"单据加载失败，请返回列表重试");return}
      setPayload(body);
    } catch {
      if(active)setError("网络连接失败，请返回详情重试");
    }
  })();return()=>{active=false}},[kind,id]);
  const back=kind==="pi"?`/orders/${id}`:`/stock-orders/${id}`;
  async function download() {
    if(downloading||!payload)return;
    setDownloading(true);setError("");
    try {
      const number=kind==="pi"?((payload as PiPayload).order.warehouse_reference_number||(payload as PiPayload).order.order_number):((payload as StockPayload).order.warehouse_reference_number||(payload as StockPayload).order.order_number);
      await downloadFilteredExport(kind==="pi"?`/api/orders/${id}/export`:`/api/stock-orders/${id}/export`,`${number}${kind==="stock"?"-备货单":""}.xlsx`);
    } catch(cause){setError(cause instanceof Error?cause.message:"导出失败，请稍后重试")}
    finally{setDownloading(false)}
  }
  if(error&&!payload)return <main className="mx-auto max-w-3xl p-6"><Link href={back} className="text-blue-700 hover:underline">返回详情</Link><p role="alert" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">{error}</p></main>;
  if(!payload)return <main className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-blue-600" aria-label="正在加载单据"/></main>;
  const pi=kind==="pi"?(payload as PiPayload):null;
  const stock=kind==="stock"?(payload as StockPayload):null;
  const official=printable(payload.order.status) && payload.can_export;
  const number=pi?.order.warehouse_reference_number||pi?.order.order_number||stock?.order.warehouse_reference_number||stock?.order.order_number||"";
  return <main className="min-h-screen bg-slate-100 px-3 py-5 text-slate-900 print:bg-white print:p-0">
    <div className="mx-auto mb-4 flex max-w-[1100px] flex-wrap items-center justify-between gap-2 print:hidden">
      <Link href={back} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm"><ArrowLeft size={16}/>返回详情</Link>
      <div className="flex gap-2"><button type="button" onClick={()=>void download()} disabled={!official||downloading} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm disabled:opacity-50"><FileDown size={16}/>{downloading?"导出中…":"导出 Excel"}</button><button type="button" onClick={()=>window.print()} disabled={!official} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50"><Printer size={16}/>打印</button></div>
    </div>
    {error?<p role="alert" className="mx-auto mb-3 max-w-[1100px] rounded-lg bg-rose-50 p-3 text-sm text-rose-700 print:hidden">{error}</p>:null}
    {!official?<p className="mx-auto mb-3 max-w-[1100px] rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">当前单据尚未正式提交，或您的角色没有导出权限；仅供屏幕核对，不能作为正式单据下载或打印。</p>:null}
    <article className="mx-auto max-w-[1100px] bg-white p-5 text-xs shadow print:max-w-none print:p-0 print:shadow-none">
      {pi?<>
        <header className="grid min-h-[154px] grid-cols-2 overflow-hidden border border-slate-600"><div className="flex min-w-0 items-center gap-3 border-r border-slate-600 px-3 py-2"><Image src="/api/pi-logo" alt="DT-Smart logo" width={108} height={108} unoptimized className="h-[108px] w-[108px] shrink-0 object-contain"/><div className="min-w-0 text-[11px] leading-4"><h1 className="mb-1 text-base font-bold leading-5">{pi.order.seller_company_name||"DT-Smart Technology Co., Ltd"}</h1><p>Address: {pi.order.seller_company_address||"—"}</p><p>Official Website: {pi.order.seller_website||"—"}</p><p>Sales Manager: {pi.order.seller_contact_name}</p><p>Contact No: {pi.order.seller_contact_phone}</p><p>Email: {pi.order.seller_contact_email}</p></div></div><div className="grid min-w-0 grid-cols-2 grid-rows-[38px_repeat(3,minmax(0,1fr))] text-center text-[11px]"><b className="grid place-items-center bg-[#70ad47] px-2 text-sm">COMMERCIAL INVOICE</b><b className="grid place-items-center break-all border-l border-slate-600 bg-[#70ad47] px-2 text-sm">{number}</b><span className="grid place-items-center border-t border-slate-300 px-2">QUOTATION VALID</span><span className="grid place-items-center border-l border-t border-slate-300 px-2">{date(pi.order.pi_valid_until)}</span><span className="grid place-items-center border-t border-slate-300 px-2">PAYMENT / METHOD:</span><span className="grid place-items-center border-l border-t border-slate-300 px-2">{pi.order.payment_method||"—"} ({pi.order.currency})</span><span className="grid place-items-center border-t border-slate-300 px-2">DELIVERY DATE</span><span className="grid place-items-center border-l border-t border-slate-300 px-2">{date(pi.order.delivery_date)}</span></div></header>
        <section className="mt-4 border border-slate-600"><h2 className="border-b border-slate-600 px-2 py-1 font-bold text-rose-700">Delivery Info&nbsp; ⚠ To ensure that you receive the product safely, please confirm the accuracy of the shipping information.</h2><div className="grid grid-cols-2"><div className="border-r border-slate-600 px-2 py-1.5 leading-4"><p>To: {pi.order.delivery_recipient||pi.order.customer_short_name}</p><p>TEL: {pi.order.delivery_phone||"—"}</p><p>Company: {pi.order.customer_short_name}</p><p>Email: {pi.order.delivery_email||"—"}</p></div><div className="px-2 py-1.5"><b>Delivery address:</b> <span className="whitespace-pre-wrap break-words">{pi.order.delivery_address||"—"}</span></div></div></section>
        <p className="mt-1 text-center text-base font-bold italic text-blue-600">Thanks your business!</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[950px] table-fixed border-collapse text-center"><colgroup><col className="w-[5%]"/><col className="w-[12%]"/><col className="w-[9%]"/><col className="w-[12%]"/><col className="w-[14%]"/><col className="w-[17%]"/><col className="w-[13%]"/><col className="w-[8%]"/><col className="w-[10%]"/></colgroup><thead className="bg-[#e2efda]"><tr>{["No.","Items","Brand","Models","Quality","Description",`Unit Price (${pi.order.currency})`,"Quantity",`Amount (${pi.order.currency})`].map(label=><th key={label} className={label.startsWith("Amount") || label.startsWith("Unit Price") ? "border border-slate-600 px-2 py-2 text-right font-bold" : "border border-slate-600 px-1 py-2 font-bold"}>{label}</th>)}</tr></thead><tbody>{pi.items.map(item=><tr key={item.line_number} className="h-7"><td className="border border-slate-500 px-1">{item.line_number}</td><td className="border border-slate-500 px-1">{item.item_name}</td><td className="border border-slate-500 px-1">{item.brand}</td><td className="border border-slate-500 px-1">{item.model}</td><td className="border border-slate-500 px-1">{item.quality||""}</td><td className="border border-slate-500 px-1">{item.description||""}</td><td className="border border-slate-500 px-2 text-right tabular-nums">{pi.order.currency} {money(item.unit_price)}</td><td className="border border-slate-500 px-2 text-right tabular-nums">{item.quantity}</td><td className="border border-slate-500 px-2 text-right tabular-nums">{pi.order.currency} {money(item.amount??item.unit_price*item.quantity)}</td></tr>)}{Array.from({length:Math.max(0,9-pi.items.length)},(_,index)=><tr key={`empty-${index}`} className="h-6">{Array.from({length:9},(_,column)=><td key={column} className="border border-slate-500"/>)}</tr>)}</tbody><tfoot><tr className="h-7"><td colSpan={6} className="border-r border-slate-500"/><th scope="row" className="border border-slate-500 px-2 text-right tabular-nums">SUBTOTAL:</th><td className="border border-slate-500">{pi.items.reduce((sum,item)=>sum+item.quantity,0)}</td><td className="border border-slate-500 px-2 text-right tabular-nums font-bold text-blue-800">{pi.order.currency} {money(pi.order.subtotal)}</td></tr><tr className="h-7"><td colSpan={6} className="border-r border-slate-500"/><th scope="row" className="border border-slate-500 px-2 text-right tabular-nums">SHIPPING COST:</th><td className="border border-slate-500"/><td className="border border-slate-500 px-2 text-right tabular-nums font-bold text-blue-800">{pi.order.currency} {money(pi.order.shipping_cost)}</td></tr><tr className="h-8"><td colSpan={6} className="border-r border-slate-500"/><th scope="row" className="border border-slate-500 px-2 text-right tabular-nums">TOTAL AMOUNT:</th><td className="border border-slate-500"/><td className="border border-slate-500 bg-yellow-200 px-2 text-right tabular-nums font-bold text-red-700">{pi.order.currency} {money(pi.order.total_amount)}</td></tr></tfoot></table></div>
        <footer className="mt-0"><h2 className="border border-slate-600 bg-slate-100 py-1 text-center font-bold">**PAYMENT INFORMATION**</h2><p className="min-h-24 whitespace-pre-wrap break-words border-x border-b border-slate-600 p-2 font-bold text-blue-800">{pi.order.payment_account_snapshot}</p><div className="grid grid-cols-2 border-x border-b border-slate-600 text-center"><div className="border-r border-slate-600 p-1">Signature By Supplier:</div><div className="p-1">Signature By Buyer:</div><div className="border-r border-t border-slate-600 p-1">DT-SMART</div><div className="border-t border-slate-600 p-1">{pi.order.customer_short_name}</div><div className="border-r border-t border-slate-600 p-1">{date(pi.order.created_at)}</div><div className="border-t border-slate-600 p-1">{date(pi.order.created_at)}</div></div></footer>
      </>:null}
      {stock?<>
        <header className="border-b-2 border-slate-700 pb-3"><h1 className="text-xl font-bold">备货单</h1><div className="mt-2 grid grid-cols-2 gap-1"><p>订单编号：{number}</p><p>备货单号：{stock.order.stock_number}</p><p>客户名称：{stock.order.customer_short_name}</p><p>目的国家：<CountryLabel value={stock.order.destination_country}/></p><p>创建日期：{date(stock.order.created_at)}</p><p>预计备妥：{date(stock.order.expected_ready_at)}</p></div><p className="mt-2">理货要求：{stock.order.stocking_requirements||"常规理货"}</p></header>
        <div className="overflow-x-auto"><table className="mt-3 w-full border-collapse text-left"><thead className="bg-slate-100"><tr>{["序号","产品类型","产品品牌","产品型号","产品质量","产品描述","成本单价（人民币）","数量","中文质量/描述（仓库）","理货要求","仓库备注"].map(label=><th key={label} className="border border-slate-500 p-1.5">{label}</th>)}</tr></thead><tbody>{stock.items.map(item=><tr key={item.line_number}><td className="border p-1.5">{item.line_number}</td><td className="border p-1.5">{item.item_name}</td><td className="border p-1.5">{item.brand}</td><td className="border p-1.5">{item.model}</td><td className="border p-1.5">{item.quality}</td><td className="border p-1.5">{item.description}</td><td className="border p-1.5 text-right">{item.estimated_unit_cost_cny===null?"—":money(item.estimated_unit_cost_cny)}</td><td className="border p-1.5 text-right">{item.quantity}</td><td className="border p-1.5">{item.description_zh}</td><td className="border p-1.5">{item.preparation_requirement}</td><td className="border p-1.5">{item.internal_note}</td></tr>)}</tbody></table></div>
        <p className="mt-3 text-right font-semibold">总成本价（人民币）：{stock.items.every(item=>item.estimated_unit_cost_cny!==null)?`¥${money(stock.items.reduce((sum,item)=>sum+Number(item.estimated_unit_cost_cny)*Number(item.quantity),0))}`:"—"}</p>
      </>:null}
    </article>
    <style jsx global>{`@media print{@page{size:A4 landscape;margin:10mm} .crm-topbar,aside{display:none!important}.crm-content{min-height:0!important}body{background:#fff!important}thead{display:table-header-group}tr{break-inside:avoid}article{box-shadow:none!important}button{display:none!important}}`}</style>
  </main>;
}
