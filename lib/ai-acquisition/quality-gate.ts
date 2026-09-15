export type AcquisitionGateInput = {
  automationStatus?: string | null;
  targetDecision?: string | null;
  score?: number | null;
  identityStatus?: string | null;
  evidenceUrls: Array<{ source_url?: string | null; evidence_strength?: string | null }>;
  contacts: Array<{ type?: string | null; value_normalized?: string | null; verification_status?: string | null; exact_source_url?: string | null }>;
};

export function evaluateAcquisitionGate(input: AcquisitionGateInput) {
  const evidenceComplete = input.evidenceUrls.some((row) => /^https?:\/\//i.test(String(row.source_url || "")) && String(row.evidence_strength || "") !== "WEAK_HINT");
  const actionableContacts = input.contacts.filter((contact) =>
    ["PHONE", "EMAIL", "WHATSAPP"].includes(String(contact.type)) &&
    ["SOURCE_CONFIRMED", "MATCHED_ORIGINAL"].includes(String(contact.verification_status)) &&
    /^https?:\/\//i.test(String(contact.exact_source_url || "")),
  );
  const accepted = input.automationStatus === "AUTO_DEVELOP" && input.targetDecision === "VALID" &&
    Number(input.score || 0) >= 60 && input.identityStatus !== "CONFLICT" && evidenceComplete && actionableContacts.length > 0;
  return { accepted, evidenceComplete, actionableContacts };
}
