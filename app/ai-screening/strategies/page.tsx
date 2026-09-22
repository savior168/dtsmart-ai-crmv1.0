import Link from "next/link";
import { PageHeader, button, panel } from "@/components/ai-screening/ui";

const flow = ["字段清洗与主体匹配", "官网和免费公开来源", "证据足够立即完成", "必要时受控付费补证", "评分、依据与调用留痕"];

const modes = [
  {
    name: "智能分析",
    tag: "按需补证",
    tone: "border-blue-200 bg-blue-50/30 text-blue-700",
    intro: "优先完成免费证据链；仅当客户仍具潜在价值且关键证据存在冲突时，才在费用开关、单客户次数和日/周/月硬上限内补充付费证据。",
    rules: [
      "规则和已核验证据足以形成结论时立即停止，不调用Google Places付费详情或OpenAI。",
      "Google Places只核验主体匹配度最高的少数候选，同一客户最多按管理员配置调用2次。",
      "OpenAI只综合已经采集并通过主体校验的证据，同一客户最多调用1次，不自动重复重试。",
      "任一费用总开关、任务预算或日/周/月上限触发后，后端在调用前拦截并继续使用免费渠道。",
    ],
  },
  {
    name: "标准分析",
    tag: "零付费调用",
    tone: "border-emerald-200 bg-emerald-50/30 text-emerald-700",
    intro: "使用相同的主体核验、官网深度分析、证据规则和评分标准，但严格禁止所有正金额第三方API调用。",
    rules: [
      "分析已确认官网的首页、服务、关于我们、联系我们和必要的门店页面，并保留实际来源网址。",
      "使用可核验的免费公开入口及明确免费的Google Text Search IDs Only，不读取收费详情字段。",
      "不会把抓取失败、证据不足或主体冲突伪造成无效客户；结论只能来自已经取得的真实证据。",
      "所有渠道状态、提前停止原因和证据限制均写入分析依据，方便销售人员核对。",
    ],
  },
];

export default function AiScreeningStrategiesPage() {
  return <main className="min-h-full bg-[#f5f7fb] px-6 pb-8 pt-5 text-[#142033]"><div className="mx-auto max-w-[1680px] space-y-4">
    <PageHeader title="AI分析策略说明" description="本页与当前真实执行规则同步；两种模式的主体核验、证据标准和评分逻辑一致，仅允许使用的补证渠道不同。" actions={<Link href="/ai-screening" className={button}>返回任务中心</Link>}/>
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><b>执行环境：</b><span>所有AI筛选任务均由绑定账户的 Vercel 云端 Workflow 执行。执行环境不会改变分析代码、规则版本、费用保护或评分标准。</span></div>
    <section className="grid gap-4 lg:grid-cols-2">
      {modes.map(mode=><article key={mode.name} className={`${panel} overflow-hidden`}><div className="border-b border-[#e8ecf2] px-5 py-4"><span className={`rounded-md border px-2 py-1 text-xs ${mode.tone}`}>{mode.tag}</span><h2 className="mt-3 text-xl font-semibold">{mode.name}</h2><p className="mt-1 text-sm leading-6 text-[#68758a]">{mode.intro}</p></div><ul className="list-disc space-y-2 p-5 pl-10 text-sm leading-6 text-[#5e6b7f]">{mode.rules.map(rule=><li key={rule}>{rule}</li>)}</ul></article>)}
    </section>
    <section className={`${panel} overflow-hidden`}><div className="border-b border-[#e8ecf2] px-5 py-4"><h2 className="text-lg font-semibold">共同分析与评分规则</h2><p className="mt-1 text-sm text-[#778397]">以下规则不因分析模式或执行节点改变。</p></div><div className="p-5"><div className="flex flex-wrap items-center gap-2 text-xs text-[#536177]">{flow.map((label,index)=><span key={label} className="contents"><span className="rounded-md border border-[#dfe5ee] bg-[#f7f9fc] px-2 py-1.5">{label}</span>{index<flow.length-1?<span className="text-[#9aa6b6]">→</span>:null}</span>)}</div><div className="mt-5 grid gap-3 md:grid-cols-2">{[
      ["主体匹配","优先综合完整地址、国家、电话、邮箱域名和官网归属；名称只作辅助信号，名称变化不能单独否定主体。"],
      ["官网核验","仅在确认官网属于该客户后分析关键二、三级页面；无关商品页、聚合目录和其他商家内容不得混入。"],
      ["行业结论","手机/电脑维修、换屏、电池、充电口、主板、配件零售或批发等必须由可追溯经营事实支持；不能只靠原始类别。"],
      ["评分规则","按业务相关性、证据强度、主体置信度和规模价值分别计算，不使用统一59分或固定分数兜底。"],
      ["评论与社媒","Google评论只在主体已匹配且行业仍不清楚时使用；社媒必须匹配客户身份，取得足够事实后立即停止。"],
      ["联系方式","只回写已确认官网或已匹配商家页面公开的电话和邮箱，与原始联系方式标准化去重并保留来源，不覆盖原字段。"],
      ["冲突处理","官网确认属于客户时，经营事实优先于第三方页面；电话变化会作为新增联系方式和风险说明保留，不直接否定客户。"],
      ["审计留痕","保存规则版本、证据来源、渠道状态、停止原因、Google各SKU调用、模型、Token、费用和完成时间。"],
    ].map(([title,text])=><article key={title} className="rounded-lg border bg-slate-50 p-4"><b>{title}</b><p className="mt-1 text-sm leading-6 text-[#5e6b7f]">{text}</p></article>)}</div></div></section>
  </div></main>;
}
