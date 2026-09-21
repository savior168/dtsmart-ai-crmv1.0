export type AcquisitionGateInput = {
  automationStatus?: string | null;
  targetDecision?: string | null;
  score?: number | null;
  identityStatus?: string | null;
  evidenceUrls: Array<{ source_url?: string | null; evidence_strength?: string | null }>;
  contacts: Array<{ type?: string | null; value_normalized?: string | null; verification_status?: string | null; identity_match_status?: string | null; contact_status?: string | null; exact_source_url?: string | null }>;
};

export function evaluateAcquisitionGate(input: AcquisitionGateInput) {
  const hasTraceableBusinessEvidence = input.evidenceUrls.some((row) => /^https?:\/\//i.test(String(row.source_url || "")) && String(row.evidence_strength || "") !== "WEAK_HINT");
  const actionableContacts = input.contacts.filter((contact) =>
    ["PHONE", "EMAIL", "WHATSAPP"].includes(String(contact.type)) &&
    ["NEW_VERIFIED", "SOURCE_CONFIRMED", "MATCHED_ORIGINAL"].includes(String(contact.verification_status)) &&
    ["MATCHED", "LIKELY_MATCHED"].includes(String(contact.identity_match_status)) &&
    !["SHARED_CORPORATE", "SHARED_ACROSS_CUSTOMERS"].includes(String(contact.contact_status || "")) &&
    /^https?:\/\//i.test(String(contact.exact_source_url || "")),
  );
  const identityMatched = ["MATCHED", "LIKELY_MATCHED"].includes(String(input.identityStatus || ""));
  const verifiedTarget = input.automationStatus === "AUTO_DEVELOP" && input.targetDecision === "VALID" &&
    Number(input.score || 0) >= 60 && identityMatched && hasTraceableBusinessEvidence;
  const evidenceComplete = input.targetDecision !== "REVIEW" && identityMatched && hasTraceableBusinessEvidence;
  const accepted = verifiedTarget && actionableContacts.length > 0;
  return { accepted, verifiedTarget, evidenceComplete, hasTraceableBusinessEvidence, actionableContacts };
}
