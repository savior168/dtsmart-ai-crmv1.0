import { stockProgressLabel, type StockProgress } from "@/lib/stock-progress";

const colors: Record<string, string> = {
  WAITING: "bg-slate-400",
  PREPARING: "bg-amber-500",
  RECEIVED: "bg-cyan-500",
  SORTING: "bg-violet-500",
  READY_TO_SHIP: "bg-blue-500",
  SHIPPED: "bg-emerald-500",
};

export function StockProgressCell({ progress }: { progress: StockProgress }) {
  const exceptional = !Object.hasOwn(colors, progress.status);
  return <div className="min-w-44" aria-label={`备货流程：${stockProgressLabel(progress)}，${exceptional ? "不计入正常进度" : `${progress.percent}%`}；已回货 ${progress.received_units}/${progress.ordered_units} 件`}>
    <div className="flex items-center justify-between gap-2 text-xs"><span className="font-medium">{stockProgressLabel(progress)}</span><span>{exceptional ? "—" : `${progress.percent}%`}</span></div>
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={exceptional ? 0 : progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="备货流程阶段"><div className={`h-full rounded-full ${progress.status === "WAITING" && progress.percent > 0 ? "bg-amber-500" : colors[progress.status] || "bg-slate-300"}`} style={{ width: `${exceptional ? 0 : progress.percent}%` }}/></div>
    <small className="mt-1 block text-slate-500">回货 {progress.received_units}/{progress.ordered_units} 件</small>
  </div>;
}
