import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const scope = read("lib/auth/current-user.ts");
const options = read("app/api/users/options/route.ts");
const customer = read("components/customers-view.tsx");
const selector = read("components/user-scope-select.tsx");

assert.match(scope, /account\.role === "ADMIN"\) return !requested \|\| requested\.toLowerCase\(\) === "all" \? null : requested/);
assert.match(scope, /if \(!requested \|\| requested === account\.id \|\| requested\.toLowerCase\(\) === "all"\) return account\.id/);
assert.match(options, /default_all: profile\.role !== "SUPERVISOR" \|\| creatorOptions/);
assert.match(selector, /body\.default_all && body\.can_select_all \? "all" : body\.profile\.id/);
assert.match(customer, /\["ADMIN", "ORDER_CLERK"\]\.includes\(role\) \? "all" : fallback/);
assert.match(customer, /currentRole === "ADMIN" \? "all" : defaultScopeUserId/);
console.log("Administrator default-all scope contracts passed.");
