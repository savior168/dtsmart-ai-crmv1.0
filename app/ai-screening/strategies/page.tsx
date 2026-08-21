import Link from "next/link";
import { PageHeader, button, panel } from "@/components/ai-screening/ui";

const flow = ["客户官网", "Google商家主页", "LinkedIn", "Facebook", "Instagram", "其他"];

export default function AiScreeningStrategiesPage() {
  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
    <PageHeader title="AI分析策略说明" description="两种策略由系统固定维护。用户选择业务模式，OpenAI分析编排严格按所选策略执行并完整留痕。" actions={<Link href="/ai-screening" className={button}>返回任务中心</Link>}/>
    <section className="grid gap-4 lg:grid-cols-2">
      {[
        { name:"智能分析", tag:"默认推荐", tone:"border-blue-200 bg-blue-50/30 text-blue-700", intro:"逐渠道深度分析，结论可靠后提前停止，平衡准确度、时间和费用。", rules:["先执行字段清洗、主体匹配、缓存和关键词规则。","每完成一个可访问渠道，重新计算目标客户评分与判断置信度。","置信度超过90分、主体一致、有明确证据且没有关键矛盾时提前停止。","未达到停止条件时继续分析下一可用渠道；信息不足进入人工复核。"] },
        { name:"深度分析", tag:"完整核验", tone:"border-violet-200 bg-violet-50/30 text-violet-700", intro:"适用于重点客户、争议客户和对准确度要求更高的任务。", rules:["先执行同样的零成本规则、字段映射和缓存检查。","分析客户实际具备且可访问的全部公开渠道。","最后统一核验主体一致性、行业相关性、经营真实性和采购价值。","保存每个渠道的证据、失败原因、模型调用、Token和费用。"] },
      ].map(strategy=><article key={strategy.name} className={`${panel} overflow-hidden`}><div className="border-b border-[#e8ecf2] px-5 py-4"><span className={`rounded-md border px-2 py-1 text-xs ${strategy.tone}`}>{strategy.tag}</span><h2 className="mt-3 text-xl font-semibold">{strategy.name}</h2><p className="mt-1 text-sm text-[#68758a]">{strategy.intro}</p></div><div className="p-5"><div className="flex flex-wrap items-center gap-2 text-xs text-[#536177]">{flow.map((label,index)=><span key={label} className="contents"><span className="rounded-md border border-[#dfe5ee] bg-[#f7f9fc] px-2 py-1.5">{label}</span>{index<flow.length-1?<span className="text-[#9aa6b6]">→</span>:null}</span>)}</div><ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-6 text-[#5e6b7f]">{strategy.rules.map(rule=><li key={rule}>{rule}</li>)}</ul></div></article>)}
    </section>
    <section className={`${panel} overflow-hidden`}><div className="border-b border-[#e8ecf2] px-5 py-4"><h2 className="text-lg font-semibold">系统执行与留痕规则</h2><p className="mt-1 text-sm text-[#778397]">策略版本固定保存，历史任务和历史客户结果不会随以后策略升级而改变。</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#f7f9fc] text-[#58657a]"><tr>{["规则项","智能分析","深度分析"].map(label=><th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{[
      ["适用场景","常规批量筛选，默认选择","重点客户与高精度复核"],
      ["渠道顺序","官网 → Google商家主页 → LinkedIn → Facebook → Instagram → 其他","相同顺序，分析全部可访问渠道"],
      ["提前停止","置信度≥90、主体一致且无关键矛盾","不提前停止，跑完全部可访问渠道"],
      ["历史记录","策略、渠道状态、证据、停止原因、模型、Token和费用","策略、渠道状态、证据、模型、Token和费用"],
    ].map(row=><tr key={row[0]} className="border-t border-[#edf0f4]">{row.map((cell,index)=><td key={cell} className={`px-4 py-3 ${index===0?"font-semibold":"text-[#5e6b7f]"}`}>{cell}</td>)}</tr>)}</tbody></table></div></section>
  </div></main>;
}
