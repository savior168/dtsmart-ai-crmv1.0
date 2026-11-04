import assert from "node:assert/strict";
import { resolvePiRequirementAttachments, piRequirementProductLabel } from "../lib/orders/pi-requirement-attachment-view.ts";

const oldProduct = { id: "old", line_number: 1, item_name: "LCD", brand: "A", model: "M1", quality: "new" };
const otherProduct = { id: "other", line_number: 2, item_name: "Battery", brand: "B", model: "M2", quality: "new" };
const label = piRequirementProductLabel(oldProduct);
const attachment = { sales_order_item_id: "old", pi_line_number_snapshot: 1, pi_product_label_snapshot: label };
assert.deepEqual(resolvePiRequirementAttachments([attachment], [oldProduct])[0], {
  ...attachment, display_line_number: 1, archived: false,
});
assert.equal(resolvePiRequirementAttachments([attachment], [{ ...oldProduct, line_number: 2 }, { ...otherProduct, line_number: 1 }])[0].display_line_number, 2);
assert.equal(resolvePiRequirementAttachments([{ ...attachment, sales_order_item_id: null }], [otherProduct])[0].archived, true);
assert.equal(resolvePiRequirementAttachments([attachment], [{ ...oldProduct, quality: "refurbished" }])[0].archived, true);
assert.equal(resolvePiRequirementAttachments([{ sales_order_item_id: null, pi_line_number_snapshot: null, pi_product_label_snapshot: null }], [])[0].archived, false);
console.log("PI requirement attachment association tests passed");
