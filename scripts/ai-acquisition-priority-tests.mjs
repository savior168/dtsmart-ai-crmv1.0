import assert from "node:assert/strict";
import { prioritizeDiscoveryCandidates } from "../lib/ai-acquisition/relevance.ts";

const candidate = (placeId, companyName, types = ["establishment"]) => ({
  placeId, companyName, businessStatus: "OPERATIONAL", types,
  matchedTerms: ["mobile phone repair in Germany"],
});
const returned = [
  candidate("unrelated-1", "Berlin Coffee House"),
  candidate("repair-1", "Berlin Phone Repair"),
  candidate("unrelated-2", "Berlin Barber", ["hair_salon"]),
  candidate("repair-2", "Munich Mobile Repair"),
  candidate("unrelated-3", "Berlin Restaurant", ["restaurant"]),
];
const rank = (limit) => prioritizeDiscoveryCandidates(returned, ["手机维修店"], ["mobile phone repair"], limit).map(({ placeId }) => placeId);
assert.deepEqual(rank(2), ["repair-1", "repair-2"], "无关结果不得挤占同批已取得的相关候选名额");
assert.deepEqual(rank(4), ["repair-1", "repair-2", "unrelated-1", "unrelated-2"], "不足名额仍保留原始顺序的其他候选供审计");
assert.deepEqual(returned.map(({ placeId }) => placeId), ["unrelated-1", "repair-1", "unrelated-2", "repair-2", "unrelated-3"], "排序不得修改已保存的发现检查点结果");
console.log("AI acquisition discovery priority tests passed");
