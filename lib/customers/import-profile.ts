
import { CUSTOMER_GRADE_OPTIONS, normalizeCustomerGrade } from "@/lib/customers/customer-grade";

export type ImportedCustomerStage = "CLAIMED" | "FOLLOWING" | "DEAL";

const stageByLabel: Record<string, ImportedCustomerStage> = {
  潜在客户: "CLAIMED",
  意向客户: "FOLLOWING",
  已成交客户: "DEAL",
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function importedCustomerStage(label: unknown, destination: "PRIVATE" | "PUBLIC_POOL") {
  const selected = text(label);
  if (destination === "PUBLIC_POOL") {
    if (selected && !Object.hasOwn(stageByLabel, selected)) {
      throw new Error("客户阶段只能填写潜在客户、意向客户或已成交客户");
    }
    return "UNCLAIMED" as const;
  }
  if (selected && !Object.hasOwn(stageByLabel, selected)) {
    throw new Error("客户阶段只能填写潜在客户、意向客户或已成交客户");
  }
  return selected ? stageByLabel[selected] : "CLAIMED";
}

export function importedCustomerGrade(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const grade = normalizeCustomerGrade(raw);
  if (!grade) {
    throw new Error(`客户等级只能填写 ${CUSTOMER_GRADE_OPTIONS.join("、")}`);
  }
  return grade;
}
