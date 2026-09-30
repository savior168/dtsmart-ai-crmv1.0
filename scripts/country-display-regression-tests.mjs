import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countryFilterOptions, countryFilterRawValues, countryInfo } from "../lib/countries.ts";

for (const value of ["GB", "gb", " UK ", "英国", "United Kingdom", "GB 英国"]) {
  assert.deepEqual(countryInfo(value), { code: "GB", name: "英国" }, `英国历史值应统一展示：${value}`);
}
for (const [value, code, name] of [
  ["FR", "FR", "法国"], ["France", "FR", "法国"], ["法国", "FR", "法国"],
  ["US", "US", "美国"], ["USA", "US", "美国"], ["中国", "CN", "中国"],
]) assert.deepEqual(countryInfo(value), { code, name });
assert.deepEqual(countryInfo(null), { code: "", name: "未知地区" });
assert.deepEqual(countryInfo("未核实地区"), { code: "", name: "未核实地区" }, "未识别原始值不得猜测成其他国家");
const filters = countryFilterOptions(["IE", "爱尔兰", "ES", "GB"]);
assert.equal(filters.length, 3, "国家筛选应将代码与中文名称合为同一项");
assert.deepEqual(filters[0], { value: "IE", label: "爱尔兰", count: 2 });
assert.ok(countryFilterRawValues(["IE"]).includes("爱尔兰"), "筛选爱尔兰须覆盖中文存量值");
assert.ok(countryFilterRawValues(["爱尔兰"]).includes("IE"), "旧链接中的中文筛选值须覆盖国家代码");
assert.ok(countryFilterRawValues(["GB"]).includes("GB 英国"), "筛选须覆盖已有的代码加名称存量写法");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
for (const path of ["app/api/customers/route.ts", "app/api/customers/public-pool/route.ts", "app/api/ai-acquisition/customers/route.ts", "app/api/ai/tasks/[id]/items/route.ts"]) {
  assert.match(read(path), /countryFilterOptions\(/, `${path} 国家选项应按规范国家去重`);
  assert.match(read(path), /countryFilterRawValues\(/, `${path} 国家查询应覆盖历史原始写法`);
}
for (const path of [
  "components/customers-view.tsx", "components/customer-public-pool-view.tsx",
  "components/followups-view.tsx", "components/crm-dashboard.tsx",
  "components/customer-workspace-panels.tsx", "components/customer-workspace-panels-v2.tsx",
  "components/ai-acquisition/customer-results.tsx", "components/ai-acquisition/task-detail.tsx",
  "components/ai-acquisition/task-report.tsx", "components/ai-acquisition/task-center.tsx",
]) {
  assert.match(read(path), /import \{ CountryLabel \} from "@\/components\/country-label"/, `${path} 应复用统一国家标签`);
  assert.match(read(path), /<CountryLabel\b[^>]*\bvalue=/, `${path} 应使用统一国家显示`);
}
assert.doesNotMatch(read("components/followups-view.tsx"), /\{item\.customer\?\.country\|\|/, "跟进列表不得直接显示国家原始代码");
assert.doesNotMatch(read("components/crm-dashboard.tsx"), /function CountryLabel|function CountryFlag/, "工作台不得维护另一套国家展示组件");
console.log("country display regression tests passed");
