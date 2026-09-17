"use client";

import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { button } from "@/components/ai-screening/ui";

type UsageModule = "screening" | "acquisition";

export function TodayUsageLink({ module }: { module: UsageModule }) {
  return <Link
    href={`/ai-usage?business_type=${module}`}
    className={`${button} shrink-0`}
    title="查看今日及历史AI调用与费用明细"
  >
    <BarChart3 size={16}/>
    <span>AI用量与费用</span>
  </Link>;
}
