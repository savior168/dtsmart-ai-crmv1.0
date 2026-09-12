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
  "app/settings/users/page.tsx",
  "app/settings/roles/page.tsx",
  "app/settings/audit/page.tsx",
  "app/settings/security/page.tsx",
];

for (const route of requiredRoutes) {
  assert.equal(existsSync(resolve(root, route)), true, `缺少页面：${route}`);
}

const customerApi = read("app/api/customers/route.ts");
assert.doesNotMatch(customerApi, /query\s*=\s*query\.or\(`owner_id\.eq\.\$\{user\.id\},created_by\.eq\.\$\{user\.id\}`\)/, "客户查询必须由 Supabase RLS 统一控制，不能按创建人再次收窄");
assert.match(customerApi, /ai_status[\s\S]*PENDING[\s\S]*COMPLETED[\s\S]*FAILED/, "AI分析状态必须由明确的待分析、已分析和失败状态区分，不能仅依赖评分是否为空");
assert.match(customerApi, /customer_conflicts/, "手动新增的跨用户重复客户必须进入冲突队列");
assert.match(customerApi, /CROSS_OWNER_DUPLICATE/, "冲突记录必须使用跨归属人重复标记");
assert.match(customerApi, /options === "industries"[\s\S]*new Set\(values\)/, "所属行业筛选项必须从当前用户全部客户中动态去重生成");
assert.match(customerApi, /searchParams\.getAll\("industry"\)/, "所属行业筛选必须读取全部多选值");
assert.match(customerApi, /industries\.length === 1[\s\S]*\.eq\("industry", industries\[0\]\)[\s\S]*industries\.length > 1[\s\S]*\.in\("industry"/, "所属行业筛选必须对单选和多选执行精确查询");
assert.match(customerApi, /countrySearchTokens\(search\)[\s\S]*country\.ilike/, "统一客户关键词必须同时支持国家代码和国家名称");
const customerListProjection = customerApi.match(/const customerListFields = \[([\s\S]*?)\]\.join/)?.[1] || "";
assert.doesNotMatch(customerListProjection, /"followup_status"/, "兼容迁移未上线时，客户列表不得强制请求可选 followup_status 列");

const aiApi = read("app/api/ai/analyze/route.ts");
assert.match(aiApi, /dispatchAiScreeningTask/, "保存并筛选必须进入持久化混合调度任务，不能绕过证据与写回流程");
assert.match(aiApi, /ai_screening_task_items/, "兼容分析接口必须创建可追踪的任务客户记录");
assert.doesNotMatch(aiApi, /OPENAI_API_KEY[^\n]*(NEXT_PUBLIC|return|json)/i, "服务端密钥不能返回前端");

const analysis = read("lib/ai/customer-analysis.ts");
assert.match(analysis, /"A"\s*\|\s*"B"\s*\|\s*"C"\s*\|\s*"D"/, "AI等级必须仅包含A/B/C/D");
assert.doesNotMatch(analysis, /"S"\s*\|/, "不能保留S级");
assert.match(analysis, /EXCEL_IMPORT[\s\S]*绝不是进口商/, "导入来源标签不得作为进口商或行业证据");
assert.match(analysis, /groundCustomerAnalysis/, "AI结论必须经过证据一致性校验");
assert.match(analysis, /discoverPublicSourceUrls[\s\S]*max_output_tokens: 600[\s\S]*tools: \[\{ type: "web_search", search_context_size: "low" \}\]/, "网页搜索只能使用低上下文受控网址发现请求");
assert.doesNotMatch(analysis, /const recoveryTools/, "完整分析模型不得启用网页搜索造成重复抓取和Token浪费");
assert.doesNotMatch(analysis, /add\(input\.website\);\s*add\(input\.google_url\)/, "未实际读取的输入网址不得自动视为有效证据来源");

const reuseCache = read("lib/ai/reuse-cache.ts");
assert.match(reuseCache, /reusableEvidenceIsTraceable/, "跨用户复用结果必须先验证可追溯中文证据");
assert.match(reuseCache, /AI_RULE_VERSION\s*=\s*"2026\.09\.12\.03"/, "规则版本升级后旧版无证据或未完整写回的缓存必须失效");
assert.match(reuseCache, /ai_screening_evidence[\s\S]*source_result_id/, "跨用户复用前必须核验来源结果和真实证据行");
const taskRunner = read("lib/ai/run-customer-analysis.ts");
assert.match(taskRunner, /automation_status: finalAutomationStatus/, "任务客户必须保存最终自动处理状态");
assert.doesNotMatch(taskRunner, /setTimeout\(\(\) => timeoutController\.abort\(\), 30_000\)/, "不得用30秒整客户硬超时丢弃已抓取证据");
assert.match(taskRunner, /analyzeWithRecovery/, "高价值疑似客户可使用一次模型综合分析");
assert.doesNotMatch(taskRunner, /all_available_sources_retry|canRecoverModelCall/, "单客户模型调用不得自动重试并重复消耗费用");
assert.match(taskRunner, /input\.strategy === "DEEP"/, "AI执行器必须真实区分智能分析和深度分析");
assert.match(taskRunner, /website_email[\s\S]*website_phone/, "AI分析必须回写去重后的官网邮箱和官网电话");
assert.match(taskRunner, /collectChannel\(customer, "website"[\s\S]*collectIndexedPublicEvidence[\s\S]*collectChannel\(customer, "google_maps"/, "AI筛选必须先使用官网和零Token公开索引，结论不足时才调用Places");
assert.match(taskRunner, /id: randomUUID\(\)/, "复用证据必须生成新的主键，不能写入空ID");
assert.match(taskRunner, /score: publishedScore, grade: publishedLevel/, "明确结论必须保存评分；待定结论不得伪造低分");
const taskDetailApi = read("app/api/ai/tasks/[id]/route.ts");
const taskItemsCostApi = read("app/api/ai/tasks/[id]/items/route.ts");
const taskDetailCostView = read("components/ai-screening/task-detail-view.tsx");
assert.match(taskDetailApi, /api_cost_ledger[\s\S]*provider", "GOOGLE_PLACES"[\s\S]*google_places_call_count/, "任务详情必须从真实费用流水汇总Places调用次数");
assert.match(taskItemsCostApi, /select\("id,score,grade,target_decision,industry_type"\)/, "已分析客户必须返回本任务AI核验行业");
assert.match(taskItemsCostApi, /api_cost_ledger[\s\S]*placesByCustomer[\s\S]*google_places_call_count/, "客户明细必须逐条汇总本任务Places调用次数");
assert.match(taskDetailCostView, /Google Places调用[\s\S]*AI核验行业[\s\S]*Places调用/, "任务详情必须显示任务与客户级Places次数及AI核验行业");
assert.doesNotMatch(taskRunner, /AI_EVIDENCE_GATE_NOT_SATISFIED/, "资料不足不得被错误标记为任务执行失败");
assert.doesNotMatch(taskRunner, /JSON\.stringify\(item\.evidence\)/, "不得把原始证据JSON直接保存或展示给业务员");
const evidenceApi = read("app/api/ai/evidence/[customerId]/route.ts");
assert.match(evidenceApi, /verified_contacts/, "AI依据接口必须返回可追溯的新联系方式");
assert.match(evidenceApi, /isUsableEvidence/, "依据接口必须过滤失败码、原始JSON和不可追溯记录");
assert.match(evidenceApi, /GOOGLE_MAPS_API_KEY\|fetch failed/, "依据接口不得向业务员展示内部抓取错误码");
const evidenceView = read("components/ai-screening/evidence-view.tsx");
assert.match(evidenceView, /VerifiedContactsSection/, "AI依据页必须在结论附近显眼展示已核实联系方式");
assert.match(evidenceView, /<span>客户详情<\/span>/, "AI分析依据页必须显示客户详情按钮文字");
assert.match(evidenceView, /历史结果未保存评分/, "历史未评分记录必须明确提示重新评分且不得伪造高分");
const workflow = read("workflows/ai-screening.ts");
assert.match(workflow, /Promise\.race\(active\.map/, "AI任务必须持续补位执行，不能等待最慢客户拖住下一批");
assert.match(workflow, /AI_SCREENING_CONCURRENCY \|\| 5/, "AI任务默认并发必须兼顾吞吐和外部接口稳定性");
assert.doesNotMatch(workflow, /Promise\.race\(\[analysis, deadline\]\)/, "工作流不得用30秒整客户硬超时中断证据收集");
assert.match(workflow, /AI_SCREENING_CONCURRENCY/, "AI任务并发量必须可通过服务端环境变量配置");
assert.match(workflow, /status: "COMPLETED"/, "单个客户失败不能把已跑完的整个任务标记为失败");
assert.match(workflow, /failTask\(input\.taskId/, "任务级异常必须单独标记整个任务失败");
assert.match(workflow, /order\("attempt_count", \{ ascending: true \}\)/, "未分析客户必须优先于补证重试客户");
assert.match(workflow, /order\("updated_at", \{ ascending: true \}\)/, "同一轮任务必须使用生产表真实字段保持稳定先进先出顺序");
assert.doesNotMatch(workflow, /order\("created_at"/, "任务队列不得查询生产表不存在的created_at字段");
assert.match(workflow, /normalizeError\(error, \{ stage: "TASK" \}\)/, "任务级Supabase对象错误必须保留真实错误码和消息");
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
assert.match(taskActionApi, /requestedCustomerIds[\s\S]*historicalInvalidIds[\s\S]*已阻止混入复验任务/, "历史无效客户复验必须支持精确子集并阻止混入非历史无效客户");
assert.match(taskActionApi, /getRun[\s\S]*run\.cancel\(\)/, "停止任务必须真实取消当前持久工作流运行");
assert.match(taskActionApi, /status: "PAUSED"[\s\S]*elapsed_ms:/, "停止任务必须落为已停止并保存累计耗时");
assert.match(taskActionApi, /action === "resume"[\s\S]*dispatchAiScreeningTask/, "继续执行必须重新进入持久化混合调度处理剩余项");
assert.match(workflow, /fetch failed/, "瞬时网络失败必须有明确识别规则");
assert.match(workflow, /async function taskState[\s\S]*withTransientFetchRetry/, "任务状态读取必须有限重试瞬时网络失败，不能让单次fetch抖动终止整批任务");
assert.match(workflow, /const claim = await withTransientFetchRetry[\s\S]*claim_ai_screening_task_item[\s\S]*claim\.error/, "客户领取与尝试次数必须由可重试的原子数据库租约完成并检查错误");
assert.match(workflow, /async function nextPendingItems[\s\S]*withTransientFetchRetry/, "领取下一批客户的控制查询必须有限重试瞬时网络失败");
assert.match(taskActionApi, /task\.user_id !== user\.id && account\.role !== "ADMIN"/, "整任务复核必须只允许任务创建者或系统管理员发起");
assert.match(taskActionApi, /action === "reanalyze"[\s\S]*getReservedAiCustomerIds[\s\S]*reanalysis_source_task_id[\s\S]*AI_TASK_REANALYZE/, "整任务复核必须保留原结果、阻止并发冲突并写入审计日志");
assert.doesNotMatch(taskActionApi, /action === "reanalyze"[\s\S]{0,5000}ai_screening_done:\s*false/, "整任务复核不得先清空客户已有AI结果");
const taskDetail = read("components/ai-screening/task-detail-view.tsx");
assert.match(taskDetail, /\["RUNNING", "PAUSING"\][\s\S]*"pause"[\s\S]*QUEUED" \? "cancel"[\s\S]*PAUSED" \? "resume"[\s\S]*FAILED" \|\|[\s\S]*COMPLETED"[\s\S]*"retry"/, "任务详情状态操作必须与任务中心一致");
assert.match(taskDetail, /AI等级 \/ 评分/, "任务详情处理队列必须显示本任务AI等级与评分");
assert.match(taskDetail, /block truncate font-medium/, "任务详情超长客户名称必须省略并保留悬停全文");
assert.doesNotMatch(taskDetail, /查看原因并重试/, "任务详情失败操作必须简化为重试");
assert.match(taskDetail, /aiErrorMessageZh/, "任务详情失败原因必须转换为中文显示");
const taskItemsApi = read("app/api/ai/tasks/[id]/items/route.ts");
assert.match(taskItemsApi, /ai_screening_results[\s\S]*score,grade,target_decision/, "任务详情必须关联本任务分析结果而不是只读客户当前评分");
for (const filter of ["industry", "target", "grade"]) {
  assert.match(taskItemsApi, new RegExp(`params\\.get\\("${filter}"\\)`), `任务客户接口缺少筛选条件：${filter}`);
}

const loginApi = read("app/api/auth/password-login/route.ts");
const registerApi = read("app/api/auth/register/route.ts");
const authForm = read("components/password-auth-form.tsx");
const permissionMigration = read("supabase/migrations/202608310002_user_access_control.sql");
assert.match(loginApi, /verifyCaptcha\(body\.captcha\)/, "登录必须由服务端校验图形验证码");
assert.match(registerApi, /verifyCaptcha\(body\.captcha\)/, "注册必须由服务端校验图形验证码");
assert.match(authForm, /captchaRefreshAt[\s\S]*15000/, "登录注册验证码必须每15秒自动刷新");
assert.match(authForm, /if \(now >= captchaRefreshAt\) refreshCaptcha\(false\)/, "验证码必须持续按15秒自动刷新，不受输入框焦点影响");
const captchaApi = read("app/api/auth/captcha/route.ts");
const captchaLib = read("lib/auth/captcha.ts");
assert.match(captchaApi, /appendCaptchaChallenge/, "验证码刷新必须保留短时校验窗口，避免换图后误判已输入验证码");
assert.match(captchaLib, /MAX_ACTIVE_CHALLENGES = 8/, "验证码校验窗口必须有明确上限");
assert.match(authForm, /captchaExpiresAt[\s\S]*120000/, "验证码必须展示并遵守服务端120秒挑战有效期");
assert.match(authForm, /将在 \$\{refreshRemainingSeconds\} 秒后自动刷新/, "页面必须显示15秒自动刷新倒计时，而非展示120秒安全有效期");
assert.match(authForm, /if \(captchaExpired\) return setError\("验证码已失效/, "提交过期验证码前必须在前端明确提示刷新，不得误报验证码错误");
const passwordShell = read("components/app-shell.tsx");
assert.match(passwordShell, /dtsmart-password-account[\s\S]*autoComplete="username"[\s\S]*dtsmart-current-password[\s\S]*autoComplete="off"/, "修改密码弹窗必须把浏览器凭据自动填充限制在自身表单内");
assert.match(read("components/customers-view.tsx"), /customer-list-search[\s\S]*data-lpignore[\s\S]*data-1p-ignore/, "我的客户搜索框不得接收密码管理器自动填充");
assert.match(read("components/customer-public-pool-view.tsx"), /public-pool-search[\s\S]*data-lpignore[\s\S]*data-1p-ignore/, "客户公海搜索框不得接收密码管理器自动填充");
assert.match(authForm, /<CaptchaField[\s\S]*mode === "register"[\s\S]*<CaptchaField/, "登录与注册表单都必须显示图形验证码");
assert.match(registerApi, /role: "SALES"[\s\S]*status: "PENDING"/, "新注册用户必须固定为待审核销售员");
assert.match(registerApi, /REGISTRATION_REVIEW/, "新注册申请必须生成系统内审核通知");
assert.match(permissionMigration, /zzccxry@gmail\.com[\s\S]*role = 'SALES'[\s\S]*role = 'ADMIN'/, "权限迁移必须把指定账号设为唯一系统管理员、其余账号设为销售员");
assert.match(permissionMigration, /必须保留至少一名|current_user_is_admin/, "权限系统必须具备系统管理员保护规则");
assert.match(taskDetail, /全部所属行业[\s\S]*全部目标客户[\s\S]*全部AI等级[\s\S]*查询[\s\S]*重置/, "任务详情必须在同一筛选行提供行业、目标客户、AI等级、查询和重置");
const failureView = read("components/ai-screening/failures-view.tsx");
assert.match(failureView, /flex min-h-9 items-center/, "待重试页面操作入口必须垂直对齐");
assert.match(failureView, /aiErrorCodeLabel/, "待重试页面错误代码必须使用中文名称");
const aiUi = read("components/ai-screening/ui.tsx");
assert.match(aiUi, /finished_at \|\| task\.completed_at \|\| task\.updated_at/, "历史任务缺少elapsed_ms时必须用开始和结束时间计算真实耗时");
const elapsedBackfill = read("supabase/migrations/202608240001_backfill_ai_task_elapsed.sql");
assert.match(elapsedBackfill, /coalesce\(finished_at, completed_at, updated_at\) - started_at/, "生产迁移必须回填历史任务执行耗时");
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
assert.match(createTaskView, /官网与公开来源优先[\s\S]*最多1次/, "智能筛选说明必须与分层止损和单次模型上限一致");
assert.match(createTaskView, /系统会根据证据复杂度自动选择分析深度/, "创建任务页不得再要求用户理解或选择内部分析模式");

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
assert.match(importView, /label="归属冲突"[\s\S]*showResult\("conflict"\)/, "导入结果的归属冲突卡片必须定位到本次导入冲突明细");
assert.match(importView, /成功导入[\s\S]*失败导入[\s\S]*重复数据[\s\S]*冲突客户/, "完整导入报告必须包含四类结果页签");
assert.match(importView, /当前归属人/, "导入明细和冲突报告必须显示当前归属人");
assert.match(importView, /\/api\/import\/preview/, "解析后的导入数据必须调用服务端全库预检");
assert.match(importView, /疑似重复，已提示核对/, "疑似重复行必须在导入明细中清楚标记");
assert.match(importView, /核对候选/, "导入疑似重复必须提供当前页面的候选核对入口");
assert.match(importView, /核对系统匹配客户[\s\S]*当前导入数据/, "导入候选弹窗必须对比当前行与系统候选");
const importApi = read("app/api/import/route.ts");
assert.match(importApi, /for \(let from = 0; ; from \+= 1000\)/, "导入去重必须分页读取全部现有客户，不能设置固定上限");
assert.match(importApi, /error\?\.code === "23505"/, "导入必须处理数据库并发唯一冲突");
assert.match(importApi, /status: "duplicate"[\s\S]*客户已存在于我的客户列表，保留最先导入的数据/, "本人已有客户必须计入重复数据并保留最早记录");
assert.match(importApi, /status: "conflict"[\s\S]*客户仍在保护期或需管理员处理/, "其他归属人的受保护重复客户必须计入冲突客户");
assert.match(importApi, /owner_name:/, "冲突导入结果必须返回当前归属人");
assert.match(importApi, /source_batch_id: taskId \|\| null/, "导入客户必须保存唯一导入任务ID，不能只依赖文件名");
const importPreviewApi = read("app/api/import/preview/route.ts");
assert.match(importPreviewApi, /potentialCustomerDuplicateReasons/, "导入预检必须返回弱身份命中的疑似重复及核对依据");
assert.match(importPreviewApi, /existing_duplicate_count[\s\S]*suspected_count/, "导入预检统计必须分开确认重复与疑似重复");
assert.match(importPreviewApi, /suspected_matches/, "导入预检必须返回每条疑似重复的候选资料");
const customerForm = read("components/customer-form.tsx");
assert.match(customerForm, /核对疑似重复客户[\s\S]*已核对，仍要新增/, "手动新增疑似重复必须在统一弹框完成核对和确认");
const globalIdentityMigration = read("supabase/migrations/202609040001_global_customer_contact_identity_guard.sql");
assert.match(globalIdentityMigration, /before insert or update of phone, whatsapp, email/, "生产层必须在新增和编辑时拦截全局联系方式重复");
assert.doesNotMatch(globalIdentityMigration, /normalized_name|company_name/, "全局联系方式防重不得受客户名称拼写差异影响");
const aiCreateTask = read("components/ai-screening/create-task-view.tsx");
const importBatchSelector = read("components/import-batch-multi-select.tsx");
const aiCustomerApi = read("app/api/ai/customers/route.ts");
const aiTaskApi = read("app/api/ai/tasks/route.ts");
const importTaskLinkMigration = read("supabase/migrations/202608290001_customer_import_task_link.sql");
assert.match(aiCreateTask, /item\.value === "MANUAL" \? "手动新增"[\s\S]*item\.value === "BATCH_IMPORT" \? "批量导入"/, "AI筛选来源必须区分手动新增与批量导入");
assert.match(aiCreateTask, /导入批次（可多选）/, "批量导入必须支持多选真实导入任务");
assert.match(aiCreateTask, /compactBatchTime\(batch\.created_at\)/, "同名导入批次必须显示精确时间后缀");
assert.match(importBatchSelector, /成功导入 \$\{batch\.success_count\}/, "批次选项必须显示成功导入数");
assert.match(importBatchSelector, /待筛选 \$\{batch\.pending_count\}/, "批次选项必须显示当前待筛选数");
assert.match(importBatchSelector, /aria-selected=\{checked\}/, "批次多选必须用点击行和勾选标记反馈选中状态");
assert.match(aiCustomerApi, /params\.getAll\("source_batch"\)/, "待筛选接口必须接受多个导入任务ID");
assert.match(aiCustomerApi, /sourceBatches\.includes\(batchFilterKey\(row\)\)/, "待筛选接口必须按唯一批次ID取并集");
assert.match(aiCustomerApi, /item\.pending_count > 0/, "批次列表必须保留仍含待筛选客户的历史批次");
assert.match(aiCustomerApi, /resolveAiOwnerScope\(account, params\.get\("owner_id"\)\)/, "待筛选客户必须由服务端解析归属人可见范围");
assert.match(aiTaskApi, /resolveAiOwnerScope\(account, String\(body\.filters\?\.owner_id \|\| ""\)\)/, "创建AI任务必须由服务端校验所选归属人范围");
assert.match(aiTaskApi, /pendingScope\.ownerIds[\s\S]*pendingCustomersQuery = pendingCustomersQuery\.in\("owner_id", pendingScope\.ownerIds\)/, "待筛选统计必须与角色可选归属范围一致");
assert.match(aiCreateTask, /changeOwner[\s\S]*source_batches: \[\][\s\S]*setSelected\(new Set\(\)\)/, "切换归属人必须清空批次和已选客户，避免跨用户混选");
assert.match(aiCreateTask, /loadSequence[\s\S]*sequence !== loadSequence\.current/, "切换归属人时必须忽略旧请求，避免来源和批次数据串位");
assert.match(taskRuntime, /duplicateWindow = type === "error" \? 5000 : 3000/, "短暂操作提示必须在合理时间内去重");
assert.match(taskRuntime, /detail\.generic[\s\S]*180/, "通用网络提示必须延迟，以便显式业务提示优先显示");
assert.match(taskRuntime, /type === "error" \? 6000 : 3000/, "成功和错误提示必须使用不同的自动关闭时长");
assert.match(importTaskLinkMigration, /source_batch_id uuid references public\.import_tasks\(id\)/, "迁移必须建立客户到导入任务的唯一关联");
const conflictApi = read("app/api/customer-conflicts/route.ts");
assert.match(conflictApi, /owner, submitters, protection_days/, "冲突列表必须返回当前归属人和冲突提交人信息");
assert.match(conflictApi, /requestedOwnerId[\s\S]*submitter_ids\?\.includes\(scopeUserId\)/, "冲突列表必须按服务端冲突提交人范围限定客户行");
assert.match(conflictApi, /latestByReporter[\s\S]*grouped/, "冲突客户必须先按提交人去重再按客户主体聚合");
assert.match(conflictApi, /requirePermission\("customers\.view"\)/, "冲突列表必须在服务端校验客户查看权限");
assert.match(conflictApi, /aggregateOpenConflicts\([\s\S]*submitter_ids/, "冲突列表必须按客户聚合全部冲突提交人");
assert.match(conflictApi, /current\.filter\(\(item\) => item\.submitter_ids\?\.includes\(scopeUserId\)\)/, "提交人筛选只能筛选当前客户行，不能截断完整提交人列表");
assert.match(conflictApi, /if \(!tableAvailable\)[\s\S]*audit_logs/, "正式冲突表可用时不得把历史审计事件重复计入当前冲突客户");
assert.match(conflictApi, /ownerByCustomer[\s\S]*ownerByCustomer\.get\(item\.customer_id\) !== item\.reported_by[\s\S]*aggregateOpenConflicts\(currentRows\)/, "已删除客户及已转归提交人的历史冲突不得继续计入当前冲突客户");
assert.match(conflictApi, /IN_QUERY_BATCH_SIZE = 100[\s\S]*for \(const customerIdBatch of batches/, "冲突详情必须分批查询，避免大量客户ID导致请求过长");
assert.match(conflictApi, /ACCOUNT_DISABLED: "账号已停用，请联系系统管理员"[\s\S]*authErrorStatus\(message\)/, "冲突接口不得把账号状态错误伪装成业务加载500错误");
const protectionApi = read("app/api/customers/protection/route.ts");
assert.match(protectionApi, /requestedOwnerId[\s\S]*\.eq\("owner_id", scopeUserId\)/, "保护到期必须按服务端归属人范围查询");
assert.match(protectionApi, /requirePermission\("customers\.view"\)/, "保护到期必须在服务端校验客户查看权限");
const workspacePanels = read("components/customer-workspace-panels-v2.tsx");
assert.match(workspacePanels, /UserScopeSelect[\s\S]*customers\/protection\?\$\{params\}/, "保护到期页面必须提供生效的归属人筛选");
assert.match(workspacePanels, /customer-conflicts\?\$\{params\}[\s\S]*filterLabel="冲突提交人"/, "冲突客户页面必须提供生效且语义清楚的冲突提交人筛选");
assert.match(workspacePanels, /conflictColumns[\s\S]*当前归属人[\s\S]*冲突提交人[\s\S]*row\.submitters/, "冲突列表必须显示当前归属人和完整冲突提交人");
assert.match(workspacePanels, /共 \{row\.submitters\?\.length\} 位提交人[\s\S]*formatDate\(user\.submitted_at\)/, "多个冲突提交人必须可展开并按人显示提交时间");
assert.doesNotMatch(workspacePanels, /认领客户|立即认领|submissionHistory/, "系统没有公海或认领交互");
const adminAuditApi = read("app/api/admin/audit/route.ts");
const adminPanels = read("components/admin-settings-panels.tsx");
const auditPolicy = read("lib/audit-log.ts");
const permissionCatalog = read("lib/auth/permissions.ts");
const securityApi = read("app/api/admin/security/route.ts");
const settingsLayout = read("app/settings/layout.tsx");
const settingsNav = read("components/system-management-nav.tsx");
const defaultSystemViewMigration = read("supabase/migrations/202608310007_default_audit_and_security_view.sql");
assert.match(adminAuditApi, /target_user:[\s\S]*target_type === "user"/, "系统操作日志必须返回目标账号信息");
assert.match(adminAuditApi, /\.in\("action", category \? AUDIT_CATEGORY_ACTIONS\[category\] : IMPORTANT_AUDIT_ACTIONS\)/, "系统操作日志必须只查询白名单内的重要操作");
assert.match(adminAuditApi, /account\.role === "ADMIN" \? requestedUserId : account\.id/, "非系统管理员操作日志必须在服务端强制限定为本人");
assert.match(adminAuditApi, /requirePermission\("system\.audit\.view"\)/, "操作日志必须支持受权限控制的非管理员只读访问");
assert.match(adminPanels, /auditSummary[\s\S]*对账号[\s\S]*执行了/, "系统操作日志必须明确显示谁对哪个账号做了什么");
assert.doesNotMatch(adminPanels, /JSON\.stringify\(row\.content/, "系统操作日志不得继续直接展示原始JSON");
assert.match(adminPanels, /\[A-Za-z_\][\s\S]*return fallback/, "原因与结果不得直接显示英文枚举、错误代码或JSON");
assert.doesNotMatch(adminPanels, /目标账号 \/ 对象/, "目标账号不得单独占据重复列");
assert.match(adminPanels, /AUDIT_CATEGORY_LABELS[\s\S]*全部操作类型/, "操作日志必须支持中文操作类型分类筛选");
assert.match(auditPolicy, /ADMIN_USER_PERMISSION_UPDATE: "修改用户权限"/, "用户权限日志不得显示内部英文操作码");
assert.doesNotMatch(permissionCatalog, /code: "system\.audit\.view"[^\n]*core: true/, "操作日志查看权限必须允许下放");
assert.doesNotMatch(permissionCatalog, /code: "system\.security\.view"[^\n]*core: true/, "安全设置查看权限必须允许下放");
assert.match(permissionCatalog, /code: "system\.security\.manage"[^\n]*core: true/, "安全设置修改权限必须保持系统管理员专属");
assert.match(defaultSystemViewMigration, /\('SUPERVISOR', 'system\.audit\.view', true\)[\s\S]*\('SALES', 'system\.security\.view', true\)/, "主管和销售员必须默认拥有本人日志与安全设置查看权限");
assert.match(securityApi, /requirePermission\("system\.security\.view"\)[\s\S]*can_manage: hasPermission\(account, "system\.security\.manage"\)/, "安全设置读取与修改能力必须分别授权");
assert.match(adminPanels, /disabled=\{!canManage\}[\s\S]*只读查看/, "非系统管理员安全设置页面必须只读");
assert.match(adminPanels, /忘记密码时联系系统管理员重置临时密码/, "安全设置必须说明忘记密码的处理方式");
assert.match(settingsLayout, /canViewAudit[\s\S]*canViewSecurity[\s\S]*SystemManagementNav/, "非管理员必须能按查看权限进入系统管理页面");
assert.match(settingsNav, /visibleItems[\s\S]*canManageUsers[\s\S]*canViewAudit[\s\S]*canViewSecurity/, "系统管理子导航必须按页面权限显示");
assert.doesNotMatch(importApi, /CUSTOMER_IMPORT/, "批量导入不得再按客户逐条写操作日志");
assert.match(importApi, /action: "IMPORT_COMPLETE"[\s\S]*filename:[\s\S]*\.\.\.stats/, "每次导入只保留一条任务级汇总日志");
assert.match(adminPanels, /<nav className="relative z-20[^"]*min-h-\[58px\][^"]*flex-wrap[^"]*bg-white/, "用户权限模块页签必须完整显示且不能被权限表头遮挡");
const permanentDelete = read("lib/customers/soft-delete.ts");
assert.match(permanentDelete, /offset \+= 200/, "批量永久删除必须分批处理，避免大批量ID被截断");
assert.match(permanentDelete, /customer\.owner_id === userId/, "销售只能永久删除当前归属自己的客户");
assert.match(permanentDelete, /allowAll \|\|[\s\S]*customer\.owner_id === userId/, "只有显式系统管理员维护模式可以跨归属删除，主管仍只能删除本人客户");
assert.match(read("app/api/customers/batch/route.ts"), /allowAll: account\.role === "ADMIN"/, "批量删除的跨归属维护权限只能授予系统管理员");
assert.match(permanentDelete, /\.from\("customers"\)[\s\S]*?\.delete\(\)/, "客户删除必须从数据库物理删除");
assert.match(permanentDelete, /linkedIds\.has\(id\)[\s\S]*客户已有报价或订单记录/, "客户是否可删除必须以真实报价或订单关联为准，不能只看阶段标签");
assert.equal(existsSync(resolve(root, "app/api/customers/[id]/restore/route.ts")), false, "永久删除模式不得保留客户恢复接口");

const appShell = read("components/app-shell.tsx");
assert.match(appShell, /sticky top-0[^\n]*h-screen/, "桌面左侧菜单必须固定在浏览器视口内");
assert.match(appShell, /h-\[calc\(100vh-196px\)\][^\n]*overflow-y-auto/, "菜单项必须独立滚动且不能推走底部控制项");
assert.match(appShell, /欢迎您，\{profile\.name\}！/, "右上角用户菜单必须只显示当前用户名，不显示角色");
const aiTaskDetail = read("components/ai-screening/task-detail-view.tsx");
const aiTaskDetailApi = read("app/api/ai/tasks/[id]/route.ts");
assert.match(aiTaskDetail, /总数 \/ 已处理 \/ 待处理[\s\S]*\$\{formatNumber\(task\?\.total_count\)\} \/ \$\{formatNumber\(processed\)\} \/ \$\{formatNumber\(remaining\)\}/, "任务详情必须按同一口径同一行展示总数、已处理和待处理数量");
assert.match(aiTaskDetail, /创建人 \$\{task\?\.creator\?\.name/, "任务详情必须显示真实创建人");
assert.doesNotMatch(aiTaskDetail, /仅云端执行/, "任务详情不得展示冗余的固定云端执行策略标签");
assert.match(aiTaskDetailApi, /creator: creator\.data/, "任务详情接口必须返回任务创建人");
const customersView = read("components/customers-view.tsx");
const customerListFields = read("lib/customers/list-fields.ts");
const currentUserAuth = read("lib/auth/current-user.ts");
const userScopeSelect = read("components/user-scope-select.tsx");
assert.match(currentUserAuth, /if \(!requested \|\| requested === account\.id \|\| requested\.toLowerCase\(\) === "all"\) return account\.id/, "主管服务端默认必须只读取自己的数据");
assert.match(currentUserAuth, /account\.role === "ADMIN"[\s\S]*requested\.toLowerCase\(\) === "all"/, "只有系统管理员能够主动选择全部用户数据");
assert.match(currentUserAuth, /eq\("manager_id", account\.id\)/, "主管跨用户读取必须在服务端限定直属下级");
assert.match(userScopeSelect, /onChangeRef\.current\(body\.profile\.id\)/, "主管和系统管理员前端默认必须选中自己");
assert.match(userScopeSelect, /if \(!loaded \|\| !elevated\) return null/, "销售员不得显示归属人筛选控件");
assert.match(customersView, /show_owner|currentRole[\s\S]*SUPERVISOR/, "客户列表必须识别主管和系统管理员的数据范围");
assert.match(customerListFields, /key: "owner", label: "归属人"/, "跨用户客户列表必须统一显示归属人字段");
assert.ok(customersView.indexOf('aria-label="归属人"') < customersView.indexOf('<ImportBatchMultiSelect'), "客户列表归属人筛选必须位于导入批次前面");
assert.match(customersView, /setScopeUserId\(event\.target\.value\); setSourceBatches\(\[\]\)/, "切换归属人时必须清空旧归属人的批次选择");
assert.match(customersView, /options=batches\$\{scope\}/, "客户列表导入批次必须随归属人重新加载");
assert.doesNotMatch(customersView, /负责人/, "客户列表不得混用负责人和归属人口径");
for (const [name, source] of Object.entries({
  customersView,
  taskCenter,
  followupsView: read("components/followups-view.tsx"),
  manualSetup: read("supabase/manual_setup.sql"),
  finalDatabaseSetup: read("supabase/FINAL_DATABASE_SETUP.sql"),
  accessControlMigration: read("supabase/migrations/202608310002_user_access_control.sql"),
  claimProtectionMigration: read("supabase/migrations/202608120003_claim_protection_crm.sql"),
})) {
  assert.doesNotMatch(source, /负责人/, `${name} 不得混用负责人和归属人口径`);
}
assert.match(taskCenter, /show_owner[\s\S]*归属人/, "主管和系统管理员的AI任务列表必须显示归属人");
assert.doesNotMatch(customersView, />\s*跟进待办/, "客户管理页签不得保留跟进待办");
assert.match(customersView, /CustomerProtectionPanel/, "保护到期必须在客户管理同页切换");
assert.match(customersView, /CustomerConflictsPanel/, "冲突客户必须在客户管理同页切换");
const customerDetail = read("components/customer-crm-detail-view.tsx");
assert.match(customerDetail, /href="\/customers"[\s\S]*返回客户列表/, "客户详情必须提供明确的返回客户列表入口");
assert.match(customerDetail, /<CountryLabel value=\{customer\.country\}/, "客户详情必须把国家代码转换为国旗和中文国家名称");
assert.match(customerDetail, /editBasicOnly/, "客户详情编辑必须启用仅原始资料模式");
assert.match(customerDetail, /AI分析结果（只读）/, "客户详情必须明确标注AI分析数据只读");
assert.doesNotMatch(customerDetail, /销售判断摘要/, "客户详情不得保留重复的销售判断摘要横幅");
const evidenceSections = read("components/ai-screening/evidence-sections.tsx");
assert.match(customerDetail, /VerifiedContactsSection[\s\S]*customer=\{data\.customer\}/, "客户详情必须把原始客户资料交给联系方式核验组件");
assert.match(evidenceSections, /已核验的原有资料[\s\S]*AI新发现并已核验/, "客户详情必须区分原始已核验和AI新发现的联系方式");
assert.match(customerDetail, /function cleanAiText[\s\S]*事实边界/, "客户详情必须清理历史结果中的模板化事实边界废话");
assert.doesNotMatch(taskRunner, /事实边界[：:]未核验的信息不会写成既定事实/, "新分析结果不得继续生成模板化事实边界废话");
assert.match(customersView, /options=industries[\s\S]*全部所属行业/, "客户列表必须加载并展示动态所属行业筛选");
assert.match(customersView, /aria-label="所属行业多选"[\s\S]*type="checkbox"/, "所属行业必须支持多选");
assert.match(customersView, /industries\.forEach\(\(industry\) => params\.append\("industry", industry\)\)/, "列表、全选和导出必须传递全部行业条件");
assert.ok(customersView.indexOf('value={target}') < customersView.indexOf('value={status}'), "客户阶段筛选必须紧跟目标客户筛选之后");
assert.ok(customersView.indexOf('value={status}') < customersView.indexOf('onClick={reset}'), "重置按钮必须与筛选条件位于同一筛选行末尾");
assert.match(customersView, /flex flex-wrap items-end gap-3[\s\S]*onClick=\{reset\}/, "客户列表筛选控件必须在空间不足时自动换行，重置按钮保持在筛选区末尾");
assert.doesNotMatch(customersView, /min-w-\[1500px\] grid-cols-\[/, "客户列表筛选区不得强制最小宽度导致横向溢出");
assert.match(customersView, /if \(defaultScopeUserId\) setScopeUserId\(defaultScopeUserId\)/, "切换保护到期或冲突客户时必须默认恢复本人数据范围");
assert.match(customersView, /搜索客户、联系人、电话、邮箱或国家\/地区/, "客户列表必须合并客户与国家关键词筛选框");
assert.doesNotMatch(customersView, /JSON\.stringify\([\s\S]{0,200}value\(row, key\)/, "客户导出不得序列化React页面组件");
const customerExport = read("lib/customer-export.ts");
assert.match(customerExport, /customerProtectionText[\s\S]*剩余 \$\{days\} 天/, "客户导出必须使用与页面一致的保护期纯文本");
assert.match(customerExport, /countryInfo\(customer\.country\)\.name/, "客户导出国家地区必须输出页面对应的国家名称");
const customerDetailApi = read("app/api/customers/[id]/crm/route.ts");
assert.match(customerDetailApi, /DEFAULT_90_DAYS[\s\S]*remaining_days/, "没有显式保护记录时必须按归属日起计算默认90天保护期");
const customerUpdateApi = read("app/api/customers/[id]/route.ts");
for (const readOnlyField of ["ai_score", "ai_level", "ai_reason", "industry", "website_email", "website_phone", "is_target_customer"]) {
  assert.doesNotMatch(customerUpdateApi.match(/const writable = \[([\s\S]*?)\];/)?.[1] || "", new RegExp(`\\b${readOnlyField}\\b`), `客户人工编辑接口不得允许覆盖AI字段：${readOnlyField}`);
}
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
const immutableMetrics = read("supabase/migrations/202608310001_ai_screening_immutable_metrics.sql");
assert.match(immutableMetrics, /deliberately have no task\/customer foreign[\s\S]*ai_screening_usage_ledger/i, "AI用量必须保存到不依赖任务和客户生命周期的审计账本");
assert.match(immutableMetrics, /ai_screening_completion_ledger[\s\S]*capture_ai_screening_completion_ledger/, "完成客户统计必须写入独立历史账本");
const usageApi = read("app/api/ai/usage/route.ts");
assert.match(usageApi, /ai_screening_usage_ledger[\s\S]*ai_screening_completion_ledger/, "AI用量接口必须从独立用量和完成账本读取");

const profileApi = read("app/api/users/profile/route.ts");
const adminUsersApi = read("app/api/admin/users/route.ts");
const usernameMigration = read("supabase/migrations/202609040002_user_name_unique.sql");
assert.match(registerApi, /该用户名已被使用/, "注册必须拒绝已占用用户名");
assert.match(profileApi, /usersError\.code === "23505"/, "修改用户名必须处理数据库唯一性冲突");
assert.match(adminUsersApi, /isUsername\(name\)[\s\S]*listAuthUsers\(\)[\s\S]*该用户名已被使用/, "系统管理员新增用户必须执行相同的用户名校验");
assert.match(usernameMigration, /create unique index[\s\S]*lower\(btrim\(name\)\)/i, "用户名必须有大小写无关的数据库唯一约束");

console.log("DTSmart CRM 烟雾测试通过：页面、权限、AI筛选和兼容迁移检查正常。");
