"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, FileDown, LoaderCircle, Printer } from "lucide-react";
import { CountryLabel } from "@/components/country-label";
import { downloadFilteredExport } from "@/lib/ui/download-filtered-export";
import { stockProgressLabel, summarizeStockProgress } from "@/lib/stock-progress";
import { createPiDocumentModel, DEFAULT_OFFICIAL_WEBSITE } from "@/lib/pi-document-model";
import { documentExportFilename } from "@/lib/export-file-name";

type PiItem = { line_number:number; item_name:string; brand:string|null; model:string|null; quality:string|null; description:string|null; quantity:number; unit_price:number; unit_price_cny:number|null; amount:number };
export type PiPayload = { order:{ order_number:string; warehouse_reference_number:string|null; confirmation_method:string|null; status:string; customer_short_name:string; customer?:{company_name:string|null;contact_name:string|null;tax_number:string|null}|null; currency:string; show_dual_currency_prices?:boolean|null; created_at:string; pi_valid_until:string|null; delivery_date:string|null; payment_method:string|null; payment_account_snapshot:string|null; seller_company_name:string|null; seller_company_address:string|null; seller_website:string|null; seller_contact_name:string|null; seller_contact_phone:string|null; seller_contact_email:string|null; delivery_recipient:string|null; delivery_phone:string|null; delivery_email:string|null; delivery_address:string|null; subtotal:number; subtotal_cny?:number|null; shipping_cost:number; shipping_cny?:number|null; total_amount:number; total_cny?:number|null; last_balance_amount?:number|null; last_balance_cny?:number|null; discount_amount?:number|null; discount_cny?:number|null; other_charge_amount?:number|null; other_charge_cny?:number|null; paypal_fee_percent?:number|null; paypal_fee_amount?:number|null; paypal_fee_cny?:number|null }; items:PiItem[]; can_export:boolean };
type StockItem = { line_number:number; item_name:string; brand:string|null; model:string|null; quality:string|null; description:string|null; description_zh:string|null; quantity:number; received_quantity:number; prepared_quantity:number; shipped_quantity:number; preparation_status:string; estimated_unit_cost_cny:number|null; preparation_requirement:string|null; internal_note:string|null };
export type StockPayload = { order:{ stock_number:string; warehouse_reference_number:string|null; order_number:string; customer_short_name:string; customer_name:string|null; forwarder_address:string|null; destination_country:string|null; status:string; stocking_requirements:string|null; expected_ready_at:string|null; created_at:string }; items:StockItem[]; can_export:boolean };

const printable = (status:string) => !["DRAFT","CANCELLED"].includes(status);
const date = (value:string|null|undefined) => value?.slice(0,10) || "—";
const money = (value:number|null|undefined) => Number(value || 0).toFixed(2);

function PiAmount({currency,paid,cny,dual}:{currency:string;paid:number;cny:number;dual:boolean}) {
  return dual ? <><span className="block">CNY ¥{money(cny)}</span><span className="block">{currency} {money(paid)}</span></> : <>{currency} {money(paid)}</>;
}

function PiDualCurrencyTable({document,feeRows}:{document:NonNullable<ReturnType<typeof createPiDocumentModel>>;feeRows:(string|number)[][]}) {
  const amountCell="border border-slate-500 px-1.5 py-1 text-right tabular-nums font-semibold text-blue-800";
  const feeRow=(label:string,paid:number,cny:number,highlight=false)=><tr key={label}>
    <td colSpan={6} className="border-r border-slate-500"/>
    <th colSpan={2} scope="row" className="border border-slate-500 px-2 py-1 text-right">{label}</th>
    <td className="border border-slate-500"/>
    <td className={`${amountCell} ${highlight?"bg-yellow-200 text-red-700":""}`}>¥{money(cny)}</td>
    <td className={`${amountCell} ${highlight?"bg-yellow-200 text-red-700":""}`}>{document.currency} {money(paid)}</td>
  </tr>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[1050px] table-fixed border-collapse text-center print:min-w-0">
    <colgroup>{[4,10,8,10,10,14,9,9,6,10,10].map((width,index)=><col key={index} style={{width:`${width}%`}}/>)}</colgroup>
    <thead className="bg-[#e2efda]"><tr>{["No.","Items","Brand","Models","Quality","Description","Unit Price (CNY)",`Unit Price (${document.currency})`,"Quantity","Amount (CNY)",`Amount (${document.currency})`].map(label=><th key={label} className="border border-slate-600 px-1 py-2 text-[11px] font-bold leading-4">{label}</th>)}</tr></thead>
    <tbody>{document.items.map(item=><tr key={item.lineNumber} className="h-8"><td className="border border-slate-500 px-1">{item.lineNumber}</td><td className="border border-slate-500 px-1">{item.itemName}</td><td className="border border-slate-500 px-1">{item.brand}</td><td className="border border-slate-500 px-1">{item.model}</td><td className="border border-slate-500 px-1">{item.quality}</td><td className="border border-slate-500 px-1">{item.description}</td><td className={amountCell}>¥{money(item.unitPriceCny)}</td><td className={amountCell}>{document.currency} {money(item.unitPrice)}</td><td className="border border-slate-500">{item.quantity}</td><td className={amountCell}>¥{money(item.amountCny)}</td><td className={amountCell}>{document.currency} {money(item.amount)}</td></tr>)}
      {Array.from({length:Math.max(0,9-document.items.length)},(_,index)=><tr key={`empty-${index}`} className="h-6">{Array.from({length:11},(_,column)=><td key={column} className="border border-slate-500"/>)}</tr>)}</tbody>
    <tfoot><tr><td colSpan={6} className="border-r border-slate-500"/><th colSpan={2} scope="row" className="border border-slate-500 px-2 py-1 text-right">SUBTOTAL:</th><td className="border border-slate-500">{document.totalQuantity}</td><td className={amountCell}>¥{money(document.subtotalCny)}</td><td className={amountCell}>{document.currency} {money(document.subtotal)}</td></tr>
      {feeRow("SHIPPING COST:",document.shippingCost,document.shippingCostCny)}
      {feeRows.map(([label,paid,cny])=>feeRow(String(label),Number(paid),Number(cny)))}
      {feeRow("TOTAL AMOUNT:",document.totalAmount,document.totalAmountCny,true)}</tfoot>
  </table></div>;
}

export function OrderPrintPreview({kind,id,initialPayload,embedded=false}:{kind:"pi"|"stock";id:string;initialPayload?:PiPayload|StockPayload;embedded?:boolean}) {
  const [payload,setPayload]=useState<PiPayload|StockPayload|null>(initialPayload||null);
  const [error,setError]=useState("");
  const [downloading,setDownloading]=useState(false);
  const [printTime,setPrintTime]=useState("");
  useEffect(()=>{
    if(embedded)return;
    const originalTitle=document.title;
    const beforePrint=()=>{
      flushSync(()=>setPrintTime(new Date().toLocaleString("zh-CN",{hour12:false})));
      const exportNumber=kind==="pi"?(payload as PiPayload | null)?.order.order_number:(payload as StockPayload | null)?.order.stock_number;
      document.title=exportNumber ? documentExportFilename(exportNumber,kind==="pi"?"PI订单":"备货单","pdf").replace(/\.pdf$/i,"") : kind==="pi"?"PI订单":"备货单";
    };
    const afterPrint=()=>{document.title=originalTitle};
    window.addEventListener("beforeprint",beforePrint);
    window.addEventListener("afterprint",afterPrint);
    return()=>{window.removeEventListener("beforeprint",beforePrint);window.removeEventListener("afterprint",afterPrint);document.title=originalTitle};
  },[kind,embedded,payload]);
  useEffect(()=>{if(initialPayload)return;let active=true;void(async()=>{
    try {
      const response=await fetch(kind==="pi"?`/api/orders/${id}`:`/api/stock-orders/${id}`,{cache:"no-store"});
      const body=await response.json().catch(()=>({}));
      if(!active)return;
      if(!response.ok){setError(body.message||body.error||"单据加载失败，请返回列表重试");return}
      setPayload(body);
    } catch {
      if(active)setError("网络连接失败，请返回详情重试");
    }
  })();return()=>{active=false}},[kind,id,initialPayload]);
  useEffect(()=>{
    if(embedded||!payload||!payload.can_export||!printable(payload.order.status)||new URLSearchParams(window.location.search).get("export")!=="pdf")return;
    const timer=window.setTimeout(()=>window.print(),500);
    return()=>window.clearTimeout(timer);
  },[payload,embedded]);
  const back=kind==="pi"?`/orders/${id}`:`/stock-orders/${id}`;
  async function download() {
    if(downloading||!payload)return;
    setDownloading(true);setError("");
    try {
      const number=kind==="pi"?(payload as PiPayload).order.order_number:(payload as StockPayload).order.stock_number;
      await downloadFilteredExport(kind==="pi"?`/api/orders/${id}/export`:`/api/stock-orders/${id}/export`,documentExportFilename(number,kind==="pi"?"PI订单":"备货单","xlsx"));
    } catch(cause){setError(cause instanceof Error?cause.message:"导出失败，请稍后重试")}
    finally{setDownloading(false)}
  }
  if(error&&!payload)return <main className="mx-auto max-w-3xl p-6"><Link href={back} className="text-blue-700 hover:underline">返回详情</Link><p role="alert" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">{error}</p></main>;
  if(!payload)return <main className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-blue-600" aria-label="正在加载单据"/></main>;
  const pi=kind==="pi"?(payload as PiPayload):null;
  const stock=kind==="stock"?(payload as StockPayload):null;
  const stockStatus=stock ? stock.order.status === "DRAFT" && stock.order.warehouse_reference_number
    ? "已撤回，待重新提交" : stockProgressLabel(summarizeStockProgress(stock.order.status,stock.items)) : "";
  const piDocument=pi?createPiDocumentModel(pi.order,pi.items):null;
  const piFeeRows=piDocument ? [
    ["UNPAID BALANCE:", piDocument.lastBalance, piDocument.lastBalanceCny],
    ["OTHER CHARGES:", piDocument.otherCharge, piDocument.otherChargeCny],
    ["DISCOUNT:", -piDocument.discount, -piDocument.discountCny],
    [`PAYPAL FEE (${piDocument.paypalFeePercent}%):`, piDocument.paypalFee, piDocument.paypalFeeCny],
  ].filter(([,amount])=>Number(amount)!==0) : [];
  const official=printable(payload.order.status) && payload.can_export;
  const number=pi?.order.warehouse_reference_number||pi?.order.order_number||stock?.order.warehouse_reference_number||stock?.order.order_number||"";
  return <main className={`print-root min-h-screen bg-slate-100 px-3 py-5 text-slate-900 print:bg-white print:p-0 ${embedded ? "document-print-batch-page" : ""}`}>
    {!embedded?<div className="mx-auto mb-4 flex max-w-[1100px] flex-wrap items-center justify-between gap-2 print:hidden">
      <Link href={back} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm"><ArrowLeft size={16}/>返回详情</Link>
      {official?<div className="flex gap-2"><button type="button" onClick={()=>void download()} disabled={downloading} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm disabled:opacity-50"><FileDown size={16}/>{downloading?"导出中…":"导出 Excel"}</button><button type="button" onClick={()=>window.print()} title="在打印窗口中选择“另存为 PDF”即可导出 PDF" className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm"><FileDown size={16}/>导出 PDF</button><button type="button" onClick={()=>window.print()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white"><Printer size={16}/>打印</button></div>:null}
    </div>:null}
    {error?<p role="alert" className="mx-auto mb-3 max-w-[1100px] rounded-lg bg-rose-50 p-3 text-sm text-rose-700 print:hidden">{error}</p>:null}
    {!official?<p className="mx-auto mb-3 max-w-[1100px] rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">当前单据尚未正式提交，或您的角色没有导出权限；仅供屏幕核对，不能作为正式单据下载或打印。</p>:null}
    <p className="mb-2 text-center text-xs text-slate-500 sm:hidden print:hidden">左右滑动查看完整单据</p>
    <div className="overflow-x-auto print:overflow-visible">
    <article className={`mx-auto w-[1100px] max-w-none bg-white text-xs ${stock ? "rounded-xl border border-slate-200 p-6 shadow-sm print:w-auto print:rounded-none print:border-0 print:p-0 print:shadow-none" : "pi-print-document p-5 shadow print:p-0 print:shadow-none"}`}>
      {pi?<>
        <header className={`grid min-h-[154px] overflow-hidden border border-slate-600 ${piDocument!.showDualCurrencyPrices ? "grid-cols-[48%_52%]" : "grid-cols-[52%_48%]"}`}>
          <div className="flex min-w-0 items-center gap-4 border-r border-slate-600 px-4 py-3">
            <Image src="/api/pi-logo" alt="DT-Smart logo" width={96} height={96} unoptimized className="h-24 w-24 shrink-0 object-contain"/>
            <div className="min-w-0 text-[11px] leading-[18px]"><h1 className="mb-1 text-[15px] font-bold leading-5">{piDocument!.companyName}</h1><p>Address: {piDocument!.companyAddress}</p><p>Official Website: {piDocument!.website}</p><p>Sales Manager: {piDocument!.salesManager}</p><p>Contact No: {piDocument!.contactPhone}</p><p>Email: {piDocument!.contactEmail}</p></div>
          </div>
          <div className={`grid min-w-0 grid-rows-[38px_repeat(3,minmax(0,1fr))] text-center text-[11px] ${piDocument!.showDualCurrencyPrices ? "grid-cols-[47%_53%]" : "grid-cols-2"}`}>
            <b className="grid place-items-center bg-[#70ad47] px-2 text-sm">COMMERCIAL INVOICE</b><b className="grid place-items-center break-all border-l border-slate-600 bg-[#70ad47] px-2 text-sm">{piDocument!.orderNumber}</b><span className="grid place-items-center border-t border-slate-300 px-2">QUOTATION VALID</span><span className="grid place-items-center border-l border-t border-slate-300 px-2">{piDocument!.quotationValidUntil}</span><span className="grid place-items-center border-t border-slate-300 px-2">PAYMENT / METHOD:</span><span className="grid place-items-center border-l border-t border-slate-300 px-2">{piDocument!.paymentMethod}</span><span className="grid place-items-center border-t border-slate-300 px-2">DELIVERY DATE</span><span className="grid place-items-center border-l border-t border-slate-300 px-2">{piDocument!.deliveryDate}</span>
          </div>
        </header>
        <section className="mt-4 border border-slate-600"><h2 className="border-b border-slate-600 px-2 py-1 font-bold text-rose-700">Delivery Info&nbsp; ⚠ To ensure that you receive the product safely, please confirm the accuracy of the shipping information.</h2><div className="grid grid-cols-2"><div className="min-w-0 space-y-0.5 border-r border-slate-600 px-2 py-1.5 leading-4"><p className="break-words">Company: {piDocument!.deliveryCompany}</p>{piDocument!.deliveryTaxNumber ? <p className="break-words">Tax No.: {piDocument!.deliveryTaxNumber}</p> : null}<p className="break-words">To: {piDocument!.recipient} <span className="mx-1 text-slate-400">·</span> TEL: {piDocument!.deliveryPhone}</p><p className="break-words">Email: {piDocument!.deliveryEmail}</p></div><div className="min-w-0 px-2 py-1.5">Delivery address: <span className="whitespace-pre-wrap break-words">{piDocument!.deliveryAddress}</span></div></div></section>
        <p className="mt-1 text-center text-base font-bold italic text-blue-600">Thanks your business!</p>
        {piDocument!.showDualCurrencyPrices ? <PiDualCurrencyTable document={piDocument!} feeRows={piFeeRows}/> : null}
        {!piDocument!.showDualCurrencyPrices ? (
        <div className="overflow-x-auto"><table className="w-full min-w-[950px] table-fixed border-collapse text-center print:min-w-0"><colgroup><col className="w-[5%]"/><col className="w-[12%]"/><col className="w-[9%]"/><col className="w-[12%]"/><col className="w-[14%]"/><col className="w-[17%]"/><col className="w-[13%]"/><col className="w-[8%]"/><col className="w-[10%]"/></colgroup><thead className="bg-[#e2efda]"><tr>{["No.","Items","Brand","Models","Quality","Description",piDocument!.showDualCurrencyPrices ? `Unit Price (CNY / ${piDocument!.currency})` : `Unit Price (${piDocument!.currency})`,"Quantity",piDocument!.showDualCurrencyPrices ? `Amount (CNY / ${piDocument!.currency})` : `Amount (${piDocument!.currency})`].map(label=><th key={label} className={label.startsWith("Amount") || label.startsWith("Unit Price") ? "border border-slate-600 px-2 py-2 text-right font-bold" : "border border-slate-600 px-1 py-2 font-bold"}>{label}</th>)}</tr></thead><tbody>{piDocument!.items.map(item=><tr key={item.lineNumber} className="h-7"><td className="border border-slate-500 px-1">{item.lineNumber}</td><td className="border border-slate-500 px-1">{item.itemName}</td><td className="border border-slate-500 px-1">{item.brand}</td><td className="border border-slate-500 px-1">{item.model}</td><td className="border border-slate-500 px-1">{item.quality}</td><td className="border border-slate-500 px-1">{item.description}</td><td className="border border-slate-500 px-2 text-right tabular-nums">{piDocument!.showDualCurrencyPrices ? <><span className="block">CNY ¥{money(item.unitPriceCny)}</span><span className="block">{piDocument!.currency} {money(item.unitPrice)}</span></> : <>{piDocument!.currency} {money(item.unitPrice)}</>}</td><td className="border border-slate-500 px-2 text-right tabular-nums">{item.quantity}</td><td className="border border-slate-500 px-2 text-right tabular-nums"><PiAmount currency={piDocument!.currency} paid={item.amount} cny={item.amountCny} dual={piDocument!.showDualCurrencyPrices}/></td></tr>)}{Array.from({length:Math.max(0,9-piDocument!.items.length)},(_,index)=><tr key={`empty-${index}`} className="h-6">{Array.from({length:9},(_,column)=><td key={column} className="border border-slate-500"/>)}</tr>)}</tbody><tfoot><tr className="h-7"><td colSpan={6} className="border-r border-slate-500"/><th scope="row" className="border border-slate-500 px-2 text-right tabular-nums">SUBTOTAL:</th><td className="border border-slate-500">{piDocument!.totalQuantity}</td><td className="border border-slate-500 px-2 text-right tabular-nums font-bold text-blue-800"><PiAmount currency={piDocument!.currency} paid={piDocument!.subtotal} cny={piDocument!.subtotalCny} dual={piDocument!.showDualCurrencyPrices}/></td></tr><tr className="h-7"><td colSpan={6} className="border-r border-slate-500"/><th scope="row" className="border border-slate-500 px-2 text-right tabular-nums">SHIPPING COST:</th><td className="border border-slate-500"/><td className="border border-slate-500 px-2 text-right tabular-nums font-bold text-blue-800"><PiAmount currency={piDocument!.currency} paid={piDocument!.shippingCost} cny={piDocument!.shippingCostCny} dual={piDocument!.showDualCurrencyPrices}/></td></tr>{piFeeRows.map(([label,amount,amountCny])=><tr key={String(label)} className="h-7"><td colSpan={6} className="border-r border-slate-500"/><th scope="row" className="border border-slate-500 px-2 text-right tabular-nums">{label}</th><td className="border border-slate-500"/><td className="border border-slate-500 px-2 text-right tabular-nums font-bold text-blue-800"><PiAmount currency={piDocument!.currency} paid={Number(amount)} cny={Number(amountCny)} dual={piDocument!.showDualCurrencyPrices}/></td></tr>)}<tr className="h-8"><td colSpan={6} className="border-r border-slate-500"/><th scope="row" className="border border-slate-500 px-2 text-right tabular-nums">TOTAL AMOUNT:</th><td className="border border-slate-500"/><td className="border border-slate-500 bg-yellow-200 px-2 text-right tabular-nums font-bold text-red-700"><PiAmount currency={piDocument!.currency} paid={piDocument!.totalAmount} cny={piDocument!.totalAmountCny} dual={piDocument!.showDualCurrencyPrices}/></td></tr></tfoot></table></div>
        ) : null}
        <footer className="mt-0"><h2 className="border border-slate-600 bg-slate-100 py-1 text-center font-bold">**PAYMENT INFORMATION**</h2><p className="min-h-24 whitespace-pre-wrap break-words border-x border-b border-slate-600 p-2 font-bold text-blue-800">{pi.order.payment_account_snapshot}</p><div className="grid grid-cols-2 border-x border-b border-slate-600 text-center"><div className="border-r border-slate-600 p-1">Signature By Supplier:</div><div className="p-1">Signature By Buyer:</div><div className="border-r border-t border-slate-600 p-1">DT-SMART</div><div className="border-t border-slate-600 p-1">{piDocument!.deliveryCompany}</div><div className="border-r border-t border-slate-600 p-1">{piDocument!.issueDate}</div><div className="border-t border-slate-600 p-1">{piDocument!.issueDate}</div></div></footer>
      </>:null}
      {stock?<>
        <header className="border-b border-slate-200 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-800 pb-4">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Warehouse picking list</p><h1 className="mt-1 text-2xl font-bold tracking-tight">备货单</h1></div>
            <div className="rounded-lg bg-slate-900 px-4 py-2 text-right text-white"><p className="text-[10px] text-slate-300">备货单号</p><p className="mt-0.5 text-sm font-semibold tabular-nums">{stock.order.stock_number}</p></div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            {[["客户名称", stock.order.customer_name || "未填写"], ["公司名称", stock.order.customer_short_name], ["订单编号", number], ["目的国家", <CountryLabel key="country" value={stock.order.destination_country}/>], ["当前状态", stockStatus], ["创建日期", date(stock.order.created_at)], ["预计备货完成日期", date(stock.order.expected_ready_at)]].map(([label, value])=><div key={String(label)} className="min-w-0 rounded-lg bg-slate-50 px-3 py-2"><dt className="text-[10px] text-slate-500">{label}</dt><dd className="mt-1 truncate font-medium text-slate-800">{value}</dd></div>)}
          </dl>
          <section className="mt-4 rounded-lg border-l-4 border-amber-400 bg-amber-50/70 px-4 py-3">
            <h2 className="text-xs font-semibold text-slate-800">整单理货要求</h2>
            <p className="mt-1 whitespace-pre-wrap break-words leading-5 text-[#986C47]">{stock.order.stocking_requirements?.trim() || "常规理货"}</p>
          </section>
          <section className="mt-3 rounded-lg border border-slate-200 px-4 py-2"><h2 className="text-xs font-semibold text-slate-700">本单货代地址</h2><p className="mt-1 break-words">{stock.order.forwarder_address || "未填写"}</p></section>
        </header>
        <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-2">
          <div><p className="text-[10px] text-slate-500">订单总数量</p><p className="mt-1 text-lg font-semibold tabular-nums">{stock.items.reduce((sum,item)=>sum+Number(item.quantity||0),0).toLocaleString("zh-CN")} <span className="text-xs font-normal text-slate-500">件</span></p></div>
          <div className="text-right"><p className="text-[10px] text-slate-500">采购成本</p><p className="mt-1 text-lg font-semibold tabular-nums">{stock.items.every(item=>item.estimated_unit_cost_cny!==null)?`¥${money(stock.items.reduce((sum,item)=>sum+Number(item.estimated_unit_cost_cny)*Number(item.quantity),0))}`:"—"}</p></div>
        </div>
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[1000px] table-fixed border-collapse text-left print:min-w-0"><colgroup><col className="w-[4%]"/><col className="w-[8%]"/><col className="w-[8%]"/><col className="w-[10%]"/><col className="w-[10%]"/><col className="w-[11%]"/><col className="w-[8%]"/><col className="w-[7%]"/><col className="w-[14%]"/><col className="w-[20%]"/></colgroup><thead className="bg-[#dae3f5]"><tr>{["序号","产品类型","产品品牌","产品型号","产品质量","产品描述","成本单价","订单数量","产品质量/描述中文","注意事项及理货要求"].map((label,index)=><th key={label} className="border-b border-r border-slate-300 px-2 py-2 text-center align-middle font-semibold leading-4 text-slate-800 last:border-r-0">{label}{[4,5,8,9].includes(index)?<small className="block text-[9px] font-semibold text-rose-600">（{index===4||index===5?"展示给客户":"展示给后端"}）</small>:null}</th>)}</tr></thead><tbody>{stock.items.map(item=><tr key={item.line_number} className="border-t border-slate-200 even:bg-slate-50/60"><td className="border-r border-slate-200 px-2 py-2 text-center tabular-nums">{item.line_number}</td><td className="border-r border-slate-200 px-2 py-2">{item.item_name}</td><td className="border-r border-slate-200 px-2 py-2">{item.brand||"—"}</td><td className="border-r border-slate-200 px-2 py-2">{item.model||"—"}</td><td className="border-r border-slate-200 px-2 py-2">{item.quality||"—"}</td><td className="border-r border-slate-200 px-2 py-2">{item.description||"—"}</td><td className="border-r border-slate-200 px-2 py-2 text-right tabular-nums">{item.estimated_unit_cost_cny===null?"—":money(item.estimated_unit_cost_cny)}</td><td className="border-r border-slate-200 px-2 py-2 text-right tabular-nums">{item.quantity}</td><td className="border-r border-slate-200 px-2 py-2">{item.description_zh||"—"}</td><td className="whitespace-pre-line px-2 py-2 leading-4 text-[#986C47]">{[item.preparation_requirement?`理货要求：${item.preparation_requirement}`:"",item.internal_note?`仓库备注：${item.internal_note}`:""].filter(Boolean).join("\n")||"—"}</td></tr>)}</tbody></table></div>
        <p className="mt-2 text-right text-[10px] text-slate-500">成本按 PI 预估成本单价 × 订单数量汇总；单项理货要求与仓库备注分行展示。</p>
      </>:null}
      <footer className="mt-3 hidden flex-wrap justify-between gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-[10px] text-slate-500 print:flex"><span>Official website: {piDocument?.website||DEFAULT_OFFICIAL_WEBSITE}</span><span>Printed at: {printTime||new Date().toLocaleString("zh-CN",{hour12:false})}</span></footer>
    </article>
    </div>
    <style jsx global>{`@media print{@page{size:A4 ${kind === "pi" ? "portrait" : "landscape"};margin:0}.print-root{padding:10mm!important}.crm-topbar,aside{display:none!important}.crm-content{min-height:0!important}body{background:#fff!important}thead{display:table-header-group}tr{break-inside:avoid}article{box-shadow:none!important}button{display:none!important}.pi-print-document{width:1100px!important;max-width:none!important;padding:20px!important;zoom:.64;print-color-adjust:exact;-webkit-print-color-adjust:exact}.pi-print-document table{min-width:950px!important}.document-print-batch-page{min-height:0!important;break-after:page}.document-print-batch-page:last-of-type{break-after:auto}}`}</style>
  </main>;
}
