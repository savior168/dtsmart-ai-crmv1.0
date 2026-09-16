export function CustomerScoreBadge({ score, level, emptyLabel="未筛选" }:{ score:number|null|undefined; level?:string|null; emptyLabel?:string }) {
  if(score==null)return <span className="text-slate-400">{emptyLabel}</span>;
  const tone=score>=80?"bg-emerald-50 text-emerald-700":score>=65?"bg-blue-50 text-blue-700":score>=50?"bg-orange-50 text-orange-700":"bg-rose-50 text-rose-600";
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${tone}`}>{level||"-"} · {score}</span>;
}
