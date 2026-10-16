"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoaderCircle, Printer } from "lucide-react";
import { OrderPrintPreview, type PiPayload, type StockPayload } from "@/components/order-print-preview";
import { batchExportFilename } from "@/lib/export-file-name";

type Kind = "pi" | "stock";
type SelectedDocument = { id: string; payload: PiPayload | StockPayload };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function BatchOrderPrintPreview({ kind }: { kind: Kind }) {
  const [documents, setDocuments] = useState<SelectedDocument[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const label = kind === "pi" ? "PI" : "备货单";
  const returnPath = kind === "pi" ? "/orders" : "/stock-orders";

  useEffect(() => {
    let active = true;
    const ids = new URLSearchParams(window.location.search).getAll("id");
    if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length || ids.some((id) => !uuid.test(id))) {
      setError(`请从${label}列表勾选 1 至 50 张正式单据后再导出 PDF`);
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const result: SelectedDocument[] = [];
        for (let offset = 0; offset < ids.length; offset += 5) {
          const batch = await Promise.all(ids.slice(offset, offset + 5).map(async (id) => {
            const response = await fetch(kind === "pi" ? `/api/orders/${id}` : `/api/stock-orders/${id}`, { cache: "no-store" });
            const payload = await response.json() as (PiPayload | StockPayload) & { error?: string };
            if (!response.ok) throw new Error(payload.error || `${label}加载失败`);
            if (!payload.can_export || ["DRAFT", "CANCELLED"].includes(payload.order.status) ||
                (kind === "pi" && (payload as PiPayload).order.confirmation_method !== "DIRECT_PI")) {
              throw new Error(`单据 ${payload.order.warehouse_reference_number || payload.order.order_number} 无权导出或不属于正式${label}`);
            }
            return { id, payload };
          }));
          result.push(...batch);
        }
        if (active) setDocuments(result);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "批量 PDF 预览失败");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [kind, label]);

  useEffect(() => {
    const original = document.title;
    const beforePrint = () => { document.title = batchExportFilename(kind === "pi" ? "PI订单" : "备货单", "pdf").replace(/\.pdf$/i, ""); };
    const afterPrint = () => { document.title = original; };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      document.title = original;
    };
  }, [kind]);

  return <div className="min-h-screen bg-slate-100">
    <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-3 py-4 print:hidden">
      <Link href={returnPath} className="rounded-lg border bg-white px-3 py-2 text-sm">返回{label}列表</Link>
      <div className="flex items-center gap-3 text-sm"><span>已核对 {documents.length} 张；在打印窗口选择“另存为 PDF”</span><button type="button" disabled={loading || Boolean(error) || !documents.length} onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"><Printer size={16}/>导出 PDF</button></div>
    </div>
    {loading ? <p className="mx-auto flex max-w-[1100px] items-center gap-2 p-5 text-sm"><LoaderCircle className="animate-spin" size={17}/>正在核对所选{label}的权限与内容…</p> : null}
    {error ? <p role="alert" className="mx-auto max-w-[1100px] rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p> : null}
    {!loading && !error ? documents.map(({ id, payload }) => <OrderPrintPreview key={id} kind={kind} id={id} initialPayload={payload} embedded/>) : null}
  </div>;
}
