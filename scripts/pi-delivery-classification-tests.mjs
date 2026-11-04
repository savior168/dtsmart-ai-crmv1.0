import assert from "node:assert/strict";
import { customerDeliveryMatchesForwarder } from "../lib/orders/pi-delivery-match.ts";

const forwarder = "广州市越秀区文德路仁康里22号楼105(A4)";
assert.equal(customerDeliveryMatchesForwarder(`货代公司 18520606424 ${forwarder}`, [], [{ address: forwarder }]), true);
assert.equal(customerDeliveryMatchesForwarder(`${forwarder} 备注：业务员 020-81685989`, [], [{ address: forwarder }]), true);
assert.equal(customerDeliveryMatchesForwarder("客户自己的收货地址", [forwarder], []), false);
assert.equal(customerDeliveryMatchesForwarder("广州市", [forwarder], []), false);
assert.equal(customerDeliveryMatchesForwarder("", [forwarder], []), false);
console.log("PI customer/forwarder delivery classification passed");
