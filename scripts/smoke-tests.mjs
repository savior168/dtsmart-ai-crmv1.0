import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

const requiredRoutes = [
  "app/page.tsx",
  "app/customers/page.tsx",
  "app/customers/new/page.tsx",
  "app/import/page.tsx",
  "app/ai-screening/page.tsx",
  "app/ai-screening/new/page.tsx",
  "app/ai-screening/strategies/page.tsx",
  "app/ai-screening/tasks/[id]/page.tsx",
  "app/ai-screening/tasks/[id]/report/page.tsx",
  "app/ai-screening/results/page.tsx",
  "app/ai-screening/failures/page.tsx",
  "app/ai-screening/usage/page.tsx",
  "app/ai-screening/customers/[customerId]/evidence/page.tsx",
  "app/followups/page.tsx",
  "app/reports/page.tsx",
  "app/settings/page.tsx",
];

for (const route of requiredRoutes) {
  assert.equal(existsSync(resolve(root, route)), true, `缺少页面：${route}`);
}

const customerApi = read("app/api/customers/route.ts");
assert.doesNotMatch(customerApi, /query\s*=\s*query\.or\(`owner_id\.eq\.\$\{user\.id\},created_by\.eq\.\$\{user\.id\}`\)/, "客户查询必须由 Supabase RLS 统一控制，不能按创建人再次收窄");
assert.match(customerApi, /ai_score.*null/i, "AI待筛选查询必须包含未评分条件");
assert.match(customerApi, /customer_conflicts/, "手动新增的跨用户重复客户必须进入冲突队列");
assert.match(customerApi, /CROSS_OWNER_DUPLICATE/, "冲突记录必须使用跨归属人重复标记");

const aiApi = read("app/api/ai/analyze/route.ts");
assert.match(aiApi, /ai_screening_done/, "AI完成后必须写入筛选状态");
assert.doesNotMatch(aiApi, /OPENAI_API_KEY[^\n]*(NEXT_PUBLIC|return|json)/i, "服务端密钥不能返回前端");

const analysis = read("lib/ai/customer-analysis.ts");
assert.match(analysis, /"A"\s*\|\s*"B"\s*\|\s*"C"\s*\|\s*"D"/, "AI等级必须仅包含A/B/C/D");
assert.doesNotMatch(analysis, /"S"\s*\|/, "不能保留S级");

const taskRunner = read("lib/ai/run-customer-analysis.ts");
assert.match(taskRunner, /setTimeout\(\(\) => timeoutController\.abort\(\), 30_000\)/, "单个客户AI分析必须在30秒超时并继续后续客户");
assert.match(taskRunner, /input\.strategy === "DEEP"/, "AI执行器必须真实区分智能分析和深度分析");
assert.match(taskRunner, /website_email[\s\S]*website_phone/, "AI分析必须回写去重后的官网邮箱和官网电话");
const workflow = read("workflows/ai-screening.ts");
assert.match(workflow, /Promise\.all\(batch\.map/, "AI任务必须按可控并发持续执行，单条失败不能终止整批任务");
assert.match(workflow, /Promise\.race\(\[analysis, deadline\]\)/, "单个客户必须有独立30秒强制超时兜底");
assert.match(workflow, /AI_SCREENING_CONCURRENCY/, "AI任务并发量必须可通过服务端环境变量配置");
assert.match(workflow, /status: "COMPLETED"/, "单个客户失败不能把已跑完的整个任务标记为失败");
assert.match(workflow, /failTask\(input\.taskId/, "任务级异常必须单独标记整个任务失败");
assert.match(workflow, /order\("updated_at", \{ ascending: false \}\)/, "任务客户领取顺序必须按最近更新时间倒序");
const nextConfig = read("next.config.ts");
assert.match(nextConfig, /withWorkflow\(nextConfig\)/, "生产构建必须启用持久化Workflow");
const taskCenter = read("components/ai-screening/task-center-view.tsx");
for (const action of ["停止任务", "取消任务", "继续执行", "重试失败项"]) {
  assert.match(taskCenter, new RegExp(action), `任务中心缺少操作：${action}`);
}
assert.match(taskCenter, /status === "RUNNING"[\s\S]*action: "pause"[\s\S]*停止任务/, "执行中任务必须显示停止任务");
assert.match(taskCenter, /status === "QUEUED"[\s\S]*action: "cancel"[\s\S]*取消任务/, "排队中任务必须显示取消任务");
assert.match(taskCenter, /status === "PAUSED"[\s\S]*action: "resume"[\s\S]*继续执行/, "已停止任务必须显示继续执行");
assert.match(taskCenter, /status === "FAILED"[\s\S]*action: "retry"[\s\S]*重试失败项/, "失败任务必须显示重试失败项");
assert.match(taskCenter, /查看AI筛选用量/, "任务中心顶部必须提供清晰可识别的AI用量入口");
assert.match(taskCenter, /成功 \/ 失败[\s\S]*任务耗时/, "任务列表必须显示实时成功失败数量和任务耗时");
const taskActionApi = read("app/api/ai/tasks/[id]/route.ts");
assert.match(taskActionApi, /getRun[\s\S]*run\.cancel\(\)/, "停止任务必须真实取消当前持久工作流运行");
assert.match(taskActionApi, /status: "PAUSED"[\s\S]*elapsed_ms:/, "停止任务必须落为已停止并保存累计耗时");
assert.match(taskActionApi, /action === "resume"[\s\S]*start\(aiScreeningWorkflow/, "继续执行必须启动新的持久工作流处理剩余项");
const taskDetail = read("components/ai-screening/task-detail-view.tsx");
assert.match(taskDetail, /\["RUNNING", "PAUSING"\][\s\S]*"pause"[\s\S]*QUEUED" \? "cancel"[\s\S]*PAUSED" \? "resume"[\s\S]*FAILED" \|\|[\s\S]*COMPLETED"[\s\S]*"retry"/, "任务详情状态操作必须与任务中心一致");
for (const href of ["/ai-screening/new", "/ai-screening/results", "/ai-screening/failures", "/ai-screening/usage", "/ai-screening/tasks/"]) {
  assert.match(taskCenter, new RegExp(href.replaceAll("/", "\\/")), `任务中心缺少入口：${href}`);
}
const createTaskView = read("components/ai-screening/create-task-view.tsx");
assert.match(createTaskView, /useEffect\(\(\) => \{ void load\(true\)/, "创建任务首次进入必须加载并选中全部待筛选客户");
assert.match(createTaskView, /datetime-local/, "预约执行必须提供日期时间组合组件");
assert.match(createTaskView, /useState\(10\)/, "创建任务客户列表必须默认每页显示10条");
assert.match(createTaskView, /全选全部查询结果[\s\S]*清空选择/, "创建任务必须支持全部查询结果选择与清空");
assert.match(createTaskView, /\/ai-screening\/strategies/, "创建任务策略弹窗必须能进入完整策略说明");
const resultsApi = read("app/api/ai/results/route.ts");
assert.match(resultsApi, /for \(let offset = 0; ; offset \+= batchSize\)/, "结果导出必须分批读取全部筛选结果，不能受1000行上限影响");
const resultsView = read("components/ai-screening/results-view.tsx");
assert.match(resultsView, /查看分析依据/, "结果与报告必须能进入客户分析依据");
assert.match(resultsView, /全部任务/, "今日完成客户必须可按所属任务筛选");
const strategiesPage = read("app/ai-screening/strategies/page.tsx");
assert.match(strategiesPage, /返回任务中心/, "分析策略说明必须有返回任务中心出口");

const importView = read("components/import-view.tsx");
assert.match(importView, /async function isReadableImportFile/, "文件夹导入必须验证真实文件内容");
assert.match(importView, /file\.size <= 0/, "文件夹导入必须过滤空文件");
assert.match(importView, /const displayFailure = stats \?[^\n]+: 0;/, "确认导入前失败数必须为0");
assert.match(importView, /const displayFailure = stats \? stats\.failed_count : 0;/, "失败导入不能重复叠加校验错误数");
assert.match(importView, /const displayConflict = stats\?\.conflict_count \?\? 0;/, "确认导入前冲突数必须为0");
assert.match(importView, /if \(!importSessionSnapshot\.rows\.length\)[\s\S]*removeItem\(LAST_IMPORT_RESULT_KEY\)/, "没有匹配明细时必须清除陈旧导入统计");
assert.match(importView, /onClick=\{\(\) => void confirmImport\(\)\}/, "正式导入必须由确认按钮触发");
const taskRuntime = read("components/task-runtime.tsx");
assert.match(taskRuntime, /requestPath === "\/api\/import"/, "任务提示只能监听正式导入接口");
assert.doesNotMatch(taskRuntime, /requestUrl\.includes\("\/api\/import"\).*isImport/, "不能把导入预览误判为正式导入");
assert.match(importView, /href="\/customers\?tab=conflicts"/, "导入结果的冲突客户卡片必须切换到客户管理冲突页签");
assert.match(importView, /成功导入[\s\S]*失败导入[\s\S]*重复数据[\s\S]*冲突客户/, "完整导入报告必须包含四类结果页签");
assert.match(importView, /当前归属人/, "导入明细和冲突报告必须显示当前归属人");
const importApi = read("app/api/import/route.ts");
assert.match(importApi, /for \(let from = 0; ; from \+= 1000\)/, "导入去重必须分页读取全部现有客户，不能设置固定上限");
assert.match(importApi, /error\?\.code === "23505"/, "导入必须处理数据库并发唯一冲突");
assert.match(importApi, /客户已存在于我的客户列表，保留最先导入的数据/, "本人已有客户必须计入导入失败并保留最早记录");
assert.match(importApi, /status: "conflict", reason: "客户已归属其他销售员"/, "其他归属人的重复客户必须计入冲突客户");
assert.match(importApi, /owner_name:/, "冲突导入结果必须返回当前归属人");
const conflictApi = read("app/api/customer-conflicts/route.ts");
assert.match(conflictApi, /withOwner/, "冲突列表必须返回当前归属人信息");
assert.match(conflictApi, /\.eq\("reported_by", user\.id\)/, "冲突列表必须显式限定为当前用户提交的数据");
assert.match(conflictApi, /dedupeConflicts/, "冲突客户汇总必须去重");
const permanentDelete = read("lib/customers/soft-delete.ts");
assert.match(permanentDelete, /offset \+= 200/, "批量永久删除必须分批处理，避免大批量ID被截断");
assert.match(permanentDelete, /customer\.owner_id === userId/, "销售只能永久删除当前归属自己的客户");
assert.match(permanentDelete, /\.from\("customers"\)[\s\S]*?\.delete\(\)/, "客户删除必须从数据库物理删除");
assert.match(permanentDelete, /\["QUOTE", "DEAL"\]/, "报价中和成交客户必须禁止删除");

const appShell = read("components/app-shell.tsx");
assert.match(appShell, /sticky top-0[^\n]*h-screen/, "桌面左侧菜单必须固定在浏览器视口内");
assert.match(appShell, /h-\[calc\(100vh-196px\)\][^\n]*overflow-y-auto/, "菜单项必须独立滚动且不能推走底部控制项");
const customersView = read("components/customers-view.tsx");
assert.doesNotMatch(customersView, />\s*跟进待办/, "客户管理页签不得保留跟进待办");
assert.match(customersView, /CustomerProtectionPanel/, "保护到期必须在客户管理同页切换");
assert.match(customersView, /CustomerConflictsPanel/, "冲突客户必须在客户管理同页切换");
const dashboard = read("components/crm-dashboard.tsx");
assert.match(dashboard, /const protectionPageSize = 4/, "保护到期提醒必须限制单页数量");
assert.match(dashboard, /visibleProtections\.map/, "保护到期提醒必须只渲染当前页数据");

const migration = read("supabase/migrations/202608140001_v2_private_crm_compat.sql");
for (const table of [
  "organizations",
  "profiles",
  "customer_contacts",
  "customer_protections",
  "ai_screening_tasks",
  "ai_screening_results",
  "followup_reminders",
  "quotes",
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, "i"), `迁移缺少表：${table}`);
}
assert.match(migration, /customers_private_select/i, "迁移缺少客户私有读取策略");

const aiWorkflowMigration = read("supabase/migrations/202608200001_ai_screening_workflow.sql");
for (const field of ["strategy", "total_tokens", "cost_usd", "analyzed_channels", "source_channel"]) {
  assert.match(aiWorkflowMigration, new RegExp(field, "i"), `AI任务迁移缺少字段：${field}`);
}
assert.match(aiWorkflowMigration, /refresh_ai_screening_task_totals/i, "AI任务迁移缺少汇总函数");

const traceMigration = read("supabase/migrations/202608210001_ai_screening_trace_and_checkpoint.sql");
for (const field of ["channel_checkpoint", "last_completed_channel", "score_breakdown", "manual_review_status", "ai_screening_model_calls", "request_key"]) {
  assert.match(traceMigration, new RegExp(field, "i"), `AI追溯迁移缺少字段：${field}`);
}
const semanticFields = read("lib/ai/semantic-fields.ts");
assert.match(semanticFields, /AI_CUSTOMER_FIELD_CANDIDATES/, "AI筛选必须使用只读语义字段映射");
assert.match(semanticFields, /customer_name[\s\S]*company_name/, "AI字段映射必须兼容历史客户名称字段");
assert.match(taskRunner, /saveCheckpoint/, "AI筛选必须在每个渠道后保存断点");
assert.match(taskRunner, /saveModelCall/, "AI筛选必须记录每次OpenAI调用的Token和费用");

console.log("DTSmart CRM 烟雾测试通过：页面、权限、AI筛选和兼容迁移检查正常。");
