import { STOCK_BUCKETS, type StockProgress } from "@/lib/stock-progress";

export function StockProgressCell({ progress, wide = false }: { progress: StockProgress; wide?: boolean }) {
  if (progress.ordered_units <= 0) return <span className="text-xs text-slate-500">暂无备货数量</span>;
  const exceptional = ["DRAFT", "SHORTAGE", "CANCELLED"].includes(progress.status);
  const progressDetails = STOCK_BUCKETS.map((bucket) =>
    `${bucket.label}：${progress.buckets[bucket.key].units} 件（${progress.buckets[bucket.key].percent}%）`).join("；");
  return <div className={wide ? "w-full overflow-x-auto" : "min-w-[390px] max-w-[420px]"} aria-label={`备货共 ${progress.ordered_units} 件；${STOCK_BUCKETS.map((bucket) =>
    `${bucket.label} ${progress.buckets[bucket.key].units} 件，占 ${progress.buckets[bucket.key].percent}%`).join("；")}`}>
    {exceptional ? <p className="mb-1 text-xs font-medium text-rose-700">{progress.status === "DRAFT" ? "未提交仓库" : progress.status === "SHORTAGE" ? "存在缺货异常" : "已取消"} · 以下为已记录的实物进度</p> : null}
    <div className={wide ? "min-w-[390px]" : ""}>
      <div className={`flex h-3 overflow-hidden rounded-full bg-slate-100 ${wide ? "" : "cursor-help"}`} role="img" aria-label={`备货各环节件数占比：${progressDetails}`} title={wide ? undefined : progressDetails}>
        {STOCK_BUCKETS.map((bucket) => {
          const value = progress.buckets[bucket.key];
          if (value.percent <= 0) return null;
          const detail = `${bucket.label}：${value.units} 件（${value.percent}%）`;
          return <span key={bucket.key} className={`${bucket.color} ${wide ? "" : "transition-[filter] hover:brightness-90"}`}
            style={{ width: `${value.percent}%` }} title={detail} aria-label={detail}/>;
        })}
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1 text-[10px] leading-4 text-slate-700">
        {STOCK_BUCKETS.map((bucket) => {
          const value = progress.buckets[bucket.key];
          return <span key={bucket.key} title={`${bucket.label}：${value.units}件 · ${value.percent}%`} className="min-w-0 rounded-md bg-slate-50 px-1 py-1">
            <span className="flex min-w-0 items-center gap-1"><span className={`size-2 shrink-0 rounded-sm ${bucket.color}`}/><span className="truncate text-slate-600">{bucket.shortLabel}</span></span>
            <span className="block whitespace-nowrap font-semibold tabular-nums">{value.units}件·{value.percent}%</span>
          </span>;
        })}
      </div>
    </div>
  </div>;
}
