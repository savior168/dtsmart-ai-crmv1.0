import assert from "node:assert/strict";
import { notificationVoiceText } from "../lib/notification-voice.ts";

assert.equal(notificationVoiceText({ type: "FOLLOWUP_DUE", content: "Call buyer" }), null);
assert.equal(notificationVoiceText({ type: "FOLLOWUP_REQUIRED", content: "客户待跟进" }), null);
assert.equal(notificationVoiceText({ type: "CUSTOMER_FOLLOWUP_STATUS", content: "待跟进" }), null);
assert.equal(notificationVoiceText({ type: "UNKNOWN", content: "待处理" }), null);
assert.equal(notificationVoiceText({ type: "STOCK_STATUS_CHANGED", content: "备货状态已更新为备货中" }), null);
assert.equal(notificationVoiceText({ type: "STOCK_STATUS_CHANGED", content: "备货状态已更新为已回货" }), null);
assert.equal(notificationVoiceText({ type: "STOCK_STATUS_CHANGED", content: "备货状态已更新为理货中" }), null);
assert.equal(notificationVoiceText({ type: "STOCK_STATUS_CHANGED", content: "订单已取消，备注中提到已发货" }), null);
assert.equal(notificationVoiceText({ type: "STOCK_STATUS_CHANGED", content: "订单 D-1 的备货状态已更新为备货中：请问何时已发货？" }), null);
assert.match(notificationVoiceText({ type: "REGISTRATION_REVIEW" }), /账户审核/);
assert.match(notificationVoiceText({ type: "STOCK_ORDER_CREATED", content: "PI订单 WH-001 已提交仓库" }), /WH-001/);
assert.doesNotMatch(notificationVoiceText({ type: "STOCK_ORDER_CREATED", metadata: { order_number: "X@secret" } }), /secret/);
assert.match(notificationVoiceText({ type: "STOCK_STATUS_CHANGED", content: "备货状态已更新为缺货异常" }), /缺货异常/);
assert.match(notificationVoiceText({ type: "STOCK_STATUS_CHANGED", content: "订单 D-1 的备货状态已更新为待出货：请核对。" }), /待出货/);
console.log("notification voice whitelist tests passed");
