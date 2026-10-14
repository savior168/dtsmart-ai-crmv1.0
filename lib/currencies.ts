export const QUOTE_CURRENCIES = [
  ["USD", "美元"], ["EUR", "欧元"], ["GBP", "英镑"], ["CNY", "人民币"],
  ["HKD", "港币"], ["JPY", "日元"], ["KRW", "韩元"], ["TWD", "新台币"],
  ["SGD", "新加坡元"], ["MYR", "马来西亚林吉特"], ["THB", "泰铢"], ["VND", "越南盾"],
  ["PHP", "菲律宾比索"], ["IDR", "印度尼西亚盾"], ["INR", "印度卢比"],
  ["AUD", "澳大利亚元"], ["NZD", "新西兰元"], ["CAD", "加拿大元"], ["CHF", "瑞士法郎"],
  ["AED", "阿联酋迪拉姆"], ["SAR", "沙特里亚尔"], ["QAR", "卡塔尔里亚尔"],
  ["KWD", "科威特第纳尔"], ["BHD", "巴林第纳尔"], ["OMR", "阿曼里亚尔"],
  ["PLN", "波兰兹罗提"], ["CZK", "捷克克朗"], ["HUF", "匈牙利福林"],
  ["RON", "罗马尼亚列伊"], ["BGN", "保加利亚列弗"], ["SEK", "瑞典克朗"],
  ["NOK", "挪威克朗"], ["DKK", "丹麦克朗"], ["TRY", "土耳其里拉"], ["ILS", "以色列新谢克尔"],
  ["ZAR", "南非兰特"], ["NGN", "尼日利亚奈拉"], ["MXN", "墨西哥比索"], ["BRL", "巴西雷亚尔"],
  ["ARS", "阿根廷比索"], ["CLP", "智利比索"], ["COP", "哥伦比亚比索"], ["PEN", "秘鲁索尔"],
] as const;

export const QUOTE_CURRENCY_CODES: ReadonlySet<string> = new Set(QUOTE_CURRENCIES.map(([code]) => code));
