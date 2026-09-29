export type GoogleProfileConsistencyInput = {
  name?: string;
  description?: string;
  reviews?: string[];
  types?: string[];
};

const CLEAR_NON_TARGET_CURRENT_NAME = /(?:\bbarber\b|hair\s*(?:salon|studio|dresser|dressing)|beauty\s*(?:salon|studio)|\brestaurant\b|\bcafe\b|\bfoods?\b|fresh produce|fruit|vegetable|recycl|waste|removal|clearance|camera|film lab|pharmacy|chemist|tobacco|vape|auto(?:motive)?|motor|vehicle|tyre|房地产|餐厅|咖啡|食品|果蔬|回收|废品|清运|相机|胶片|药房|烟草|电子烟|汽车|轮胎|理发|美发|美容|حلاق|حلاقة|للحلاقة|صالون)/iu;
const TARGET_DEVICE_ACTIVITY = /(?:(?:phone|mobile|smartphone|cell ?phone|iphone|ipad|computer|pc|laptop|notebook|macbook|gadget|手机|电脑|笔记本|平板)[\s\S]{0,100}(?:repair|fix|replacement|parts?|accessor|wholesale|distribut|维修|修理|更换|配件|批发|分销)|(?:repair|fix|replacement|parts?|accessor|wholesale|distribut|维修|修理|更换|配件|批发|分销)[\s\S]{0,100}(?:phone|mobile|smartphone|cell ?phone|iphone|ipad|computer|pc|laptop|notebook|macbook|gadget|手机|电脑|笔记本|平板))/iu;

/**
 * Detect a likely renamed/replaced Google listing: the current merchant name
 * clearly describes an unrelated sector while the inherited description or
 * reviews describe a phone/computer business. Such history is evidence of a
 * conflict, never proof of the current company's industry.
 */
export function googleProfileHasTemporalBusinessConflict(profile?: GoogleProfileConsistencyInput | null) {
  if (!profile) return false;
  const currentName = String(profile.name || "").normalize("NFKC");
  const operatingText = [profile.description, ...(profile.reviews || []), ...(profile.types || []).map((value) => String(value).replace(/_/g, " "))]
    .filter(Boolean).join(" ").normalize("NFKC");
  // A mixed merchant can advertise both sectors in its *current* name (for
  // example "Vape Hub - Phone & Laptop Repair"). That is not evidence of a
  // renamed Google listing. Preserve the conflict only when device activity
  // appears in the older description/reviews but not in the current name.
  return CLEAR_NON_TARGET_CURRENT_NAME.test(currentName)
    && !TARGET_DEVICE_ACTIVITY.test(currentName)
    && TARGET_DEVICE_ACTIVITY.test(operatingText);
}
