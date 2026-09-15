"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AcquisitionUsageView } from "@/components/ai-acquisition/usage-view";
import { UsageView } from "@/components/ai-screening/usage-view";
import { PageHeader, button } from "@/components/ai-screening/ui";
import { AppTabs } from "@/components/ui/app-tabs";

type UsageModule = "screening" | "acquisition";

export function AiUsageCenter({ canViewScreening, canViewAcquisition, canViewCostCenter, initialModule }:{
  canViewScreening:boolean;
  canViewAcquisition:boolean;
  canViewCostCenter:boolean;
  initialModule:UsageModule;
}) {
  const router = useRouter();
  const items = [
    ...(canViewScreening ? [{ value:"screening" as const, label:"AI筛选", description:"分析调用、Token与费用明细" }] : []),
    ...(canViewAcquisition ? [{ value:"acquisition" as const, label:"AI获客", description:"发现、核验、入池与费用明细" }] : []),
  ];
  const fallback:UsageModule=canViewScreening?"screening":"acquisition";
  const active = items.some((item)=>item.value===initialModule) ? initialModule : fallback;

  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]">
    <div className="mx-auto max-w-[1680px] space-y-4">
      <PageHeader
        title="AI用量与费用"
        description="在一个页面统一查询AI筛选与AI获客用量；两类业务分别核算、互不重复，调用与费用均可追溯到具体任务。"
        actions={<div className="flex flex-wrap justify-end gap-2">{canViewCostCenter?<Link href="/settings/costs" className={button}>费用中心</Link>:null}<Link href={active==="acquisition"?"/ai-acquisition":"/ai-screening"} className={button}>返回{active==="acquisition"?"AI获客":"AI筛选"}任务中心</Link></div>}
      />
      <AppTabs
        value={active}
        label="AI用量业务类型"
        items={items}
        onChange={(value)=>router.replace(`/ai-usage?module=${value}`,{scroll:false})}
      />
      {active==="acquisition" ? <AcquisitionUsageView embedded/> : <UsageView embedded/>}
    </div>
  </main>;
}
