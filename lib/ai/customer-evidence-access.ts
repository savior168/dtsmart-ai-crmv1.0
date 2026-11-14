export function canReadCustomerAiEvidence(input: {
  viewerId: string;
  viewerRole: string;
  customerOwnerId: string | null;
  isAuthorizedSubordinate: boolean;
  canViewCustomerEvidence: boolean;
  canViewAiResults: boolean;
}) {
  // A grant never widens the customer's record scope: only the owner, an
  // authorized supervisor in the manager chain, or an administrator may read it.
  const inScope = input.viewerRole === "ADMIN"
    || input.customerOwnerId === input.viewerId || (input.viewerRole === "SUPERVISOR" && input.isAuthorizedSubordinate);
  return inScope && (input.canViewCustomerEvidence || input.canViewAiResults);
}

const CUSTOMER_RESULT_KEYS = [
  "id", "customer_id", "strategy", "strategy_version", "score", "grade", "target_decision",
  "industry_type", "summary", "ai_reason", "decision_status", "business_scope", "company_scale",
  "company_scale_evidence", "business_relevance", "customer_value", "followup_suggestion",
  "confidence_score", "evidence_sufficiency", "analyzed_channels", "evidence_conflicts",
  "early_stop_reason", "completed_at", "score_breakdown", "suggested_contact_order",
  "preferred_contact_value", "model_version", "rule_version", "field_mapping_version",
] as const;

export function presentCustomerAiEvidenceResult<T extends Record<string, unknown>>(result: T | null, platformAdmin: boolean) {
  if (!result || platformAdmin) return result;
  return Object.fromEntries(CUSTOMER_RESULT_KEYS.map((key) => [key, result[key]]));
}
