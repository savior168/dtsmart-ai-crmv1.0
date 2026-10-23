export const CUSTOMER_GRADE_OPTIONS = ["S", "KA", "MA", "A", "B", "C", "D"] as const;

export type CustomerGrade = (typeof CUSTOMER_GRADE_OPTIONS)[number];

export const CUSTOMER_GRADE_DESCRIPTIONS: Record<CustomerGrade, string> = {
  S: "业绩 ≥ $50,000 USD",
  KA: "$30,000 ≤ 业绩 < $50,000 USD",
  MA: "$10,000 ≤ 业绩 < $30,000 USD",
  A: "$8,000 ≤ 业绩 < $10,000 USD",
  B: "$5,000 ≤ 业绩 < $8,000 USD",
  C: "$2,000 ≤ 业绩 < $5,000 USD",
  D: "业绩 < $2,000 USD",
};

export function normalizeCustomerGrade(value: unknown): CustomerGrade | null {
  const grade = String(value ?? "").trim().toUpperCase();
  return CUSTOMER_GRADE_OPTIONS.find((option) => option === grade) ?? null;
}

export function isCustomerGrade(value: unknown): value is CustomerGrade {
  const grade = String(value ?? "").trim();
  return CUSTOMER_GRADE_OPTIONS.some((option) => option === grade);
}

export function customerGradeDescription(value: unknown): string {
  const grade = normalizeCustomerGrade(value);
  return grade ? CUSTOMER_GRADE_DESCRIPTIONS[grade] : "";
}
