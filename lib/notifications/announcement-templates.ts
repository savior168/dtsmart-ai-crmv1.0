export type AnnouncementTemplate = "NONE" | "MAINTENANCE" | "MAINTENANCE_ACTIVE" | "SERVICE_PAUSE" | "SERVICE_RESTORED" | "INCIDENT";

export const ANNOUNCEMENT_TEMPLATES: Record<AnnouncementTemplate, string> = {
  NONE: "不使用模板",
  MAINTENANCE: "计划维护预告",
  MAINTENANCE_ACTIVE: "系统维护中",
  SERVICE_PAUSE: "服务暂停通知",
  SERVICE_RESTORED: "服务恢复通知",
  INCIDENT: "系统故障通知",
};

/** Operational notices are authored from confirmed facts, never inferred from commits. */
export function buildOperationalAnnouncement(input: {
  template: Exclude<AnnouncementTemplate, "NONE">;
  scope: string;
  start: string;
  end?: string;
  impact: string;
  action: string;
}) {
  const scope = input.scope.trim();
  const impact = input.impact.trim();
  const action = input.action.trim();
  if (!scope || !input.start || !impact || !action) throw new Error("请填写影响范围、开始时间、实际影响和用户操作");
  if ((input.template === "MAINTENANCE" || input.template === "SERVICE_PAUSE") && !input.end) throw new Error("请填写预计结束时间");
  if (input.end && input.end < input.start) throw new Error("结束时间不能早于开始时间");
  const date = (value: string) => value.replace("T", " ");
  switch (input.template) {
    case "MAINTENANCE": return {
      title: `系统维护预告｜${scope}`,
      content: `维护时间：${date(input.start)} 至 ${date(input.end!)}\n影响范围：${scope}\n预计影响：${impact}\n用户操作：${action}\n维护进展及恢复时间以后续通知为准。`,
    };
    case "MAINTENANCE_ACTIVE": return {
      title: `系统维护中｜${scope}`,
      content: `开始时间：${date(input.start)}${input.end ? `\n预计结束：${date(input.end)}` : ""}\n影响范围：${scope}\n当前影响：${impact}\n用户操作：${action}\n实际恢复时间以后续通知为准。`,
    };
    case "SERVICE_PAUSE": return {
      title: `服务暂停通知｜${scope}`,
      content: `暂停时间：${date(input.start)} 至预计 ${date(input.end!)}\n影响范围：${scope}\n当前影响：${impact}\n用户操作：${action}\n实际恢复时间以后续通知为准。`,
    };
    case "SERVICE_RESTORED": return {
      title: `服务恢复通知｜${scope}`,
      content: `恢复时间：${date(input.start)}\n恢复范围：${scope}\n当前状态：${impact}\n用户操作：${action}`,
    };
    case "INCIDENT": return {
      title: `系统故障通知｜${scope}`,
      content: `发现时间：${date(input.start)}\n影响范围：${scope}\n当前影响：${impact}\n用户操作：${action}\n处理进展以后续通知为准。`,
    };
  }
}
