import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateAcquisitionGate } from "../lib/ai-acquisition/quality-gate.ts";

const base={automationStatus:"AUTO_DEVELOP",targetDecision:"VALID",score:82,identityStatus:"MATCHED",evidenceUrls:[{source_url:"https://example.com/services",evidence_strength:"STRONG"}],contacts:[{type:"EMAIL",value_normalized:"sales@example.com",verification_status:"SOURCE_CONFIRMED",exact_source_url:"https://example.com/contact"}]};
assert.equal(evaluateAcquisitionGate(base).accepted,true,"完整强证据和可追溯联系方式应允许入池");
assert.equal(evaluateAcquisitionGate({...base,targetDecision:"INVALID"}).accepted,false,"非目标不得入池");
assert.equal(evaluateAcquisitionGate({...base,identityStatus:"CONFLICT"}).accepted,false,"主体冲突不得入池");
assert.equal(evaluateAcquisitionGate({...base,evidenceUrls:[{source_url:"https://example.com",evidence_strength:"WEAK_HINT"}]}).accepted,false,"弱提示不能替代经营证据");
assert.equal(evaluateAcquisitionGate({...base,contacts:[{type:"PHONE",verification_status:"SOURCE_CONFIRMED",exact_source_url:null}]}).accepted,false,"联系方式无具体来源页面不得入池");

const migration=fs.readFileSync(new URL("../supabase/migrations/202609150004_ai_acquisition_core.sql",import.meta.url),"utf8");
assert.match(migration,/AI_STAGING/);
assert.match(migration,/claim_stalled_ai_acquisition_tasks/);
assert.match(migration,/revoke all on public\.ai_acquisition_tasks/);
const workflow=fs.readFileSync(new URL("../workflows/ai-acquisition.ts",import.meta.url),"utf8");
assert.match(workflow,/CLOSED_PERMANENTLY/);
assert.match(workflow,/Google Place ID已存在/);
assert.match(workflow,/evaluateAcquisitionGate/);
assert.match(workflow,/pause_started_at/);
const config=fs.readFileSync(new URL("../lib/ai-acquisition/config.ts",import.meta.url),"utf8");
assert.doesNotMatch(config,/"CN"/);
assert.match(config,/Handyreparatur/);
assert.match(config,/reparação de telemóveis/);
const create=fs.readFileSync(new URL("../components/ai-acquisition/create-view.tsx",import.meta.url),"utf8");
assert.match(create,/全免费获客/);
assert.match(create,/智能增强获客/);
console.log("AI acquisition regression tests passed");
