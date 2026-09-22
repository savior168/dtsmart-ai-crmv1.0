const TRADE_ROLE_PATTERN = /(?:批发|分销|经销|进口(?:商)?|代理商|渠道供货|批量供货|wholesal(?:e|er)|distribut(?:or|ion)|importer|dealer|reseller|supplier|\bb2b\b|\bmoq\b|bulk (?:orders?|prices?)|trade accounts?)/i;
const TARGET_DEVICE_PATTERN = /(?:手机|智能手机|平板|电脑|笔记本|苹果设备|phone|mobile|smartphone|iphone|ipad|tablet|computer|laptop|notebook|macbook|\bpc\b)/i;
const REPAIR_PART_PATTERN = /(?:维修(?:内)?配件|内配件|维修备件|replacement parts?|repair parts?|spare parts?|lcd|oled|digitizer|screen (?:assembl(?:y|ies)|replacement)|replacement screens?|display assembl(?:y|ies)|replacement batter(?:y|ies)|internal batter(?:y|ies)|charging port|charge port|充电口|尾插|排线|flex cable|摄像头模组|camera module|主板|逻辑板|motherboard|mainboard|logic board|replacement keyboards?|键盘更换|触控板|trackpad|听筒|扬声器|麦克风|马达|维修工具|维修耗材)/i;
const REPAIR_BUSINESS_PATTERN = /(?:手机|智能手机|平板|电脑|笔记本|苹果设备|phone|mobile|smartphone|iphone|ipad|tablet|computer|laptop|notebook|macbook|\bpc\b)[\s\S]{0,80}(?:维修|检修|换屏|换电池|repair|screen replacement|battery replacement|charging port replacement|motherboard repair)|(?:维修|检修|换屏|换电池|repair|screen replacement|battery replacement|charging port replacement|motherboard repair)[\s\S]{0,80}(?:手机|智能手机|平板|电脑|笔记本|苹果设备|phone|mobile|smartphone|iphone|ipad|tablet|computer|laptop|notebook|macbook|\bpc\b)/i;
const ACCESSORY_BATTERY_PATTERN = /(?:手机|智能手机|平板|电脑|笔记本|苹果设备|phone|mobile|smartphone|iphone|ipad|tablet|computer|laptop|notebook|macbook|\bpc\b)[\s\S]{0,80}(?:配件|电池|accessor(?:y|ies)|batter(?:y|ies))|(?:配件|电池|accessor(?:y|ies)|batter(?:y|ies))[\s\S]{0,80}(?:手机|智能手机|平板|电脑|笔记本|苹果设备|phone|mobile|smartphone|iphone|ipad|tablet|computer|laptop|notebook|macbook|\bpc\b)/i;
const EXPLICIT_TARGET_TRADE_PATTERN = /(?:手机|平板|电脑|笔记本|苹果设备|phone|mobile|smartphone|iphone|ipad|tablet|computer|laptop|notebook|macbook|\bpc\b)[\s\S]{0,100}(?:维修(?:内)?配件|内配件|维修备件|replacement parts?|repair parts?|spare parts?|lcd|oled|digitizer|screen (?:assembl(?:y|ies)|replacement)|replacement screens?|display assembl(?:y|ies)|replacement batter(?:y|ies)|internal batter(?:y|ies)|charging port|charge port|充电口|尾插|排线|flex cable|摄像头模组|camera module|主板|逻辑板|motherboard|mainboard|logic board|replacement keyboards?|键盘更换|触控板|trackpad|听筒|扬声器|麦克风|马达|维修工具|维修耗材)|(?:维修(?:内)?配件|内配件|维修备件|replacement parts?|repair parts?|spare parts?|lcd|oled|digitizer|screen (?:assembl(?:y|ies)|replacement)|replacement screens?|display assembl(?:y|ies)|replacement batter(?:y|ies)|internal batter(?:y|ies)|charging port|charge port|充电口|尾插|排线|flex cable|摄像头模组|camera module|主板|逻辑板|motherboard|mainboard|logic board|replacement keyboards?|键盘更换|触控板|trackpad|听筒|扬声器|麦克风|马达|维修工具|维修耗材)[\s\S]{0,100}(?:手机|平板|电脑|笔记本|苹果设备|phone|mobile|smartphone|iphone|ipad|tablet|computer|laptop|notebook|macbook|\bpc\b)/i;
const UNRELATED_TRADE_SECTOR_PATTERN = /(?:汽车|机动车|卡车|巴士|公交|车身|轮胎|制动|离合器|car parts?|auto parts?|automotive|vehicle parts?|truck parts?|motor factors?|食品|果蔬|水果|蔬菜|餐饮|food wholesal|food distributor|fresh produce|烟草|电子烟|水烟|tobacco|vape|shisha|电气设备|电器用品|照明|太阳能设备|配电箱|保险丝盒|electrical (?:equipment|suppl)|lighting wholesal|solar equipment|培训中心|招聘|training cent(?:er|re)|recruitment|废品回收|电子废弃物|电脑回收|recycling|e-?waste|IT asset disposal)/i;

/** @param {Array<string | null | undefined>} facts */
export function hasPhoneComputerRepairPartsTradeEvidence(facts) {
  const normalized = facts.map((fact) => String(fact || "").trim()).filter(Boolean).filter((fact) => {
    const denied = /(?:未发现|未取得|未能取得|没有发现|无可核验|未显示|不能证明|does not (?:show|provide)|did not find|no (?:verified |clear )?)/i.test(fact);
    return !(denied && (TRADE_ROLE_PATTERN.test(fact) || TARGET_DEVICE_PATTERN.test(fact) || REPAIR_PART_PATTERN.test(fact)));
  });
  const directRepairPartsTrade = normalized.some((fact) => TRADE_ROLE_PATTERN.test(fact)
    && (EXPLICIT_TARGET_TRADE_PATTERN.test(fact)
      || (TARGET_DEVICE_PATTERN.test(fact) && REPAIR_PART_PATTERN.test(fact))));
  // A verified repair business is itself a real consumer of replacement
  // batteries and accessories. Allow that customer when a second saved fact
  // also proves a trade/wholesale offer for the relevant devices. Neither a
  // search keyword nor the business name is accepted as either half.
  const verifiedRepairWithRelevantTrade = normalized.some((fact) => REPAIR_BUSINESS_PATTERN.test(fact))
    && normalized.some((fact) => TRADE_ROLE_PATTERN.test(fact) && ACCESSORY_BATTERY_PATTERN.test(fact));
  if (!directRepairPartsTrade && !verifiedRepairWithRelevantTrade) return false;
  return !UNRELATED_TRADE_SECTOR_PATTERN.test(normalized.join("；"));
}

/** @param {string} text */
export function hasPhoneComputerRepairPartsProductEvidence(text) {
  return EXPLICIT_TARGET_TRADE_PATTERN.test(String(text || ""));
}
