import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * The task centre shell is intentionally access-controlled from day one.  The
 * acquisition API and executor are added alongside this route; this avoids a
 * menu permission that points at a missing route during staged deployment.
 */
export default function AiAcquisitionPage() {
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck size={23} /></span>
        <div>
          <h1 className="text-xl font-semibold text-slate-950">AI获客任务中心</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">获客任务只会把身份、目标匹配、在营状态、联系路径和去重校验均通过的企业送入客户公海；来源不足或存在冲突的记录保留在任务核验明细，不会自动分配给销售员。</p>
          <p className="mt-3 text-sm text-slate-500">任务创建、执行控制、查看依据、跨用户数据和费用控制均由“用户与权限”中的 AI获客独立权限控制。</p>
          <Link href="/settings/roles" className="mt-5 inline-flex h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">查看权限配置</Link>
        </div>
      </div>
    </section>
  </main>;
}
