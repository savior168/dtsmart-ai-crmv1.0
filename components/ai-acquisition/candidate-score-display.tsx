import { CustomerScoreBadge } from "@/components/customer-score-badge";

export function CandidateScoreDisplay({candidate}:{candidate:{ai_score?:number|null;ai_level?:string|null;manual_score?:number|null;manual_level?:string|null}}){
  return candidate.manual_score!=null
    ? <span className="inline-flex flex-col gap-1"><span><CustomerScoreBadge score={candidate.manual_score} level={candidate.manual_level}/><small className="ml-1 text-blue-700">人工</small></span><small className="text-slate-400">原 AI：{candidate.ai_level||"—"} · {candidate.ai_score??"—"}</small></span>
    : <CustomerScoreBadge score={candidate.ai_score} level={candidate.ai_level}/>;
}
