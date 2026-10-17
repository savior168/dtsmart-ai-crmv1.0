export type ImportedCustomerStage = "CLAIMED" | "FOLLOWING" | "DEAL";

const stageByLabel: Record<string, ImportedCustomerStage> = {
  潜在客户: "CLAIMED",
  意向客户: "FOLLOWING",
  已成交客户: "DEAL",
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function importedCustomerStage(label: unknown, destination: "PRIVATE" | "PUBLIC_POOL", phone: unknown, email: unknown) {
  const selected = text(label);
  if (destination === "PUBLIC_POOL") {
    if (selected) throw new Error("客户公海不能预设我的客户阶段");
    return "UNCLAIMED" as const;
  }
  if (selected && !Object.hasOwn(stageByLabel, selected)) {
    throw new Error("客户阶段只能填写潜在客户、意向客户或已成交客户");
  }
  const stage = selected ? stageByLabel[selected] : "CLAIMED";
  if (stage !== "CLAIMED" && (!text(phone) || !text(email))) {
    throw new Error("意向客户和已成交客户必须同时填写联系电话和邮箱");
  }
  return stage;
}

export function importedCustomerGrade(value: unknown, destination: "PRIVATE" | "PUBLIC_POOL") {
  const grade = text(value).toUpperCase();
  if (!grade) return null;
  if (destination === "PUBLIC_POOL") throw new Error("客户公海不能预设销售客户等级");
  if (!["S", "A", "B", "C", "D"].includes(grade)) {
    throw new Error("客户等级只能填写 S、A、B、C、D");
  }
  return grade as "S" | "A" | "B" | "C" | "D";
}
