import { STOCK_BUCKETS, type StockProgress } from "@/lib/stock-progress";

export function StockProgressCell({ progress }: { progress: StockProgress }) {
  if (progress.ordered_units <= 0) return <span className="text-xs text-slate-500">暂无备货数量</span>;
  const exceptional = ["DRAFT", "SHORTAGE", "CANCELLED"].includes(progress.status);
  return <div className="min-w-56" aria-label={`备货共 ${progress.ordered_units} 件；${STOCK_BUCKETS.map((bucket) =>
    `${bucket.label} ${progress.buckets[bucket.key].units} 件，占 ${progress.buckets[bucket.key].percent}%`).join("；")}`}>
    {exceptional ? <p className="mb-1 text-xs font-medium text-rose-700">{progress.status === "DRAFT" ? "未提交仓库" : progress.status === "SHORTAGE" ? "存在缺货异常" : "已取消"} · 以下为已记录的实物进度</p> : null}
    <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="备货各环节件数占比，合计100%">
      {STOCK_BUCKETS.map((bucket) => <div key={bucket.key} className={bucket.color}
        style={{ width: `${progress.buckets[bucket.key].percent}%` }}/>) }
    </div>
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
      {STOCK_BUCKETS.map((bucket) => <span key={bucket.key} className="whitespace-nowrap">
        <span className={`mr-1 inline-block size-2 rounded-sm ${bucket.color}`}/>
        {bucket.label} {progress.buckets[bucket.key].units}/{progress.ordered_units} · {progress.buckets[bucket.key].percent}%
      </span>)}
    </div>
  </div>;
}
