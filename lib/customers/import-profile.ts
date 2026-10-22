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
  const grade = text(value).toUpperCase();
  if (!grade) return null;
  if (!["S", "A", "B", "C", "D"].includes(grade)) {
    throw new Error("客户等级只能填写 S、A、B、C、D");
  }
  return grade as "S" | "A" | "B" | "C" | "D";
}
