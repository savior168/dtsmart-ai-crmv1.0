import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import { buildDirectPiWorkbook } from "../lib/direct-pi-export.ts";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261013090000_stock_receiving_workflow.sql");
const piMigration = read("supabase/migrations/20261013074814_pi_order_direct_creation.sql");
const detail = read("app/api/stock-orders/[id]/route.ts");
const exportRoute = read("app/api/stock-orders/[id]/export/route.ts");
const receiving = read("app/api/stock-orders/[id]/receiving/route.ts");
const order = read("app/api/orders/[id]/route.ts");
const customerPi = read("lib/direct-pi-export.ts");
const customerPiRoute = read("app/api/orders/[id]/export/route.ts");
const piForm = read("components/pi-order-form.tsx");
const statusRoute = read("app/api/stock-orders/[id]/status/route.ts");
const stockView = read("components/stock-order-detail-view.tsx");
const orderListApi = read("app/api/orders/route.ts");
const createPiApi = read("app/api/orders/create-pi/route.ts");
const paymentAccountsApi = read("app/api/pi-payment-accounts/route.ts");
const orderListView = read("components/orders-view.tsx");
const piCustomersApi = read("app/api/orders/pi-customers/route.ts");
const strictOwnerMigration = read("supabase/migrations/20261014120000_pi_strict_customer_owner.sql");

assert.match(orderListApi, /can_create:[^\n]*account\.role === "ADMIN"[^\n]*hasPermission\(account, "orders\.create"\)/, "管理员有PI创建权限时列表必须显示创建入口");
assert.match(createPiApi, /account\.role !== "SALES" && account\.role !== "SUPERVISOR" && account\.role !== "ADMIN"/, "列表允许管理员创建时API不能再拒绝管理员");
assert.match(piCustomersApi, /\.eq\("owner_id", account\.id\)/, "PI客户选择必须只返回当前登录用户归属客户");
assert.match(createPiApi, /\.eq\("owner_id", account\.id\)/, "PI创建API必须核对客户当前归属");
assert.match(strictOwnerMigration, /customer\.owner_id is distinct from actor\.id/, "数据库创建函数必须对所有角色强制当前归属校验");
assert.match(strictOwnerMigration, /c\.owner_id=target\.sales_user_id/, "PI提交前必须再次核对客户归属");
assert.match(piForm, /forceSearch[\s\S]*请选择我的客户/, "PI客户下拉即使选项较少也必须可搜索");
assert.match(piForm, /清空明细[\s\S]*<ConfirmDialog[\s\S]*确认清空/, "清空产品明细必须使用统一确认弹窗");
assert.match(piForm, /1 \{currency \|\| "付款币种"\} = 多少人民币/, "PI汇率展示应使用外币兑人民币方向");
assert.match(paymentAccountsApi, /export async function GET\(\)[\s\S]*can_manage:[^\n]*account\.role === "ADMIN"/, "PI基础资料接口必须存在并返回管理员维护权限");
assert.match(orderListView, /"PI号",\s*"客户简称",\s*"PI状态",\s*"PI金额",\s*"备货单"/, "PI列表按业务优先级展示关键字段");
assert.doesNotMatch(orderListView, /仓库约定订单编号|warehouse_reference_number/, "PI列表不得展示内部仓库约定编号");
assert.match(piForm, /AppSelect[\s\S]*搜索并选择客户付款币种/, "币种应使用系统可搜索选择组件");
assert.doesNotMatch(piForm, /<select\b/, "PI表单不得退回浏览器原生下拉");
assert.match(piForm, /下载模板[\s\S]*导入Excel[\s\S]*粘贴表格[\s\S]*添加产品/, "PI产品明细应提供批量快捷操作");
assert.match(piForm, /rounded-xl border border-slate-200 bg-white[\s\S]*xl:grid-cols-4[\s\S]*min-w-\[1900px\]/, "PI录入应保留轻量单卡片和四列基础字段");
assert.doesNotMatch(piForm, /从商品库添加|searchProducts|productQuery/, "PI录入不应再显示商品库搜索模块");
assert.match(piForm, /"No\.", "Items \*", "Brand", "Models", "Quality", "Description", "Warehouse Spec \(CN\) \*"[\s\S]*"Unit Price \(RMB\) \*", "Cost \(RMB\) \*"[\s\S]*"Packing Requirement", "Warehouse Note"/, "每项产品属性应使用独立英文列头并标明币种");
assert.doesNotMatch(piForm, /<Fragment|colSpan=\{9\}/, "每项产品应只占一行");
assert.match(piForm, /订单编号<Required \/>/, "创建PI应统一显示订单编号并以红星标出必填");
assert.match(piForm, /PI有效期[\s\S]*运费（RMB）[\s\S]*客户及收货信息[\s\S]*PI产品明细/, "运费输入应位于上方PI基本信息区");

for (const source of [detail, exportRoute]) {
  assert.doesNotMatch(source, /unit_price|total_amount|payment_account|profit|margin/, "仓库接口或导出不能读取销售价格及利润");
  assert.match(source, /estimated_unit_cost_cny,procurement_cost/, "仓库仅读取预估及实际成本");
  assert.match(source, /received_quantity,warehouse_supplier_code/, "仓库回货和供应商编码应可查看");
}
assert.match(receiving, /requirePermission\("stock\.update"\)/, "回货更新必须验证仓库权限");
assert.match(receiving, /Number\.isSafeInteger\(received\)/, "回货数量必须为安全整数");
assert.match(migration, /received_quantity >= 0 and received_quantity <= quantity/, "数据库必须限制回货不超订购数");
assert.match(migration, /actor\.role not in \('WAREHOUSE','ADMIN'\)[\s\S]*current_user_has_business_permission\('stock\.update'\)/, "数据库必须限制回货和状态角色");
assert.match(migration, /previous='PREPARING' and p_status in \('RECEIVED'/, "仅备货中可转已回货");
assert.match(migration, /previous='RECEIVED' and p_status in \('SORTING'/, "已回货才可理货");
assert.match(migration, /previous='SORTING' and p_status in \('READY_TO_SHIP'/, "理货完成才可待出货");
assert.match(migration, /previous='READY_TO_SHIP' and p_status in \('SHIPPED'/, "交给承运商后方可标记发货");
assert.match(migration, /received_quantity<>quantity[\s\S]*所有产品回货数量达到订购数量/, "未全数回货不得宣称已回货");
assert.match(migration, /p_status in \('SHORTAGE','CANCELLED','READY_TO_SHIP','SHIPPED'\)[\s\S]*p_note/, "理货打包完成和发货须有交接记录");
assert.match(order, /received_items[\s\S]*received_units/, "销售订单应展示累计回货进度");
assert.doesNotMatch(order.match(/const receivingProgress =[\s\S]*?} : null;/)?.[0] || "", /warehouse_supplier_code|procurement_cost/, "销售进度摘要不得夹带供应商或成本数据");
assert.doesNotMatch(customerPi, /createWorkbookFile/, "客户PI必须使用专用版式，不能退回通用表格导出");
assert.doesNotMatch(customerPiRoute.match(/\.from\("sales_order_items"\)[\s\S]*?\.order\("line_number"\)/)?.[0] || "", /unit_cost|estimated|procurement|profit|margin|supplier|received|internal_note|preparation/i, "客户PI导出查询不能读取内部成本或供应商字段");
assert.match(customerPiRoute, /order\.data\.status === "DRAFT"[\s\S]*不能作为正式PI导出/, "未提交的PI草稿不能作为正式客户文件导出");
assert.match(piForm, /useState\("USD"\)/, "创建PI默认客户付款币种应为美元");
assert.match(piForm, /setCurrency\(event\.target\.value\); setRate\(String\(exchangeRates\.find/, "变更报价币种时应带入该币种业务汇率，不得保留旧币种汇率");
assert.doesNotMatch(piForm, /setCurrency\(event\.target\.value\); setAccountId\(""\)/, "变更报价币种不得清空已选收款账户");
assert.doesNotMatch(piMigration, /account\.currency<>clean_currency|a\.currency=target\.currency/, "数据库不得把PI报价币种与收款账户币种绑定");
assert.match(piMigration, /insert into public\.stock_orders\([\s\S]*?delivery_recipient,delivery_phone,delivery_email,delivery_address,updated_by\)/, "提交PI生成备货单时必须固化收货信息");
assert.match(exportRoute, /stock_order_events[\s\S]*?to_status", "SHIPPED"/, "实际发货日必须取已发货事件，不可猜测");
assert.match(piMigration, /select p\.phone from public\.profiles p where p\.id=actor\.id/, "销售联系电话应从已有用户资料读取，不得假设users表有phone列");
assert.doesNotMatch(customerPiRoute, /users!sales_orders_sales_user_id_fkey\(name,email,phone\)/, "PI导出不得查询users表不存在的phone列");
assert.match(migration, /create table public\.stock_order_expenses[\s\S]*?enable row level security/, "整单费用必须独立存储并启用RLS");
assert.match(migration, /p_status='SHIPPED'[\s\S]*?p_packaging_cost_cny is null[\s\S]*?p_procurement_expenses_cny is null[\s\S]*?p_shipping_expenses_cny is null/, "已发货必须在数据库层校验三项费用");
assert.match(statusRoute, /status === "SHIPPED"[\s\S]*?p_packaging_cost_cny/, "只有已发货时提交整单费用");
assert.match(stockView, /status === "SHIPPED"[\s\S]*?packagingExpense/, "仓库已发货时应显示费用输入");
assert.doesNotMatch(order, /stock_order_expenses|packaging_cost_cny|shipping_expenses_cny/, "销售订单详情不得返回仓库整单费用");

const orderFixture = {
  order_number: "PI-TEST", created_at: "2026-10-12T00:00:00Z", confirmed_at: "2026-10-13T00:00:00Z", pi_valid_until: "2026-10-17",
  seller_company_name: "DT-Smart", seller_company_address: "Shenzhen", seller_website: "https://www.dt-smart.com/",
  seller_contact_name: "Eva", seller_contact_phone: "+86 100000", seller_contact_email: "eva@example.com",
  customer_short_name: "Buyer", customer: { company_name: "Buyer Ltd" }, delivery_recipient: "Jo", delivery_phone: "+44 123",
  delivery_email: "jo@example.com", delivery_address: "London", delivery_date: "2026-10-25",
  currency: "NGN", fx_rate_cny_to_payment: 200, payment_method: "NAIRA/RMB",
  subtotal_cny: 100, shipping_cny: 10, total_cny: 110, subtotal: 20000, shipping_cost: 2000, total_amount: 22000,
  payment_account_snapshot: "Approved account", warehouse_supplier_code: "PRIVATE-SUPPLIER",
};
const itemFixture = { line_number: 1, item_name: "Part", brand: "MAC", model: "A1", quality: "ORG", description: "Black", quantity: 1,
  unit_price_cny: 100, unit_price: 20000, estimated_unit_cost_cny: 31, internal_note: "PRIVATE-WAREHOUSE", warehouse_supplier_code: "PRIVATE-SUPPLIER" };
const workbook = buildDirectPiWorkbook(orderFixture, [itemFixture]);
const archive = XLSX.CFB.read(Buffer.from(workbook), { type: "buffer" });
assert.equal(archive.FullPaths.some((path) => /externalLinks/i.test(path)), false, "客户PI不得保留源模板的外部工作簿链接");
const book = XLSX.read(workbook, { type: "array", cellFormula: true, cellStyles: true });
const sheet = book.Sheets[book.SheetNames[0]];
assert.equal(sheet.G2.v, "COMMERCIAL INVOICE");
assert.equal(sheet.J2.v, "PI-TEST");
assert.equal(sheet.J4.v, "5 days");
assert.match(sheet.I18.v, /NGN/);
assert.equal(sheet.I19.v, 20000);
assert.equal(sheet.J19.v, 1);
assert.equal(sheet.K19.f, "I19*J19");
assert.equal(sheet.K28.v, 20000);
assert.equal(sheet.K30.v, 22000);
assert.equal(sheet.A32.v, "Approved account");
assert.equal(sheet.A35.v, "2026-10-12", "客户PI签署日期应取创建日期而非提交日期");
assert.equal(sheet.K18.v, "Amount\n(NGN)");
assert.equal(sheet.L18, undefined, "客户PI不可保留人民币或成本价列");
const visibleValues = Object.values(sheet).filter((cell) => cell && typeof cell === "object" && "v" in cell).map((cell) => String(cell.v)).join(" ");
assert.doesNotMatch(visibleValues, /PRIVATE-SUPPLIER|PRIVATE-WAREHOUSE|\b31\b|成本|利润/i, "客户PI不得出现内部成本或仓库信息");
assert.doesNotMatch(`${sheet.I18.v} ${sheet.K18.v}`, /RMB|CNY|人民币/i, "客户PI价格列只显示所选付款币种");
assert.throws(() => buildDirectPiWorkbook({ ...orderFixture, subtotal: 19999 }, [itemFixture]), /金额与订单汇总不一致/);
assert.throws(() => buildDirectPiWorkbook(orderFixture, [{ ...itemFixture, unit_price: 19999 }]), /换算单价不正确/);

console.log("PI备货价格隔离、回货数量校验、阶段流转和销售进度静态回归通过。");
