import { createRequire } from "node:module";

const XLSX = createRequire(import.meta.url)("xlsx") as typeof import("xlsx");

export type PiTemplateSeller = {
  id: string;
  name: string;
  email: string;
  business_phone: string;
  business_email: string;
};

export type PiTemplateCustomer = {
  id?: string;
  owner_id: string;
  company_name: string;
  contact_name: string;
  phone: string;
  tax_number: string;
  email: string;
  address: string;
};

export type PiTemplateOptions = {
  now?: Date;
  seller?: PiTemplateSeller;
  sellers: PiTemplateSeller[];
  customers: PiTemplateCustomer[];
  allowSellerSelection: boolean;
};

const FIRST_LOOKUP_ROW = 42;
const SELLER_COLUMNS = ["P", "Q", "R", "S", "T"] as const;
const CUSTOMER_COLUMNS = ["U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC"] as const;
const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function colNumber(column: string) {
  return [...column].reduce((result, character) => result * 26 + character.charCodeAt(0) - 64, 0);
}

function xmlCell(address: string, value: string) {
  return `<x:c r="${address}" t="str"><x:v>${xmlEscape(value)}</x:v></x:c>`;
}

function xmlFormulaCell(address: string, formula: string) {
  return `<x:c r="${address}" t="str"><x:f>${xmlEscape(formula)}</x:f><x:v></x:v></x:c>`;
}

function appendCellToRow(xml: string, address: string, cell: string) {
  const row = Number(address.match(/\d+$/)?.[0]);
  const rowPattern = new RegExp(`(<x:row\\b[^>]*\\br="${row}"[^>]*>)([\\s\\S]*?)(<\\/x:row>)`);
  return xml.replace(rowPattern, (_match, opening: string, body: string, closing: string) => `${opening}${body}${cell}${closing}`);
}

function setCell(xml: string, address: string, value: string | number) {
  const escapedAddress = address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<x:c\\b([^>]*\\br="${escapedAddress}"[^>]*)>([\\s\\S]*?)<\\/x:c>`);
  const cell = typeof value === "number" ? `<x:c r="${address}" t="n"><x:v>${value}</x:v></x:c>` : xmlCell(address, value);
  if (!pattern.test(xml)) return appendCellToRow(xml, address, cell);
  return xml.replace(pattern, (_match, attributes: string) => {
    const style = attributes.match(/\ss="(\d+)"/)?.[0] || "";
    return cell.replace(`r="${address}"`, `r="${address}"${style}`);
  });
}

function setFormula(xml: string, address: string, formula: string) {
  const escapedAddress = address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<x:c\\b([^>]*\\br="${escapedAddress}"[^>]*)>([\\s\\S]*?)<\\/x:c>`);
  if (!pattern.test(xml)) return appendCellToRow(xml, address, xmlFormulaCell(address, formula));
  return xml.replace(pattern, (_match, attributes: string) => {
    const style = attributes.match(/\ss="(\d+)"/)?.[0] || "";
    return xmlFormulaCell(address, formula).replace(`r="${address}"`, `r="${address}"${style}`);
  });
}

function appendHiddenRows(xml: string, sellers: PiTemplateSeller[], customers: PiTemplateCustomer[]) {
  const rowCount = Math.max(sellers.length, customers.length, 1);
  const endRow = FIRST_LOOKUP_ROW + rowCount - 1;
  let rows = "";
  for (let index = 0; index < rowCount; index += 1) {
    const rowNumber = FIRST_LOOKUP_ROW + index;
    const cells: string[] = [];
    const seller = sellers[index];
    if (seller) {
      cells.push(xmlCell(`${SELLER_COLUMNS[0]}${rowNumber}`, `Sales Manager: ${seller.name}`));
      cells.push(xmlCell(`${SELLER_COLUMNS[1]}${rowNumber}`, seller.id));
      cells.push(xmlCell(`${SELLER_COLUMNS[2]}${rowNumber}`, seller.business_phone));
      cells.push(xmlCell(`${SELLER_COLUMNS[3]}${rowNumber}`, seller.business_email));
      cells.push(xmlCell(`${SELLER_COLUMNS[4]}${rowNumber}`, seller.email));
    }
    const customer = customers[index];
    if (customer) {
      const company = customer.company_name.trim();
      const choice = `Company: ${company} · ${customer.contact_name || "未填写联系人"} · ${customer.phone || "未填写电话"}${customer.id ? ` · ${customer.id.slice(0, 6)}` : ""}`;
      cells.push(xmlCell(`${CUSTOMER_COLUMNS[0]}${rowNumber}`, `${customer.owner_id}|${choice}`));
      cells.push(xmlCell(`${CUSTOMER_COLUMNS[1]}${rowNumber}`, customer.owner_id));
      cells.push(xmlCell(`${CUSTOMER_COLUMNS[2]}${rowNumber}`, choice));
      cells.push(xmlCell(`${CUSTOMER_COLUMNS[3]}${rowNumber}`, company));
      cells.push(xmlCell(`${CUSTOMER_COLUMNS[4]}${rowNumber}`, customer.tax_number));
      cells.push(xmlCell(`${CUSTOMER_COLUMNS[5]}${rowNumber}`, customer.contact_name));
      cells.push(xmlCell(`${CUSTOMER_COLUMNS[6]}${rowNumber}`, customer.phone));
      cells.push(xmlCell(`${CUSTOMER_COLUMNS[7]}${rowNumber}`, customer.email));
      cells.push(xmlCell(`${CUSTOMER_COLUMNS[8]}${rowNumber}`, customer.address));
    }
    cells.sort((left, right) => colNumber(left.match(/r="([A-Z]+)/)?.[1] || "A") - colNumber(right.match(/r="([A-Z]+)/)?.[1] || "A"));
    rows += `<x:row r="${rowNumber}" hidden="1" ht="0" customHeight="1">${cells.join("")}</x:row>`;
  }
  const withRows = xml.replace("</x:sheetData>", `${rows}</x:sheetData>`);
  const dimension = withRows.replace(/(<x:dimension ref="A1:)[A-Z]+\d+("\s*\/>)/, `$1AC${endRow}$2`);
  return dimension === withRows
    ? withRows.replace(/(<x:worksheet\b[^>]*>)/, `$1<x:dimension ref="A1:AC${endRow}" />`)
    : dimension;
}

function addHiddenColumns(xml: string) {
  return xml.replace("</x:cols>", `<x:col min="15" max="29" width="0" hidden="1" customWidth="1" /></x:cols>`);
}

function addValidations(xml: string, validationXml: string[], count: number) {
  const current = new RegExp(`<x:dataValidations\\b[^>]*count="(\\d+)"[^>]*>([\\s\\S]*?)<\\/x:dataValidations>`);
  if (current.test(xml)) {
    return xml.replace(current, (_match, previousCount: string, body: string) =>
      `<x:dataValidations count="${Number(previousCount) + count}">${body}${validationXml.join("")}</x:dataValidations>`);
  }
  return xml.replace("<x:pageMargins", `<x:dataValidations count="${count}">${validationXml.join("")}</x:dataValidations><x:pageMargins`);
}

function addConditionalFormatting(xml: string) {
  const rule = `<x:conditionalFormatting sqref="G33:M33"><x:cfRule type="expression" dxfId="0" priority="1"><x:formula>$K$9&lt;&gt;&quot;PayPal&quot;</x:formula></x:cfRule></x:conditionalFormatting>`;
  if (/<x:conditionalFormatting\b/.test(xml)) throw new Error("PI模板手续费条件格式已存在，无法安全叠加");
  return xml.replace(/<x:dataValidations\b/, `${rule}<x:dataValidations`);
}

function removePaymentChannelValidation(xml: string) {
  return xml.replace(/<x:dataValidations\b[^>]*count="(\d+)"([^>]*)>([\s\S]*?)<\/x:dataValidations>/, (_match, count: string, attributes: string, body: string) => {
    const nextBody = body.replace(/<x:dataValidation\b(?=[^>]*sqref="K9")[^>]*>[\s\S]*?<\/x:dataValidation>/, "");
    const nextCount = Number(count) - (nextBody === body ? 0 : 1);
    return `<x:dataValidations count="${nextCount}"${attributes}>${nextBody}</x:dataValidations>`;
  });
}

function hideRows(xml: string, start: number, end: number) {
  for (let row = start; row <= end; row += 1) {
    const pattern = new RegExp(`(<x:row\\b[^>]*\\br="${row}"[^>]*)(>)`);
    if (!pattern.test(xml)) continue;
    xml = xml.replace(pattern, (_match, opening: string, closing: string) => {
      const withoutHeight = opening.replace(/\s+(?:ht|customHeight|hidden)="[^"]*"/g, "");
      return `${withoutHeight} ht="0" customHeight="1" hidden="1"${closing}`;
    });
  }
  return xml;
}

function addHiddenPayPalFeeStyle(xml: string) {
  const existing = xml.match(/<x:dxfs\b[^>]*count="(\d+)"[^>]*>([\s\S]*?)<\/x:dxfs>/);
  if (existing) {
    const count = Number(existing[1]);
    const dxfs = existing[2] + `<x:dxf><x:font><x:color rgb="FFFFFFFF" /></x:font></x:dxf>`;
    return xml.replace(existing[0], `<x:dxfs count="${count + 1}">${dxfs}</x:dxfs>`);
  }
  return xml.replace("</x:styleSheet>", `<x:dxfs count="1"><x:dxf><x:font><x:color rgb="FFFFFFFF" /></x:font></x:dxf></x:dxfs></x:styleSheet>`);
}

function excelDateSerial(date: Date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return Math.floor(day.getTime() / 86_400_000) + 25569;
}

function shanghaiDatePlusFive(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return new Date(Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day")) + 5));
}

/** Personalize the editable invoice-layout template while preserving its original OOXML parts and company logo. */
export function buildPiImportTemplate(templateBytes: Uint8Array, options: PiTemplateOptions) {
  const sellers = options.sellers.filter((seller) => seller.id && seller.email).map((seller) => ({
    ...seller,
    name: seller.name.trim(),
    business_phone: seller.business_phone.trim(),
    business_email: seller.business_email.trim(),
    email: seller.email.trim().toLowerCase(),
  }));
  const customers = options.customers.filter((customer) => customer.owner_id && customer.company_name.trim()).map((customer) => ({
    ...customer,
    company_name: customer.company_name.trim(),
    contact_name: customer.contact_name.trim(),
    phone: customer.phone.trim(),
    tax_number: customer.tax_number.trim(),
    email: customer.email.trim(),
    address: customer.address.trim(),
  })).sort((left, right) => left.owner_id.localeCompare(right.owner_id) || left.company_name.localeCompare(right.company_name));
  const selectedSeller = options.seller && sellers.find((seller) => seller.id === options.seller?.id);
  if (options.seller && !selectedSeller) throw new Error("PI导入模板所属销售员无效或未启用");
  const archive = XLSX.CFB.read(Buffer.from(templateBytes), { type: "buffer" });
  const worksheet = XLSX.CFB.find(archive, "/xl/worksheets/sheet1.xml");
  const workbookPart = XLSX.CFB.find(archive, "/xl/workbook.xml");
  if (!worksheet || !workbookPart) throw new Error("PI导入模板文件结构不正确");
  let xml = Buffer.from(worksheet.content).toString("utf8");
  xml = addHiddenColumns(xml);
  xml = appendHiddenRows(xml, sellers, customers);
  // Keep the PayPal row editable, but visually blank unless PayPal is selected.
  xml = setFormula(xml, "G33", `IF($K$9="PayPal","PAYPAL FEE ("&IF(K33="",5,K33)&"%):","")`);
  xml = setFormula(xml, "L33", `IF($K$9="PayPal",IFERROR(ROUND((L28+IF(K29="CNY",IF(L29="",0,L29),IF(K29="外币",IF(M29="",0,ROUND(M29*$K$7,2)),0))+IF(K30="CNY",IF(L30="",0,L30),IF(K30="外币",IF(M30="",0,ROUND(M30*$K$7,2)),0))+IF(K31="CNY",IF(L31="",0,L31),IF(K31="外币",IF(M31="",0,ROUND(M31*$K$7,2)),0))-IF(K32="CNY",IF(L32="",0,L32),IF(K32="外币",IF(M32="",0,ROUND(M32*$K$7,2)),0)))*IF(K33="",5,K33)/100,2),""),"")`);
  xml = setFormula(xml, "M33", `IF($K$9="PayPal",IFERROR(ROUND((M28+IF(K29="外币",IF(M29="",0,M29),IF(K29="CNY",IF(L29="",0,ROUND(L29/$K$7,2)),0))+IF(K30="外币",IF(M30="",0,M30),IF(K30="CNY",IF(L30="",0,ROUND(L30/$K$7,2)),0))+IF(K31="外币",IF(M31="",0,M31),IF(K31="CNY",IF(L31="",0,ROUND(L31/$K$7,2)),0))-IF(K32="外币",IF(M32="",0,M32),IF(K32="CNY",IF(L32="",0,ROUND(L32/$K$7,2)),0)))*IF(K33="",5,K33)/100,2),""),"")`);
  xml = setCell(xml, "H9", "");
  xml = setCell(xml, "K9", "");
  xml = setCell(xml, "A40", "填写说明：红色 * 为必填；订单号须唯一。请填写客户收货信息、产品及 CNY 单价/数量，并填写 1 单位付款币种对应的人民币汇率。运费、未付尾款、其他费用为加项，折扣为减项；费用行在 K 列选择 CNY 或外币，并在对应金额栏填写一种币种，另一币种按汇率换算。付款渠道、收款账户及 PayPal 手续费请在导入后的 PI 草稿中核对补全；选择 PayPal 后系统按默认 5% 计算手续费，可在草稿中调整。导入前请复核客户、销售员、金额和汇率。");
  xml = xml.replace(/<x:row r="40"([^>]*)>/, (_match, attributes: string) => `<x:row r="40"${attributes.replace(/\s+ht="[^"]*"/, " ht=\"42\"")}>`);
  xml = removePaymentChannelValidation(xml);
  xml = hideRows(xml, 35, 39);
  xml = addConditionalFormatting(xml);
  xml = setCell(xml, "K4", excelDateSerial(shanghaiDatePlusFive(options.now || new Date())));
  xml = setCell(xml, "D7", selectedSeller ? `Sales Manager: ${selectedSeller.name}` : "Sales Manager: ");
  const personalizedSeller = Boolean(selectedSeller || (options.allowSellerSelection && sellers.length));
  if (options.allowSellerSelection && sellers.length) {
    xml = setFormula(xml, "D8", `IFERROR("Contact No: "&VLOOKUP($D$7,$P$${FIRST_LOOKUP_ROW}:$T$${FIRST_LOOKUP_ROW + sellers.length - 1},3,FALSE),"Contact No: ")`);
    xml = setFormula(xml, "D9", `IFERROR("Email: "&IF(VLOOKUP($D$7,$P$${FIRST_LOOKUP_ROW}:$T$${FIRST_LOOKUP_ROW + sellers.length - 1},4,FALSE)="",VLOOKUP($D$7,$P$${FIRST_LOOKUP_ROW}:$T$${FIRST_LOOKUP_ROW + sellers.length - 1},5,FALSE),VLOOKUP($D$7,$P$${FIRST_LOOKUP_ROW}:$T$${FIRST_LOOKUP_ROW + sellers.length - 1},4,FALSE)),"Email: ")`);
    xml = setFormula(xml, "O7", `IFERROR(VLOOKUP($D$7,$P$${FIRST_LOOKUP_ROW}:$T$${FIRST_LOOKUP_ROW + sellers.length - 1},5,FALSE),"")`);
  } else if (selectedSeller) {
    xml = setCell(xml, "D8", `Contact No: ${selectedSeller.business_phone}`);
    xml = setCell(xml, "D9", `Email: ${selectedSeller.business_email || selectedSeller.email}`);
    xml = setCell(xml, "O7", selectedSeller.email);
  } else if (personalizedSeller) {
    xml = setCell(xml, "D8", "Contact No: ");
    xml = setCell(xml, "D9", "Email: ");
    xml = setCell(xml, "O7", "");
  }
  if (personalizedSeller) {
    xml = setCell(xml, "D10", "");
    xml = xml.replace(/<x:row r="10"([^>]*)>/, (_match, attributes: string) => `<x:row r="10"${attributes.replace(/\s+ht="[^"]*"/, " ht=\"6\"")}>`);
  }
  // A13 remains the customer selection cell to preserve the visible invoice layout.
  const ownerIdFormula = `VLOOKUP($D$7,$P$${FIRST_LOOKUP_ROW}:$T$${FIRST_LOOKUP_ROW + sellers.length - 1},2,FALSE)`;
  const customerKey = `${ownerIdFormula}&"|"&$A$13`;
  const customerLookup = (column: number) => `IFERROR(VLOOKUP(${customerKey},$U$${FIRST_LOOKUP_ROW}:$AC$${FIRST_LOOKUP_ROW + customers.length - 1},${column},FALSE),"")`;
  if (customers.length) {
    xml = setFormula(xml, "A14", `"Tax No.: "&${customerLookup(5)}`);
    xml = setFormula(xml, "A15", `"To*: "&${customerLookup(6)}`);
    xml = setFormula(xml, "D15", `"TEL*: "&${customerLookup(7)}`);
    xml = setFormula(xml, "A16", `"Email: "&${customerLookup(8)}`);
    xml = setFormula(xml, "G13", `"Delivery address*: "&${customerLookup(9)}`);
    xml = setFormula(xml, "O13", customerLookup(4));
  }

  const validations: string[] = [];
  if (customers.length) validations.push(`<x:dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="A13"><x:formula1>$W$${FIRST_LOOKUP_ROW}:$W$${FIRST_LOOKUP_ROW + customers.length - 1}</x:formula1></x:dataValidation>`);
  if (options.allowSellerSelection && sellers.length) validations.push(`<x:dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="D7"><x:formula1>$P$${FIRST_LOOKUP_ROW}:$P$${FIRST_LOOKUP_ROW + sellers.length - 1}</x:formula1></x:dataValidation>`);
  if (options.allowSellerSelection && customers.length) {
    const customerEnd = FIRST_LOOKUP_ROW + customers.length - 1;
    const sellerEnd = FIRST_LOOKUP_ROW + sellers.length - 1;
    const selectedOwner = `VLOOKUP($D$7,$P$${FIRST_LOOKUP_ROW}:$T$${sellerEnd},2,FALSE)`;
    const formula = `IFERROR(OFFSET($W$${FIRST_LOOKUP_ROW},MATCH(${selectedOwner},$V$${FIRST_LOOKUP_ROW}:$V$${customerEnd},0)-1,0,COUNTIF($V$${FIRST_LOOKUP_ROW}:$V$${customerEnd},${selectedOwner}),1),$W$${FIRST_LOOKUP_ROW})`;
    validations[0] = `<x:dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="A13"><x:formula1>${xmlEscape(formula)}</x:formula1></x:dataValidation>`;
  }
  validations.push(`<x:dataValidation type="date" operator="greaterThanOrEqual" allowBlank="0" showErrorMessage="1" sqref="K4"><x:formula1>TODAY()</x:formula1></x:dataValidation>`);
  xml = addValidations(xml, validations, validations.length);

  const worksheetEntry = XLSX.CFB.find(archive, "/xl/worksheets/sheet1.xml");
  worksheetEntry.content = Buffer.from(xml, "utf8");
  const stylesPart = XLSX.CFB.find(archive, "/xl/styles.xml");
  if (!stylesPart) throw new Error("PI导入模板样式结构不正确");
  stylesPart.content = Buffer.from(addHiddenPayPalFeeStyle(Buffer.from(stylesPart.content).toString("utf8")), "utf8");
  let workbookXml = Buffer.from(workbookPart.content).toString("utf8");
  if (!/<x:calcPr\b/.test(workbookXml)) workbookXml = workbookXml.replace("</x:workbook>", `<x:calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" /></x:workbook>`);
  else workbookXml = workbookXml.replace(/<x:calcPr\b([^>]*)\/>/, (_match, attributes: string) => `<x:calcPr${attributes} calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" />`);
  workbookPart.content = Buffer.from(workbookXml, "utf8");
  return new Uint8Array(XLSX.CFB.write(archive, { type: "buffer", fileType: "zip", compression: true }));
}

export function piImportTemplateExcelDate(now: Date) {
  const value = shanghaiDatePlusFive(now);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}
