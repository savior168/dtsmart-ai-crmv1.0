const chinese = /[\u3400-\u9fff]/u;

/** Customer documents never silently expose untranslated internal Chinese. */
export function containsChinese(value: string | null | undefined): boolean {
  return chinese.test(value || "");
}

const exactSuggestions: Record<string, string> = {
  "带框": "With frame",
  "无框": "Without frame",
  "全新": "Brand new",
  "原装": "Original",
  "拆机": "Pulled from device",
  "新拆机": "Pulled from new device",
  "带框拆机": "Pulled from device, with frame",
  "测试正常": "Tested and working",
};

export function suggestCustomerEnglish(value: string): string {
  return exactSuggestions[value.trim()] || "";
}

export function customerEnglish(value: string | null | undefined, reviewedEnglish: string | null | undefined, label: string): string {
  const source = (value || "").trim();
  const reviewed = (reviewedEnglish || "").trim();
  if (reviewed && !containsChinese(reviewed)) return reviewed;
  if (!containsChinese(source)) return source;
  throw new Error(`${label}包含中文，请先由销售员核对并填写英文客户用语`);
}

export function needsCustomerEnglishReview(items: Array<{ quality: string | null; quality_en: string | null; description: string | null; description_en: string | null }>): boolean {
  return items.some((item) => (containsChinese(item.quality) && (!item.quality_en?.trim() || containsChinese(item.quality_en))) ||
    (containsChinese(item.description) && (!item.description_en?.trim() || containsChinese(item.description_en))));
}
