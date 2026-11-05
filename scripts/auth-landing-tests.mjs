import assert from "node:assert/strict";
import { firstAuthorizedPage } from "../lib/auth/landing-page.ts";

assert.equal(firstAuthorizedPage((code) => code === "dashboard.view"), "/");
assert.equal(firstAuthorizedPage((code) => code === "orders.view"), "/orders");
assert.equal(firstAuthorizedPage((code) => code === "suppliers.view"), "/suppliers");
assert.equal(firstAuthorizedPage((code) => ["orders.view", "stock.view"].includes(code)), "/orders");
assert.equal(firstAuthorizedPage(() => false), null);
console.log("Authorized landing page tests passed.");
