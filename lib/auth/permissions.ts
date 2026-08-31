export const USER_ROLES = ["ADMIN", "SUPERVISOR", "SALES"] as const;
export const ACCOUNT_STATUSES = ["PENDING", "ACTIVE", "REJECTED", "DISABLED", "LOCKED"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type PermissionGroup = "工作台" | "客户管理" | "数据导入" | "AI筛选" | "跟进管理" | "报表中心" | "系统管理";

export type PermissionDefinition = {
  code: string;
  label: string;
  group: PermissionGroup;
  description: string;
  kind: "PAGE" | "ACTION" | "DATA";
  core?: boolean;
};

/**
 * 权限目录是前端按钮、服务端 API 和管理后台唯一共用的权限来源。
 * core 权限只能由系统管理员持有，避免把账号审核、授权和安全配置下放后形成提权闭环。
 */
export const PERMISSION_CATALOG: PermissionDefinition[] = [
  { code: "dashboard.view", label: "查看工作台", group: "工作台", description: "进入工作台并查看业务概览", kind: "PAGE" },
  { code: "dashboard.data_all", label: "查看全部工作台数据", group: "工作台", description: "可切换归属人并查看全部销售数据", kind: "DATA" },

  { code: "customers.view", label: "查看客户列表与详情", group: "客户管理", description: "进入客户管理并查看允许范围内的客户", kind: "PAGE" },
  { code: "customers.data_all", label: "查看全部客户数据", group: "客户管理", description: "可按归属人查看全部客户", kind: "DATA" },
  { code: "customers.create", label: "新增客户", group: "客户管理", description: "手动创建客户资料", kind: "ACTION" },
  { code: "customers.edit", label: "编辑客户", group: "客户管理", description: "编辑有权访问的客户基本资料", kind: "ACTION" },
  { code: "customers.delete", label: "删除客户", group: "客户管理", description: "单条或批量物理删除客户", kind: "ACTION" },
  { code: "customers.export", label: "导出客户", group: "客户管理", description: "导出当前查询范围的客户数据", kind: "ACTION" },
  { code: "customers.batch_edit", label: "批量更新客户", group: "客户管理", description: "批量更新客户阶段等字段", kind: "ACTION" },
  { code: "customers.claim", label: "认领客户", group: "客户管理", description: "认领无归属客户或冲突客户", kind: "ACTION" },
  { code: "customers.release", label: "释放客户", group: "客户管理", description: "释放本人名下客户", kind: "ACTION" },
  { code: "customers.assign", label: "分配客户", group: "客户管理", description: "将客户分配或转移给其他归属人", kind: "ACTION" },
  { code: "customers.ai_evidence_view", label: "查看AI分析依据", group: "客户管理", description: "查看客户AI结论与可核验证据", kind: "ACTION" },

  { code: "imports.view", label: "查看导入记录", group: "数据导入", description: "进入数据导入并查看导入批次", kind: "PAGE" },
  { code: "imports.create", label: "执行数据导入", group: "数据导入", description: "预览并提交客户文件导入", kind: "ACTION" },
  { code: "imports.data_all", label: "查看全部导入记录", group: "数据导入", description: "查看所有归属人的导入批次", kind: "DATA" },

  { code: "ai.tasks.view", label: "查看AI筛选任务", group: "AI筛选", description: "进入AI筛选并查看任务详情", kind: "PAGE" },
  { code: "ai.data_all", label: "查看全部AI筛选数据", group: "AI筛选", description: "可按归属人查看任务、结果与用量", kind: "DATA" },
  { code: "ai.tasks.create", label: "创建AI筛选任务", group: "AI筛选", description: "选择客户并创建筛选任务", kind: "ACTION" },
  { code: "ai.tasks.control", label: "控制AI筛选任务", group: "AI筛选", description: "停止、继续、取消或重试任务", kind: "ACTION" },
  { code: "ai.tasks.delete", label: "删除AI筛选任务", group: "AI筛选", description: "删除本人有权管理的任务", kind: "ACTION" },
  { code: "ai.results.view", label: "查看AI结果与依据", group: "AI筛选", description: "查看任务报告、客户结果和分析依据", kind: "ACTION" },
  { code: "ai.results.review", label: "复核AI分析结果", group: "AI筛选", description: "人工修正目标判断、等级和评分", kind: "ACTION" },
  { code: "ai.usage.view", label: "查看本人AI用量", group: "AI筛选", description: "查看允许范围内的AI用量与费用", kind: "ACTION" },
  { code: "ai.usage.view_all", label: "查看全部AI用量", group: "AI筛选", description: "查看所有归属人的AI用量与费用", kind: "DATA" },

  { code: "followups.view", label: "查看跟进管理", group: "跟进管理", description: "进入跟进管理并查看计划", kind: "PAGE" },
  { code: "followups.data_all", label: "查看全部跟进数据", group: "跟进管理", description: "可按归属人查看全部跟进记录", kind: "DATA" },
  { code: "followups.create", label: "新增跟进记录", group: "跟进管理", description: "为有权访问的客户新增跟进", kind: "ACTION" },

  { code: "reports.view", label: "查看报表中心", group: "报表中心", description: "进入报表中心查看统计数据", kind: "PAGE" },
  { code: "reports.data_all", label: "查看全部报表数据", group: "报表中心", description: "可按归属人查看全部销售报表", kind: "DATA" },
  { code: "reports.export", label: "导出报表", group: "报表中心", description: "导出允许范围内的报表", kind: "ACTION" },

  { code: "system.users.view", label: "查看用户管理", group: "系统管理", description: "查看账号与审核状态", kind: "PAGE", core: true },
  { code: "system.users.manage", label: "管理用户账号", group: "系统管理", description: "审核、启停、改角色、重置密码", kind: "ACTION", core: true },
  { code: "system.roles.view", label: "查看权限配置", group: "系统管理", description: "查看角色与用户权限", kind: "PAGE", core: true },
  { code: "system.roles.manage", label: "配置角色与用户权限", group: "系统管理", description: "调整角色默认权限和用户覆盖权限", kind: "ACTION", core: true },
  { code: "system.audit.view", label: "查看操作日志", group: "系统管理", description: "查看系统关键操作审计记录", kind: "PAGE", core: true },
  { code: "system.security.view", label: "查看安全设置", group: "系统管理", description: "查看登录与密码安全策略", kind: "PAGE", core: true },
  { code: "system.security.manage", label: "修改安全设置", group: "系统管理", description: "修改登录锁定与临时密码策略", kind: "ACTION", core: true },
];

export const PERMISSION_CODES = new Set(PERMISSION_CATALOG.map((item) => item.code));
export const CORE_PERMISSION_CODES = new Set(PERMISSION_CATALOG.filter((item) => item.core).map((item) => item.code));

export function isKnownPermission(code: string) {
  return PERMISSION_CODES.has(code);
}

export type UserProfile = {
  id: string;
  role: UserRole;
  status: AccountStatus;
  department_id?: string | null;
};

export function canManageAll(role: UserRole) {
  return role === "ADMIN" || role === "SUPERVISOR";
}

export function canManageDepartment(profile: UserProfile, departmentId: string | null) {
  void departmentId;
  return canManageAll(profile.role);
}

export function canAccessCustomer(
  profile: UserProfile,
  customer: { owner_id: string | null; department_id: string | null; status: string },
) {
  if (canManageAll(profile.role)) return true;
  return customer.owner_id === profile.id || customer.status === "UNCLAIMED" || customer.status === "RELEASED";
}

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "系统管理员",
  SUPERVISOR: "主管",
  SALES: "销售员",
};

export const STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING: "待审核",
  ACTIVE: "已启用",
  REJECTED: "已拒绝",
  DISABLED: "已停用",
  LOCKED: "已锁定",
};

export function normalizeRole(value: unknown): UserRole {
  const role = String(value || "SALES").toUpperCase();
  if (role === "MANAGER") return "SUPERVISOR";
  return USER_ROLES.includes(role as UserRole) ? role as UserRole : "SALES";
}

export function normalizeStatus(value: unknown): AccountStatus {
  const status = String(value || "PENDING").toUpperCase();
  return ACCOUNT_STATUSES.includes(status as AccountStatus) ? status as AccountStatus : "PENDING";
}
