import assert from "node:assert/strict";
import { buildOperationalAnnouncement } from "../lib/notifications/announcement-templates.ts";

const maintenance = buildOperationalAnnouncement({ template: "MAINTENANCE", scope: "PI订单与备货单", start: "2026-11-10T22:00", end: "2026-11-10T23:00", impact: "维护期间暂不可提交单据", action: "请提前保存草稿" });
const active = buildOperationalAnnouncement({ template: "MAINTENANCE_ACTIVE", scope: "PI订单与备货单", start: "2026-11-10T22:00", impact: "部分功能暂不可用", action: "请稍后重试" });
assert.match(active.title, /系统维护中/);
assert.doesNotMatch(active.content, /预计结束/);
assert.equal(maintenance.title, "系统维护预告｜PI订单与备货单");
assert.match(maintenance.content, /维护时间：2026-11-10 22:00 至 2026-11-10 23:00/);
assert.match(maintenance.content, /请提前保存草稿/);
assert.throws(() => buildOperationalAnnouncement({ template: "SERVICE_PAUSE", scope: "工作台", start: "2026-11-10T22:00", impact: "暂停访问", action: "稍后重试" }), /预计结束时间/);
assert.throws(() => buildOperationalAnnouncement({ template: "MAINTENANCE", scope: "工作台", start: "2026-11-10T23:00", end: "2026-11-10T22:00", impact: "暂停访问", action: "稍后重试" }), /结束时间不能早于开始时间/);
const restored = buildOperationalAnnouncement({ template: "SERVICE_RESTORED", scope: "工作台", start: "2026-11-10T23:00", impact: "服务已恢复", action: "如有异常请联系管理员" });
assert.doesNotMatch(restored.content, /预计/);
assert.match(restored.content, /服务已恢复/);

console.log("运营公告模板校验通过");
