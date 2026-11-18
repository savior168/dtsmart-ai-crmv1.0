
import { CUSTOMER_GRADE_OPTIONS, normalizeCustomerGrade } from "@/lib/customers/customer-grade";

export type ImportedCustomerStage = "CLAIMED";

const stageByLabel: Record<string, ImportedCustomerStage> = {
  潜在客户: "CLAIMED",
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function importedCustomerStage(label: unknown, destination: "PRIVATE" | "PUBLIC_POOL") {
  const selected = text(label);
  if (destination === "PUBLIC_POOL") {
    return "UNCLAIMED" as const;
  }
  if (selected && !Object.hasOwn(stageByLabel, selected)) {
    throw new Error("批量导入仅支持潜在客户；意向或已成交客户请导入后逐个提交真实凭证完成阶段变更");
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
