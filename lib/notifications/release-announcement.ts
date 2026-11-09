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
};

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
  const matchingCategory = commits.filter(commit => selectedCategory === "ALL" || commit.category === selectedCategory);
  const targeted = selectedRoles?.length ? matchingCategory.filter(commit => commit.affectedRoles.includes("ALL") || commit.affectedRoles.some(role => role !== "ALL" && selectedRoles.includes(role))) : matchingCategory;
  const moduleNames = [...new Set(targeted.flatMap(commit => inferReleaseModules(commit.files, selectedRoles)))];
  const subjects = moduleNames.length ? moduleNames : [...new Set(targeted.map(commit => commit.message).filter(Boolean))];
  const subject = subjects.slice(0, 3).join("、") + (subjects.length > 3 ? `等${subjects.length}个功能模块` : "");
  const title = targeted.length
    ? `${category.icon} ${from}至${to}正式发布｜${subject || "系统更新"}（${targeted.length}条提交）`.slice(0, 120)
    : `${category.icon} ${category.title}｜${from} 至 ${to}`;
  if (!targeted.length) {
    return { title, content: `${category.icon} ${category.label}\n📅 统计周期：${from} 至 ${to}\n👥 接收范围：${selectedRoles?.length ? selectedRoles.map(role => ROLE_LABELS[role]).join("、") : "所有启用用户"}\n\n该周期内未发现符合筛选条件、且已在 Vercel 正式环境成功部署的 GitHub 提交。` };
  }
  const grouped = new Map<string, ReleaseCommit[]>();
  for (const commit of targeted) {
    const modules = inferReleaseModules(commit.files, selectedRoles);
    const labels = modules.length ? modules : [commit.affectedRoles.includes("ALL") ? "全系统通用变更" : "功能范围待核对"];
    for (const label of labels) grouped.set(label, [...(grouped.get(label) || []), commit]);
  }
  const lines = [
    `${category.icon} ${category.label}`,
    `📅 统计周期：${from} 至 ${to}`,
    `👥 影响范围：${selectedRoles?.length ? selectedRoles.map(role => ROLE_LABELS[role]).join("、") : "所有启用用户"}`,
    `🔎 依据：下列改动均来自 GitHub 提交，并已按提交 SHA 匹配所选时段内 Vercel Production READY 部署；类型根据提交说明归类。`,
  ];
  const footer = `✅ 共 ${targeted.length} 个不同的正式发布提交；下方证据明细可逐项核对。`;
  const entries = [...grouped.entries()].flatMap(([module, items]) => [
    `🔹 ${module}`,
    ...items.map(item => `• ${RELEASE_CATEGORIES[item.category].label}：${item.message}${item.details ? `；${item.details}` : ""}（影响：${item.affectedRoles.includes("ALL") ? "所有角色" : item.affectedRoles.map(role => ROLE_LABELS[role]).join("、") || "待确认"}）`),
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
