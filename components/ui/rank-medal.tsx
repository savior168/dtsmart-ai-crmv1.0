import { useId } from "react";

const metals = [
  { top: "#f5d879", bottom: "#c79420", ribbon: "#a86f16", edge: "#a97916" },
  { top: "#eef2f6", bottom: "#9aa7b5", ribbon: "#6f7f90", edge: "#8794a2" },
  { top: "#e8b18a", bottom: "#a75b34", ribbon: "#854526", edge: "#99502e" },
];

export function RankMedal({ rank, className = "" }: { rank: number; className?: string }) {
  if (rank > 3) return <span aria-label={`第${rank}名`} className={`inline-grid h-7 min-w-7 place-items-center rounded-full bg-slate-100 px-1 text-[11px] font-semibold tabular-nums text-slate-500 ${className}`}>#{rank}</span>;
  const colors = metals[Math.max(0, rank - 1)];
  const id = useId().replace(/:/g, "");
  return <svg role="img" aria-label={`第${rank}名`} viewBox="0 0 32 36" className={`h-8 w-7 shrink-0 drop-shadow-sm ${className}`}>
    <defs><linearGradient id={`medal-${id}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={colors.top}/><stop offset="1" stopColor={colors.bottom}/></linearGradient></defs>
    <path d="M8 19 6 34l10-5 10 5-2-15" fill={colors.ribbon}/>
    <circle cx="16" cy="13" r="11" fill={`url(#medal-${id})`} stroke={colors.edge} strokeWidth="1.5"/>
    <circle cx="16" cy="13" r="8" fill="none" stroke="#ffffff" strokeOpacity=".8" strokeWidth="1"/>
    <text x="16" y="17" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{rank}</text>
  </svg>;
}
