import Link from "next/link";
import { PageHeader, button, panel } from "@/components/ai-screening/ui";

const flow = ["官网与零Token公开来源优先核验", "结论不足时按需使用Google Places", "仅高价值疑难客户最多一次模型判断"];

export default function AiScreeningStrategiesPage() {
  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
    <PageHeader title="AI分析策略说明" description="系统自动按证据充分度选择分析深度，用户无需在技术模式之间判断；全部来源、调用和费用均完整留痕。" actions={<Link href="/ai-screening" className={button}>返回任务中心</Link>}/>
    <section className="grid gap-4">
      {[
        { name:"智能自适应分析", tag:"系统自动", tone:"border-blue-200 bg-blue-50/30 text-blue-700", intro:"适用于全部批量筛选，按证据充分度自动停止或升级，兼顾真实性、速度和费用。", rules:["先执行字段清洗、主体匹配和当前规则版本的可靠结果复用。","先深入读取已确认官网和零Token公开来源；直接证据足够时立即完成。","结论不足时才按需查询Google Places，并只为少数候选读取较高费用字段。","仅对仍有潜在价值的疑难客户最多调用1次模型，并保存证据、Token、费用与停止原因。"] },
      ].map(strategy=><article key={strategy.name} className={`${panel} overflow-hidden`}><div className="border-b border-[#e8ecf2] px-5 py-4"><span className={`rounded-md border px-2 py-1 text-xs ${strategy.tone}`}>{strategy.tag}</span><h2 className="mt-3 text-xl font-semibold">{strategy.name}</h2><p className="mt-1 text-sm text-[#68758a]">{strategy.intro}</p></div><div className="p-5"><div className="flex flex-wrap items-center gap-2 text-xs text-[#536177]">{flow.map((label,index)=><span key={label} className="contents"><span className="rounded-md border border-[#dfe5ee] bg-[#f7f9fc] px-2 py-1.5">{label}</span>{index<flow.length-1?<span className="text-[#9aa6b6]">→</span>:null}</span>)}</div><ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-6 text-[#5e6b7f]">{strategy.rules.map(rule=><li key={rule}>{rule}</li>)}</ul></div></article>)}
    </section>
    <section className={`${panel} overflow-hidden`}><div className="border-b border-[#e8ecf2] px-5 py-4"><h2 className="text-lg font-semibold">系统执行与留痕规则</h2><p className="mt-1 text-sm text-[#778397]">规则版本固定保存，历史任务和历史客户结果不会随以后策略升级而改变。</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#f7f9fc] text-[#58657a]"><tr>{["规则项","智能自适应分析"].map(label=><th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{[
      ["适用场景","全部批量筛选，无需用户选择技术模式"],
      ["优先证据","已确认官网与零Token公开来源优先；不足时按需使用Google Places"],
      ["模型调用","规则足够则0次；仅高价值疑难客户最多1次"],
      ["历史记录","规则版本、渠道状态、证据、停止原因、Google Places调用、模型、Token和费用"],
    ].map(row=><tr key={row[0]} className="border-t border-[#edf0f4]">{row.map((cell,index)=><td key={cell} className={`px-4 py-3 ${index===0?"font-semibold":"text-[#5e6b7f]"}`}>{cell}</td>)}</tr>)}</tbody></table></div></section>
  </div></main>;
}
