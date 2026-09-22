export const USER_ROLES = ["ADMIN", "SUPERVISOR", "SALES", "WAREHOUSE"] as const;
export const ACCOUNT_STATUSES = ["PENDING", "ACTIVE", "REJECTED", "DISABLED", "DEPARTED", "LOCKED"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type PermissionGroup = "工作台" | "客户中心" | "AI获客与筛选" | "商品中心" | "销售管理" | "仓库管理" | "报表中心" | "站内通知" | "系统管理";

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

  { code: "customers.view", label: "客户公海与我的客户", group: "客户中心", description: "进入客户公海、我的客户及客户详情", kind: "PAGE" },
  { code: "customers.data_all", label: "查看全部客户数据", group: "客户中心", description: "可按归属人查看全部客户", kind: "DATA" },
  { code: "customers.create", label: "新增客户", group: "客户中心", description: "手动创建客户资料", kind: "ACTION" },
  { code: "customers.edit", label: "编辑客户", group: "客户中心", description: "编辑有权访问的客户基本资料", kind: "ACTION" },
  { code: "customers.delete", label: "删除客户", group: "客户中心", description: "单条或批量物理删除客户", kind: "ACTION" },
  { code: "customers.export", label: "导出客户", group: "客户中心", description: "导出当前查询范围的客户数据", kind: "ACTION" },
  { code: "customers.batch_edit", label: "批量维护客户", group: "客户中心", description: "执行系统明确支持的非阶段批量维护操作；客户阶段只能单条修改", kind: "ACTION" },
    { code: "customers.release", label: "释放客户", group: "客户中心", description: "释放客户到公海；系统管理员可操作任意归属客户", kind: "ACTION" },
  { code: "customers.claim", label: "认领公海客户", group: "客户中心", description: "凭真实联系记录认领尚未归属的公海客户", kind: "ACTION" },
  { code: "customers.renew", label: "客户保护续期", group: "客户中心", description: "为本人仍持有且处于宽限期的客户续期45天", kind: "ACTION" },
  { code: "customers.renew.review", label: "审核下属续期", group: "客户中心", description: "审核直属销售员第三次及之后的保护续期", kind: "ACTION" },
  { code: "customers.assign", label: "分配公海客户", group: "客户中心", description: "仅分配尚未认领或离职待分配客户", kind: "ACTION", core: true },
  { code: "customers.handover", label: "离职客户交接", group: "客户中心", description: "将停用或离职账号的客户整批释放或交接", kind: "ACTION", core: true },
  { code: "customers.ai_evidence_view", label: "查看AI分析依据", group: "客户中心", description: "查看客户AI结论与可核验证据", kind: "ACTION" },

  { code: "imports.view", label: "客户导入", group: "客户中心", description: "进入客户导入并查看导入批次", kind: "PAGE" },
  { code: "imports.create", label: "执行数据导入", group: "客户中心", description: "预览并提交客户文件导入", kind: "ACTION" },
  { code: "imports.data_all", label: "查看全部导入记录", group: "客户中心", description: "查看所有归属人的导入批次", kind: "DATA" },

  // AI 获客与 AI 筛选是两个独立的业务闭环。每一项获客权限都归属此页面，
  // 因此前端可见性、接口鉴权和用户权限中心使用同一套权限代码。
  { code: "ai.acquisition.view", label: "AI获客", group: "AI获客与筛选", description: "进入AI获客任务、结果与核验明细", kind: "PAGE" },
  { code: "ai.acquisition.data_all", label: "查看全部AI获客数据", group: "AI获客与筛选", description: "查看本部门授权范围内其他创建人的获客任务、候选结果与费用明细", kind: "DATA" },
  { code: "ai.acquisition.create", label: "创建AI获客任务", group: "AI获客与筛选", description: "按目标国家、行业和关键词创建获客任务", kind: "ACTION" },
  { code: "ai.acquisition.control", label: "控制AI获客任务", group: "AI获客与筛选", description: "暂停、继续、取消或重试本人有权管理的获客任务", kind: "ACTION" },
  { code: "ai.acquisition.evidence.view", label: "查看AI获客依据", group: "AI获客与筛选", description: "查看目标匹配、在营状态、联系信息与来源页面的核验依据", kind: "ACTION" },
  { code: "ai.acquisition.usage.view", label: "查看AI获客用量与费用", group: "AI获客与筛选", description: "查看获客调用量、免费额度使用和可核对的费用明细", kind: "ACTION" },
  { code: "ai.acquisition.settings.manage", label: "管理AI获客规则与费用控制", group: "AI获客与筛选", description: "配置支持国家、质量准入门槛、标准模式免费渠道和智能模式费用上限", kind: "ACTION", core: true },
  { code: "ai.tasks.view", label: "AI筛选", group: "AI获客与筛选", description: "进入AI筛选并查看任务详情", kind: "PAGE" },
  { code: "ai.data_all", label: "查看全部AI筛选数据", group: "AI获客与筛选", description: "可按归属人查看任务、结果与用量", kind: "DATA" },
  { code: "ai.tasks.create", label: "创建AI筛选任务", group: "AI获客与筛选", description: "选择客户并创建筛选任务", kind: "ACTION" },
  { code: "ai.tasks.control", label: "控制AI筛选任务", group: "AI获客与筛选", description: "停止、继续、取消或重试任务", kind: "ACTION" },
  { code: "ai.tasks.delete", label: "删除AI筛选任务", group: "AI获客与筛选", description: "删除本人有权管理的任务", kind: "ACTION" },
  { code: "ai.results.view", label: "查看AI结果与依据", group: "AI获客与筛选", description: "查看任务报告、客户结果和分析依据", kind: "ACTION" },
  { code: "ai.results.review", label: "复核AI分析结果", group: "AI获客与筛选", description: "人工修正目标判断、等级和评分", kind: "ACTION" },
  { code: "ai.usage.view", label: "查看AI筛选用量与费用", group: "AI获客与筛选", description: "进入AI筛选用量页面；默认仅系统管理员开启，可由管理员按角色或用户授权", kind: "ACTION" },
  { code: "ai.usage.view_all", label: "查看全部AI用量", group: "AI获客与筛选", description: "查看所有归属人的AI用量与费用", kind: "DATA" },
  { code: "ai.cost_summary.view", label: "查看AI历史成本总览", group: "AI获客与筛选", description: "查看系统全历史分析次数及第三方API成本汇总；默认仅系统管理员开启", kind: "ACTION" },
  { code: "ai.settings.manage", label: "管理AI筛选设置", group: "AI获客与筛选", description: "配置付费渠道、日周月硬性上限和单客户调用限制；默认仅系统管理员开启", kind: "ACTION" },

  { code: "followups.view", label: "跟进管理", group: "客户中心", description: "进入跟进管理并查看计划", kind: "PAGE" },
  { code: "followups.data_all", label: "查看全部跟进数据", group: "客户中心", description: "可按归属人查看全部跟进记录", kind: "DATA" },
  { code: "followups.create", label: "新增跟进记录", group: "客户中心", description: "为有权访问的客户新增跟进", kind: "ACTION" },
  { code: "followups.edit", label: "修改本人跟进记录", group: "客户中心", description: "修改本人创建的跟进内容与附件", kind: "ACTION" },
  { code: "followups.export", label: "导出跟进记录", group: "客户中心", description: "导出当前筛选范围内的跟进记录", kind: "ACTION" },

  { code: "products.view", label: "商品资料", group: "商品中心", description: "进入商品资料并搜索可报价SKU", kind: "PAGE" },
  { code: "products.manage", label: "维护商品资料", group: "商品中心", description: "新增、编辑、启用或停用商品主档", kind: "ACTION", core: true },
  { code: "pricebooks.view", label: "产品价格表", group: "商品中心", description: "进入产品价格表并查看有效销售参考价", kind: "PAGE" },
  { code: "pricebooks.sales.view", label: "查看销售参考价", group: "商品中心", description: "查看已发布美元销售参考价；不包含采购成本和利润底线", kind: "DATA" },
  { code: "pricebooks.cost.total.view", label: "查看完整成本合计", group: "商品中心", description: "仅查看采购、包装和其他费用合计，不显示成本拆分和来源", kind: "DATA" },
  { code: "pricebooks.cost.view", label: "查看采购成本", group: "商品中心", description: "查看人民币采购价、包装费、其他成本及其来源；销售员默认不可见", kind: "DATA" },
  { code: "pricebooks.manage", label: "维护产品价格", group: "商品中心", description: "新增、调整或停用产品价格版本", kind: "ACTION", core: true },
  { code: "pricebooks.import", label: "导入产品报价表", group: "商品中心", description: "上传并预览产品报价表，处理字段歧义和异常行", kind: "ACTION", core: true },
  { code: "pricebooks.publish", label: "发布产品价格表", group: "商品中心", description: "将全部校验通过的导入批次发布到商品与价格主档", kind: "ACTION", core: true },

  { code: "quotes.view", label: "报价单", group: "销售管理", description: "查看权限范围内的报价单", kind: "PAGE" },
  { code: "quotes.data_all", label: "查看全部报价", group: "销售管理", description: "可按归属人只读查看全部报价", kind: "DATA" },
  { code: "quotes.create", label: "创建报价单", group: "销售管理", description: "为本人客户创建报价单", kind: "ACTION" },
  { code: "quotes.edit", label: "编辑本人报价", group: "销售管理", description: "编辑本人尚未确认的报价单", kind: "ACTION" },
  { code: "quotes.confirm", label: "确认本人报价", group: "销售管理", description: "记录客户确认并创建销售订单和待完善备货单", kind: "ACTION" },
  { code: "quotes.export", label: "导出报价单", group: "销售管理", description: "按标准PI模板导出报价Excel", kind: "ACTION" },
  { code: "quotes.cancel", label: "取消本人报价", group: "销售管理", description: "取消本人未确认的报价单", kind: "ACTION" },

  { code: "orders.view", label: "销售订单", group: "销售管理", description: "查看报价确认后形成的销售订单快照", kind: "PAGE" },
  { code: "orders.data_all", label: "查看全部销售订单", group: "销售管理", description: "主管只读查看全部销售订单", kind: "DATA" },
  { code: "orders.edit", label: "修改本人订单说明", group: "销售管理", description: "修改本人未结束订单的交付日期和确认说明", kind: "ACTION" },
  { code: "orders.cancel", label: "取消本人订单", group: "销售管理", description: "填写原因并联动取消未结束订单和备货单", kind: "ACTION" },
  { code: "orders.export", label: "导出销售订单", group: "销售管理", description: "导出允许范围内的订单明细", kind: "ACTION" },

  { code: "stock.view", label: "备货单", group: "仓库管理", description: "查看允许范围内的备货单", kind: "PAGE" },
  { code: "stock.data_all", label: "查看全部备货单", group: "仓库管理", description: "按归属人查看全部备货进度", kind: "DATA" },
  { code: "stock.update", label: "更新备货状态", group: "仓库管理", description: "仓库员更新备货状态与备注", kind: "ACTION" },
  { code: "stock.prepare", label: "完善备货信息", group: "仓库管理", description: "订单归属销售员填写仓库中文描述、采购成本和理货要求", kind: "ACTION" },
  { code: "stock.submit", label: "提交备货单", group: "仓库管理", description: "订单归属销售员将已完善备货单提交仓库", kind: "ACTION" },
  { code: "stock.export", label: "导出备货单", group: "仓库管理", description: "按仓库模板导出备货Excel", kind: "ACTION" },

  { code: "reports.view", label: "查看报表中心", group: "报表中心", description: "进入报表中心查看统计数据", kind: "PAGE" },
  { code: "reports.data_all", label: "查看全部报表数据", group: "报表中心", description: "可按归属人查看全部销售报表", kind: "DATA" },
  { code: "reports.export", label: "导出报表", group: "报表中心", description: "导出允许范围内的报表", kind: "ACTION" },

  { code: "costs.view", label: "费用中心", group: "系统管理", description: "查看全部第三方API费用及明细", kind: "PAGE", core: true },
  { code: "costs.export", label: "导出费用明细", group: "系统管理", description: "导出统一API费用台账", kind: "ACTION", core: true },

  { code: "notifications.view", label: "查看站内通知", group: "站内通知", description: "查看并处理发送给本人的业务通知", kind: "PAGE" },

  { code: "system.users.view", label: "查看用户管理", group: "系统管理", description: "查看账号与审核状态", kind: "PAGE", core: true },
  { code: "system.users.manage", label: "管理用户账号", group: "系统管理", description: "审核、启停、改角色、重置密码", kind: "ACTION", core: true },
  { code: "system.roles.view", label: "查看权限配置", group: "系统管理", description: "查看角色与用户权限", kind: "PAGE", core: true },
  { code: "system.roles.manage", label: "配置角色与用户权限", group: "系统管理", description: "调整角色默认权限和用户覆盖权限", kind: "ACTION", core: true },
  { code: "system.audit.view", label: "查看操作日志", group: "系统管理", description: "查看本人产生的系统关键操作记录；系统管理员可切换操作人", kind: "PAGE" },
  { code: "system.security.view", label: "查看安全设置", group: "系统管理", description: "只读查看登录与密码安全策略", kind: "PAGE" },
  { code: "system.security.manage", label: "修改安全设置", group: "系统管理", description: "修改登录锁定与临时密码策略", kind: "ACTION", core: true },
];

export const PERMISSION_CODES = new Set(PERMISSION_CATALOG.map((item) => item.code));
export const CORE_PERMISSION_CODES = new Set(PERMISSION_CATALOG.filter((item) => item.core).map((item) => item.code));

export function isKnownPermission(code: string) {
  return PERMISSION_CODES.has(code);
}

/**
 * Every data/action permission belongs to one visible page. Keeping this map
 * beside the catalog makes the permission tree and server-side enforcement
 * use the same hierarchy as the current sidebar.
 */
export function permissionPageCode(code: string) {
  if (code.endsWith(".view") && PERMISSION_CATALOG.some((item) => item.code === code && item.kind === "PAGE")) return code;
  if (code.startsWith("dashboard.")) return "dashboard.view";
  if (code.startsWith("customers.")) return "customers.view";
  if (code.startsWith("imports.")) return "imports.view";
  if (code.startsWith("ai.acquisition.")) return "ai.acquisition.view";
  if (code.startsWith("ai.")) return "ai.tasks.view";
  if (code.startsWith("followups.")) return "followups.view";
  if (code.startsWith("products.")) return "products.view";
  if (code.startsWith("pricebooks.")) return "pricebooks.view";
  if (code.startsWith("quotes.")) return "quotes.view";
  if (code.startsWith("orders.")) return "orders.view";
  if (code.startsWith("stock.")) return "stock.view";
  if (code.startsWith("reports.")) return "reports.view";
  if (code.startsWith("costs.")) return "costs.view";
  if (code.startsWith("notifications.")) return "notifications.view";
  if (code.startsWith("system.users.")) return "system.users.view";
  if (code.startsWith("system.roles.")) return "system.roles.view";
  if (code.startsWith("system.audit.")) return "system.audit.view";
  if (code.startsWith("system.security.")) return "system.security.view";
  return code;
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
  WAREHOUSE: "仓库员",
};

export const STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING: "待审核",
  ACTIVE: "已启用",
  REJECTED: "已拒绝",
  DISABLED: "已停用",
  DEPARTED: "已离职",
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
