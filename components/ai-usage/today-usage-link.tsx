"use client";

import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";
import { button, formatCost, formatNumber } from "@/components/ai-screening/ui";
import { quickCostDateRange } from "@/lib/cost-center";

type UsageModule = "screening" | "acquisition";
type TodayUsage = { calls: number; cost: number };

export function TodayUsageLink({ module, scopeUserId = "", todayUsage }: { module: UsageModule; scopeUserId?: string; todayUsage?:TodayUsage|null }) {
  const [fetchedToday, setFetchedToday] = useState<TodayUsage | null>(null);
  const today = todayUsage === undefined ? fetchedToday : todayUsage;

  useEffect(() => {
    if (todayUsage !== undefined) return;
    let active = true;
    const range = quickCostDateRange("TODAY");
    const params = new URLSearchParams({ from: range.from, to: range.to, page: "1", pageSize: "10" });
    if (scopeUserId) params.set("user_id", scopeUserId);
    const endpoint = module === "acquisition" ? "/api/ai-acquisition/usage" : "/api/ai/usage";
    void fetch(`${endpoint}?${params}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (!active || !body) return;
        if (module === "acquisition") {
          setFetchedToday({ calls: Number(body.summary?.calls || 0), cost: Number(body.summary?.total_cost_usd || 0) });
          return;
        }
        setFetchedToday({
          calls: Number(body.selected?.model_calls || 0) + Number(body.selected?.google_places_calls || 0),
          cost: Number(body.selected?.openai_cost || 0) + Number(body.selected?.google_places_cost || 0),
        });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [module, scopeUserId, todayUsage]);

  return <Link
    href={`/ai-usage?module=${module}`}
    className={`${button} shrink-0`}
    title="查看今日及历史AI调用与费用明细"
  >
    <BarChart3 size={16}/>
    <span>AI用量与费用</span>
    {today ? <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">今日 {formatNumber(today.calls)}次 · {formatCost(today.cost)}</span> : null}
  </Link>;
}
