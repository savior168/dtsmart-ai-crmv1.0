import Link from "next/link";
import { PageHeader, button, panel } from "@/components/ai-screening/ui";

const flow = ["官网 + Google商家并行核验", "必要时补充已确认公开渠道", "规则引擎或OpenAI判断"];

export default function AiScreeningStrategiesPage() {
  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
    <PageHeader title="AI分析策略说明" description="两种策略由系统固定维护。用户选择业务模式，OpenAI分析编排严格按所选策略执行并完整留痕。" actions={<Link href="/ai-screening" className={button}>返回任务中心</Link>}/>
    <section className="grid gap-4 lg:grid-cols-2">
      {[
        { name:"智能分析", tag:"默认推荐", tone:"border-blue-200 bg-blue-50/30 text-blue-700", intro:"适用于日常批量筛选，优先使用免费规则与高价值证据，兼顾速度、准确度和费用。", rules:["先执行字段清洗、主体匹配和跨用户可靠结果复用。","并行读取已确认官网与Google商家；直接证据足够时由规则引擎完成，不调用OpenAI。","仍无法可靠判断时，按需补充已发现且能确认主体的官方公开渠道。","最后最多调用1次快速模型，并保存证据、模型、Token、费用与停止原因。"] },
        { name:"深度分析", tag:"加强核验", tone:"border-violet-200 bg-violet-50/30 text-violet-700", intro:"适用于重点客户或证据矛盾场景；增加模型核验深度，但不机械遍历无关渠道。", rules:["同样先执行缓存、规则、官网与Google商家并行核验。","直接证据足够时立即完成，避免重复抓取已经不会改变结论的渠道。","证据不足时补充已确认官方渠道并使用深度模型；存在关键矛盾时最多再执行1次升级核验。","完整保存主体匹配、渠道证据、冲突、模型调用、Token和费用。"] },
      ].map(strategy=><article key={strategy.name} className={`${panel} overflow-hidden`}><div className="border-b border-[#e8ecf2] px-5 py-4"><span className={`rounded-md border px-2 py-1 text-xs ${strategy.tone}`}>{strategy.tag}</span><h2 className="mt-3 text-xl font-semibold">{strategy.name}</h2><p className="mt-1 text-sm text-[#68758a]">{strategy.intro}</p></div><div className="p-5"><div className="flex flex-wrap items-center gap-2 text-xs text-[#536177]">{flow.map((label,index)=><span key={label} className="contents"><span className="rounded-md border border-[#dfe5ee] bg-[#f7f9fc] px-2 py-1.5">{label}</span>{index<flow.length-1?<span className="text-[#9aa6b6]">→</span>:null}</span>)}</div><ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-6 text-[#5e6b7f]">{strategy.rules.map(rule=><li key={rule}>{rule}</li>)}</ul></div></article>)}
    </section>
    <section className={`${panel} overflow-hidden`}><div className="border-b border-[#e8ecf2] px-5 py-4"><h2 className="text-lg font-semibold">系统执行与留痕规则</h2><p className="mt-1 text-sm text-[#778397]">策略版本固定保存，历史任务和历史客户结果不会随以后策略升级而改变。</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#f7f9fc] text-[#58657a]"><tr>{["规则项","智能分析","深度分析"].map(label=><th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{[
      ["适用场景","常规批量筛选，默认选择","重点客户与高精度复核"],
      ["优先证据","官网与Google商家并行；不足时才补充官方公开渠道","相同证据顺序，但对不足或矛盾证据做更深核验"],
      ["模型调用","规则足够则0次；否则最多1次快速模型","规则足够则0次；必要时深度模型，矛盾时最多再核验1次"],
      ["历史记录","策略、渠道状态、证据、停止原因、模型、Token和费用","策略、渠道状态、证据、模型、Token和费用"],
    ].map(row=><tr key={row[0]} className="border-t border-[#edf0f4]">{row.map((cell,index)=><td key={cell} className={`px-4 py-3 ${index===0?"font-semibold":"text-[#5e6b7f]"}`}>{cell}</td>)}</tr>)}</tbody></table></div></section>
  </div></main>;
}
