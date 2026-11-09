import type { UserRole } from "@/lib/auth/permissions";

export type ReleaseCommit = {
  sha: string;
  message: string;
  details?: string;
  url: string;
  deployedAt: string;
  files: string[];
  deploymentUrl: string;
  affectedRoles: UserRole[] | ["ALL"];
  category: ReleaseCommitCategory;
  changeItems?: string[];
};

/** Do not put raw commit messages into user-facing announcements. */
export function extractVerifiedChangeItems(message: string, details = ""): string[] {
  const source = `${message}\n${details}`;
  const known: Array<[RegExp, string]> = [
    [/PI image (?:picker|upload).*sidebar|PI image picker.*app shell/i, "修复创建 PI 时上传理货图片导致左侧菜单移位的问题"],
    [/sidebar width|sidebar compact/i, "修复左侧菜单宽度异常"],
    [/form overflow.*sidebar/i, "修复 PI 表单横向溢出导致的布局异常"],
    [/resilient workbench loading|harden dashboard/i, "提升工作台数据加载失败时的自动恢复能力"],
    [/configurable performance permissions/i, "业绩分析按已配置的角色与用户权限控制访问"],
    [/release announcements? from verified production deployments|release evidence source|github\/vercel release announcement|release announcement accuracy|release summaries/i, "公告草稿仅汇总已匹配 GitHub 提交的 Vercel 正式部署记录"],
    [/verified release notices and operational templates/i, "公告草稿改用中文功能摘要，并新增维护预告、维护中、暂停服务、恢复服务及故障通知模板"],
    [/merge dts release integration/i, "备货单支持批量登记多产品回货及按供应商、送货单记录来源"],
    [/merge dts release integration/i, "供应商送货单支持上传纸质凭证并用于对账核对"],
    [/merge dts release integration/i, "PI 产品明细导入与粘贴增强币种、数量及金额识别"],
    [/merge dts release integration/i, "备货单导出保留原有格式并展示理货图片"],
    [/merge dts release integration/i, "工作台备货动态展示具体操作与进度"],
    [/preserve stock workbook layout and embed tally thumbnails/i, "备货单导出保留原有格式并展示理货图片"],
    [/preserve stock workbook layout and embed tally thumbnails/i, "PI 产品明细导入与粘贴增强币种、数量及金额识别"],
  ];
  const items = known.filter(([pattern]) => pattern.test(source)).map(([, summary]) => summary);
  const chinese = source.split(/[\n；;]+/).map(line => line.trim()).filter(line => /[\u3400-\u9fff]{4}/.test(line) && !/^(依据|统计周期|影响范围|co-authored)/i.test(line));
  return [...new Set([...chinese, ...items])];
}

export type ReleaseCategory = "ALL" | "FEATURE" | "BUG_FIX" | "OPTIMIZATION" | "MAINTENANCE" | "SECURITY" | "GENERAL";
export type ReleaseCommitCategory = Exclude<ReleaseCategory, "ALL">;

export const RELEASE_CATEGORIES: Record<ReleaseCategory, { label: string; title: string; icon: string }> = {
  ALL: { label: "全部类型", title: "正式发布变更摘要", icon: "📋" },
  FEATURE: { label: "功能新增", title: "功能新增与发布", icon: "✨" },
  BUG_FIX: { label: "问题修复", title: "问题修复与改进", icon: "🛠️" },
  OPTIMIZATION: { label: "功能优化", title: "功能优化升级", icon: "⚙️" },
  MAINTENANCE: { label: "系统维护", title: "系统维护通知", icon: "🔧" },
  SECURITY: { label: "安全通知", title: "系统安全更新", icon: "🛡️" },
  GENERAL: { label: "其他通知", title: "系统更新摘要", icon: "📢" },
};

const ROLE_PATHS: Array<{ roles: UserRole[]; pattern: RegExp }> = [
  { roles: ["ADMIN", "SUPERVISOR", "SALES", "ORDER_CLERK", "WAREHOUSE", "FINANCE"], pattern: /(^|\/)(dashboard|crm-dashboard|workbench)(\/|\.|$)/i },
  { roles: ["SALES", "SUPERVISOR", "ADMIN"], pattern: /(^|\/)(customers?|customer-[^/]*|followups?|ai-acquisition|ai-screening|sales\/performance)(\/|\.|$)/i },
  { roles: ["SALES", "SUPERVISOR", "ORDER_CLERK", "ADMIN"], pattern: /(^|\/)(orders?|order-[^/]*|pi|pi-[^/]*|components\/pi-)(\/|\.|$)/i },
  { roles: ["WAREHOUSE", "ORDER_CLERK", "ADMIN"], pattern: /(^|\/)(stock-orders?|stock-order-[^/]*|warehouse)(\/|\.|$)/i },
  { roles: ["WAREHOUSE", "FINANCE", "ADMIN"], pattern: /(^|\/)(suppliers?|supplier-[^/]*|supplier-reconciliation|reconciliation)(\/|\.|$)/i },
  { roles: ["SALES", "SUPERVISOR", "FINANCE", "ADMIN"], pattern: /(^|\/)(reports?|sales-performance|sales-reports|costs?|pi-exchange-rates|pi-payment-accounts)(\/|\.|$)/i },
  { roles: ["ADMIN"], pattern: /(^|\/)(settings|api\/admin|middleware|lib\/auth)(\/|\.|$)/i },
];

const ROLE_LABELS: Record<UserRole, string> = { ADMIN: "系统管理员", SUPERVISOR: "主管", SALES: "销售员", ORDER_CLERK: "跟单员", WAREHOUSE: "仓库员", FINANCE: "财务员" };
const GLOBAL_PATHS = [
  /^(app\/layout\.[^/]+|app\/globals?\.css)$/i,
  /^components\/ui\//i,
  /^lib\/notifications\//i,
  /^lib\/auth\//i,
];

const MODULE_PATHS: Array<{ label: string; roles: UserRole[]; pattern: RegExp }> = [
  { label: "客户与客户公海", roles: ["SALES", "SUPERVISOR", "ADMIN"], pattern: /(^|\/)(customers?|customer-[^/]*|followups?)(\/|\.|$)/i },
  { label: "工作台与数据总览", roles: ["ADMIN", "SUPERVISOR", "SALES", "ORDER_CLERK", "WAREHOUSE", "FINANCE"], pattern: /(^|\/)(dashboard|crm-dashboard|workbench)(\/|\.|$)/i },
  { label: "AI获客与筛选", roles: ["SALES", "SUPERVISOR", "ADMIN"], pattern: /(^|\/)(ai-acquisition|ai-screening)(\/|\.|$)/i },
  { label: "PI订单与订单变更", roles: ["SALES", "SUPERVISOR", "ORDER_CLERK", "ADMIN"], pattern: /(^|\/)(orders?|order-[^/]*|pi|pi-[^/]*)(\/|\.|$)|^components\/pi-[^/]+$/i },
  { label: "备货单与仓库", roles: ["WAREHOUSE", "ORDER_CLERK", "ADMIN"], pattern: /(^|\/)(stock-orders?|stock-order-[^/]*|warehouse)(\/|\.|$)/i },
  { label: "供应商与供应商对账", roles: ["WAREHOUSE", "FINANCE", "ADMIN"], pattern: /(^|\/)(suppliers?|supplier-[^/]*|reconciliation)(\/|\.|$)/i },
  { label: "业绩与报表", roles: ["SALES", "SUPERVISOR", "FINANCE", "ADMIN"], pattern: /(^|\/)(reports?|sales\/performance|sales-performance|sales-reports|costs?)(\/|\.|$)/i },
  { label: "通知与公告", roles: ["ADMIN", "SUPERVISOR", "SALES", "ORDER_CLERK", "WAREHOUSE", "FINANCE"], pattern: /(^|\/)(notifications?|notification-[^/]*|announcements?)(\/|\.|$)/i },
  { label: "系统设置与权限", roles: ["ADMIN"], pattern: /(^|\/)(settings|middleware|lib\/auth)(\/|\.|$)|^app\/api\/admin\/(users|roles|permissions)(\/|\.|$)/i },
  { label: "全局界面与基础配置", roles: ["ADMIN", "SUPERVISOR", "SALES", "ORDER_CLERK", "WAREHOUSE", "FINANCE"], pattern: /(^|\/)(app\/globals?\.css|components\/ui|package\.json|next\.config\.[^/]+|tailwind\.config\.[^/]+|tsconfig\.json)$/i },
];

export function inferAffectedRoles(paths: string[]): UserRole[] | ["ALL"] {
  if (paths.some(path => GLOBAL_PATHS.some(pattern => pattern.test(path)))) return ["ALL"];
  const roles = new Set<UserRole>();
  for (const path of paths) {
    for (const rule of ROLE_PATHS) if (rule.pattern.test(path)) rule.roles.forEach(role => roles.add(role));
    for (const rule of MODULE_PATHS) if (rule.pattern.test(path)) rule.roles.forEach(role => roles.add(role));
  }
  return [...roles];
}

export function inferReleaseModules(paths: string[], selectedRoles?: UserRole[] | null): string[] {
  const modules = new Set<string>();
  for (const path of paths) for (const rule of MODULE_PATHS) {
    const visibleToSelectedRoles = !selectedRoles?.length || rule.roles.some(role => selectedRoles.includes(role));
    if (visibleToSelectedRoles && rule.pattern.test(path)) modules.add(rule.label);
  }
  return [...modules];
}

function moduleForChangeItem(item: string, availableModules: string[]): string {
  const rules: Array<[RegExp, string]> = [
    [/公告|通知|发布摘要|发布记录/, "通知与公告"],
    [/^备货单/, "备货单与仓库"],
    [/供应商|送货单|对账/, "供应商与供应商对账"],
    [/备货|回货|仓库/, "备货单与仓库"],
    [/PI|订单|理货图片/, "PI订单与订单变更"],
    [/工作台|数据加载/, "工作台与数据总览"],
    [/业绩|报表/, "业绩与报表"],
    [/侧栏|菜单宽度|横向溢出|布局/, "全局界面与基础配置"],
  ];
  const matched = rules.find(([pattern, label]) => pattern.test(item) && availableModules.includes(label));
  return matched?.[1] || availableModules[0] || "功能范围待核对";
}

function changeAffectsRoles(item: string, module: string, selectedRoles: UserRole[] | null): boolean {
  if (!selectedRoles?.length) return true;
  // Editing and publishing announcements is an administrator action; receiving
  // a notice does not make changes to the admin composer relevant to recipients.
  if (module === "通知与公告" && /公告草稿|运营公告|发布摘要|发布记录|公告模板/.test(item)) {
    return selectedRoles.includes("ADMIN");
  }
  const rule = MODULE_PATHS.find(entry => entry.label === module);
  return !rule || rule.roles.some(role => selectedRoles.includes(role));
}

function categoryForChangeItem(item: string, fallback: ReleaseCommitCategory): ReleaseCommitCategory {
  if (/^(修复|纠正|更正)/.test(item)) return "BUG_FIX";
  if (/^(新增|增加|上线)/.test(item) || /支持(?:批量|上传|导入|多币种)/.test(item)) return "FEATURE";
  if (/^(优化|完善|提升|改进)/.test(item) || /增强|保留原有格式/.test(item)) return "OPTIMIZATION";
  return fallback;
}

export function selectReleaseChanges(commits: ReleaseCommit[], selectedRoles: UserRole[] | null, selectedCategory: ReleaseCategory): ReleaseCommit[] {
  return commits.flatMap(commit => {
    if (!commit.files.some(file => /^(app|components|lib|supabase)\//.test(file))) return [];
    const modules = inferReleaseModules(commit.files);
    const items = commit.changeItems?.length ? commit.changeItems : extractVerifiedChangeItems(commit.message, commit.details);
    const changeItems = items.filter(item =>
      (selectedCategory === "ALL" || categoryForChangeItem(item, commit.category) === selectedCategory)
      && changeAffectsRoles(item, moduleForChangeItem(item, modules), selectedRoles));
    return changeItems.length ? [{ ...commit, changeItems }] : [];
  });
}

export function inferReleaseCategory(message: string): ReleaseCommitCategory {
  const value = message.toLowerCase();
  if (/(security|vulnerab|权限|安全|认证|鉴权)/i.test(value)) return "SECURITY";
  if (/^(fix|hotfix|bugfix)(\(|:|\s)|\bfix(es|ed)?\b|修复|纠正|更正/i.test(value)) return "BUG_FIX";
  if (/^(feat|feature)(\(|:|\s)|\badd(ed|s)?\b|新增|新建|增加/i.test(value)) return "FEATURE";
  if (/^(perf|refactor|style|improve)(\(|:|\s)|优化|改进|重构|调整/i.test(value)) return "OPTIMIZATION";
  if (/deploy|release|maintenance|维护|升级|migration|迁移|build|ci\b/i.test(value)) return "MAINTENANCE";
  return "GENERAL";
}

export function explainEmptyReleaseMatch(deploymentsChecked: number, commitsChecked: number) {
  if (deploymentsChecked === 0) return "Vercel 项目记录中，所选时间范围内没有匹配到该 GitHub 仓库的 Production READY 部署，因此未生成公告草稿。请核对日期范围、Vercel 项目配置及部署目标。";
  if (commitsChecked === 0) return `已从 Vercel 核验 ${deploymentsChecked} 条 Production READY 部署，但没有找到可关联的 GitHub 提交，未生成公告草稿。请检查 GitHub 仓库配置及提交读取权限。`;
  return `已核验 ${deploymentsChecked} 条正式部署状态、关联 ${commitsChecked} 条 GitHub 提交，但没有提交符合当前角色与通知类型筛选；未生成公告草稿。请调整筛选条件。`;
}

export function buildReleaseAnnouncement(commits: ReleaseCommit[], from: string, to: string, selectedRoles: UserRole[] | null, selectedCategory: ReleaseCategory) {
  const category = RELEASE_CATEGORIES[selectedCategory];
  const targeted = selectReleaseChanges(commits, selectedRoles, selectedCategory);
  if (!targeted.length) {
    return { title: `${category.icon} ${category.title}｜${from} 至 ${to}`, content: `${category.icon} ${category.label}\n📅 统计周期：${from} 至 ${to}\n👥 接收范围：${selectedRoles?.length ? selectedRoles.map(role => ROLE_LABELS[role]).join("、") : "所有启用用户"}\n\n该周期内未发现符合筛选条件、且已在 Vercel 正式环境成功部署的 GitHub 提交。` };
  }
  const grouped = new Map<string, string[]>();
  for (const commit of targeted) {
    const modules = inferReleaseModules(commit.files);
    const labels = modules.length ? modules : [commit.affectedRoles.includes("ALL") ? "全系统通用变更" : "功能范围待核对"];
    const items = commit.changeItems?.length ? commit.changeItems : extractVerifiedChangeItems(commit.message, commit.details);
    if (!items.length) throw new Error(`提交 ${commit.sha} 缺少可核实的中文变更说明，无法准确生成公告；请在发布记录中补充说明后重试。`);
    for (const item of items) {
      const label = moduleForChangeItem(item, labels);
      grouped.set(label, [...new Set([...(grouped.get(label) || []), item])]);
    }
  }
  const moduleNames = [...grouped.keys()];
  const subject = moduleNames.slice(0, 3).join("、") + (moduleNames.length > 3 ? `等${moduleNames.length}个功能模块` : "");
  const title = `${category.icon} ${from}至${to}正式发布｜${subject}（${targeted.length}条提交）`.slice(0, 120);
  const lines = [
    `发布期间：${from} 至 ${to}`,
    `接收范围：${selectedRoles?.length ? selectedRoles.map(role => ROLE_LABELS[role]).join("、") : "所有启用用户"}`,
  ];
  const footer = `以上内容对应 ${targeted.length} 次正式发布；提交与部署依据可在页面展开核对。`;
  const entries = [...grouped.entries()].flatMap(([module, items]) => [
    `${module}：`,
    ...items.map(item => `• ${item}`),
  ]);
  const join = (selected: string[], truncated: boolean) => [
    ...lines,
    "",
    ...selected,
    ...(truncated ? ["", "⚠️ 摘要已按长度限制收敛；如需查看全部改动，请缩小统计日期范围后重新生成。"] : []),
    footer,
  ].join("\n");
  const selectedEntries: string[] = [];
  let truncated = false;
  for (const entry of entries) {
    selectedEntries.push(entry);
    if (join(selectedEntries, false).length > 4000) {
      selectedEntries.pop();
      truncated = true;
      break;
    }
  }
  if (truncated) {
    const notice = "⚠️ 摘要已按长度限制收敛；如需查看全部改动，请缩小统计日期范围后重新生成。";
    while (selectedEntries.length && join([...selectedEntries, notice], false).length > 4000) selectedEntries.pop();
    return { title, content: join(selectedEntries, true) };
  }
  return { title, content: join(selectedEntries, false) };
}
