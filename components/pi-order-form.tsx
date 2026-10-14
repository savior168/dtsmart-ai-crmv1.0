"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, Copy, FileDown, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import { QUOTE_CURRENCIES } from "@/lib/currencies";
import { AppSelect } from "@/components/ui/app-select";
import { ConfirmDialog } from "@/components/ui/app-dialog";
import { cnyPerPayment as inverseRate, paymentPerCny } from "@/lib/pi-exchange-rate-math";

type Customer = { id: string; company_name: string; contact_name?: string | null; phone?: string | null; email?: string | null; address?: string | null };
type Account = { id: string; label: string; currency: string; instructions: string; active?: boolean };
type ExchangeRate = { currency: string; business_cny: number | null; source: string; reference_date: string | null };
type Line = { item_name: string; brand: string; model: string; quality: string; description: string; description_zh: string; quantity: number; unit_price_cny: number; estimated_unit_cost_cny: number; preparation_requirement: string; internal_note: string };
const newLine = (): Line => ({ item_name: "", brand: "", model: "", quality: "", description: "", description_zh: "", quantity: 1, unit_price_cny: 0, estimated_unit_cost_cny: -1, preparation_requirement: "", internal_note: "" });
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const defaultValidity = () => { const date = new Date(); date.setDate(date.getDate() + 5); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const field = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none";
const importHeaders = ["产品名称", "品牌", "型号", "质量", "客户描述", "仓库中文规格", "数量", "人民币销售单价", "人民币预估成本", "逐项理货要求"];
const Required = () => <span aria-hidden="true" className="font-semibold text-rose-600"> *</span>;

export function PiOrderForm({ initialCustomerId = "", draftOrderId }: { initialCustomerId?: string; draftOrderId?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [canManageAccounts, setCanManageAccounts] = useState(false);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [warehouseReferenceNumber, setWarehouseReferenceNumber] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState("");
  const [shippingCny, setShippingCny] = useState(0);
  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [validUntil, setValidUntil] = useState(defaultValidity);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [recipient, setRecipient] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [stockingRequirements, setStockingRequirements] = useState("");
  const [items, setItems] = useState<Line[]>([newLine()]);
  const [confirmClearItems, setConfirmClearItems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(draftOrderId));
  const [revision, setRevision] = useState(1);
  const [error, setError] = useState("");
  const selectedAccount = accounts.find((item) => item.id === accountId);
  const availableAccounts = accounts.filter((item) => item.active !== false);
  const cnyPerPayment = Number(rate);
  const effectiveRate = paymentPerCny(cnyPerPayment);
  const totals = useMemo(() => {
    const subtotalCny = roundMoney(items.reduce((sum, item) => sum + item.quantity * item.unit_price_cny, 0));
    const subtotalPayment = roundMoney(items.reduce((sum, item) => sum + item.quantity * roundMoney(item.unit_price_cny * effectiveRate), 0));
    return { subtotalCny, subtotalPayment, shippingPayment: roundMoney(shippingCny * effectiveRate) };
  }, [items, shippingCny, effectiveRate]);

  useEffect(() => {
    void (async () => {
      const [customersResponse, accountsResponse, ratesResponse, draftResponse] = await Promise.all([
        fetch("/api/orders/pi-customers", { cache: "no-store" }),
        fetch("/api/pi-payment-accounts", { cache: "no-store" }),
        fetch("/api/pi-exchange-rates", { cache: "no-store" }),
        draftOrderId ? fetch(`/api/orders/${draftOrderId}`, { cache: "no-store" }) : Promise.resolve(null),
      ]);
      const [customerBody, accountBody, ratesBody, draftBody] = await Promise.all([customersResponse.json().catch(() => ({})), accountsResponse.json().catch(() => ({})), ratesResponse.json().catch(() => ({})), draftResponse?.json().catch(() => ({})) || Promise.resolve(null)]);
      if (!customersResponse.ok || !accountsResponse.ok || (draftResponse && !draftResponse.ok)) {
        setError(customerBody.error || accountBody.error || draftBody?.error || "PI基础资料加载失败");
        setLoadingDraft(false);
        return;
      }
      const listed = (customerBody.data || []) as Customer[];
      const exact = initialCustomerId ? listed.find((item) => item.id === initialCustomerId) : null;
      setCustomers(listed);
      if (initialCustomerId && !exact && !draftOrderId) { setCustomerId(""); setError("该客户当前不归属您，不能为其创建PI订单"); }
      if (exact) { setRecipient(exact.contact_name || ""); setPhone(exact.phone || ""); setEmail(exact.email || ""); setAddress(exact.address || ""); }
      setAccounts(accountBody.data || []);
      if (ratesResponse.ok) {
        setExchangeRates(ratesBody.rates || []);
        if (!draftOrderId && ratesBody.rates?.find((item: ExchangeRate) => item.currency === "USD")?.business_cny > 0) setRate(String(ratesBody.rates.find((item: ExchangeRate) => item.currency === "USD").business_cny));
      }
      setCanManageAccounts(Boolean(accountBody.can_manage));
      if (draftResponse) {
        if (!draftBody.can_edit_draft) { setError("当前PI订单不是可编辑草稿"); setLoadingDraft(false); return; }
        const order = draftBody.order;
        setRevision(order.pi_revision);
        setCustomerId(order.customer_id);
        setWarehouseReferenceNumber(order.warehouse_reference_number || "");
        if (!listed.some((item) => item.id === order.customer_id)) {
          setCustomers((current) => [{ id: order.customer_id, company_name: order.customer?.company_name || order.customer_short_name }, ...current]);
        }
        setCurrency(order.currency);
        setRate(String(inverseRate(Number(order.fx_rate_cny_to_payment))));
        setShippingCny(Number(order.shipping_cny));
        setAccountId(order.payment_account_id || "");
        setPaymentMethod(order.payment_method || "");
        setValidUntil(order.pi_valid_until || "");
        setDeliveryDate(order.delivery_date || "");
        setRecipient(order.delivery_recipient || "");
        setPhone(order.delivery_phone || "");
        setEmail(order.delivery_email || "");
        setAddress(order.delivery_address || "");
        setStockingRequirements(draftBody.stocking_requirements || "");
        setItems((draftBody.items || []).map((item: Line) => ({
          item_name: item.item_name || "", brand: item.brand || "", model: item.model || "", quality: item.quality || "",
          description: item.description || "", description_zh: item.description_zh || "", quantity: Number(item.quantity),
          unit_price_cny: Number(item.unit_price_cny), estimated_unit_cost_cny: Number(item.estimated_unit_cost_cny),
          preparation_requirement: item.preparation_requirement || "", internal_note: item.internal_note || "",
        })));
        setLoadingDraft(false);
      }
    })();
  }, [initialCustomerId, draftOrderId]);

  function chooseCustomer(id: string) {
    setCustomerId(id);
    const customer = customers.find((item) => item.id === id);
    if (!customer) return;
    setRecipient(customer.contact_name || "");
    setPhone(customer.phone || "");
    setEmail(customer.email || "");
    setAddress(customer.address || "");
  }
  function editLine(index: number, key: keyof Line, value: string | number) {
    setItems((current) => current.map((item, position) => position === index ? { ...item, [key]: value } : item));
  }
  function importRows(rows: unknown[][]) {
    const cells = rows.map((row) => row.map((value) => String(value ?? "").trim())).filter((row) => row.some(Boolean));
    if (cells[0]?.[0] === importHeaders[0]) cells.shift();
    if (!cells.length || cells.length > 500) throw new Error("请导入1至500条产品明细");
    const imported = cells.map((row, index) => {
      const quantity = Number(row[6]);
      const unitPrice = Number(row[7]);
      const cost = Number(row[8]);
      if (!row[0] || !row[5] || !Number.isSafeInteger(quantity) || quantity < 1 || !row[7] || !row[8]
        || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(cost) || cost < 0
        || Math.round(unitPrice * 100) !== unitPrice * 100 || Math.round(cost * 100) !== cost * 100) {
        throw new Error(`第${index + 1}行缺少产品名称、仓库中文规格、整数数量、人民币销售价或成本，或金额超过两位小数`);
      }
      return { ...newLine(), item_name: row[0], brand: row[1] || "", model: row[2] || "", quality: row[3] || "",
        description: row[4] || "", description_zh: row[5], quantity, unit_price_cny: unitPrice,
        estimated_unit_cost_cny: cost, preparation_requirement: row[9] || "" };
    });
    if (items.filter((item) => item.item_name.trim()).length + imported.length > 500) throw new Error("每张PI最多500条产品，请分批处理");
    setItems((current) => [...current.filter((item) => item.item_name.trim()), ...imported]);
    setError("");
  }
  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([importHeaders]), "PI产品明细");
    XLSX.writeFile(book, "PI产品明细导入模板.xlsx");
  }
  async function importExcel(file?: File) {
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = book.Sheets[book.SheetNames[0]];
      importRows(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Excel导入失败"); }
    if (fileRef.current) fileRef.current.value = "";
  }
  async function pasteRows() {
    try { importRows((await navigator.clipboard.readText()).split(/\r?\n/).map((line) => line.split("\t"))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "读取剪贴板失败"); }
  }
  async function create() {
    if (busy) return;
    setError("");
    if (!customerId || !warehouseReferenceNumber.trim() || !currency || !accountId || !Number.isFinite(cnyPerPayment) || cnyPerPayment <= 0) {
      setError("请选择客户、填写订单编号、付款币种、收款账户及正数汇率"); return;
    }
    if (items.some((item) => !item.item_name.trim() || !item.description_zh.trim() || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.unit_price_cny < 0 || item.estimated_unit_cost_cny < 0)) {
      setError("每行产品都须填写名称、仓库中文规格、整数数量、人民币销售价和预估成本"); return;
    }
    setBusy(true);
    try {
      const response = await fetch(draftOrderId ? `/api/orders/${draftOrderId}/draft` : "/api/orders/create-pi", {
        method: draftOrderId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId, warehouse_reference_number: warehouseReferenceNumber.trim(), currency, fx_rate_cny_to_payment: effectiveRate, shipping_cny: shippingCny,
          payment_method: paymentMethod, payment_account_id: accountId, valid_until: validUntil, delivery_date: deliveryDate,
          delivery_recipient: recipient, delivery_phone: phone, delivery_email: email, delivery_address: address,
          stocking_requirements: stockingRequirements, items, revision }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || "PI订单创建失败"); return; }
      window.location.assign(`/orders/${body.data.id}`);
    } catch { setError("网络异常，未确认创建结果；请先检查PI订单列表，避免重复提交"); }
    finally { setBusy(false); }
  }

  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-[1500px] space-y-5">
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h1 className="text-xl font-bold">{draftOrderId ? "编辑PI草稿" : "创建PI订单"}</h1><p className="mt-1 text-sm text-slate-500">客户与价格只录入一次；保存草稿后核对，确认后生成仓库备货单。</p></div><Link href={draftOrderId ? `/orders/${draftOrderId}` : "/orders"} className="inline-flex h-9 items-center rounded-lg border bg-white px-3 text-sm hover:bg-slate-50">返回PI订单列表</Link></header>
    {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
    <section className="border-b border-slate-100 p-5"><h2 className="mb-4 font-semibold">PI基本信息</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm">客户<Required /><AppSelect className={field} aria-label="搜索并选择我的PI客户" forceSearch disabled={Boolean(draftOrderId)} value={customerId} onChange={(event) => chooseCustomer(event.target.value)}><option value="">请选择我的客户</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.company_name}</option>)}</AppSelect></label>
      <label className="text-sm">订单编号<Required /><input className={field} maxLength={80} value={warehouseReferenceNumber} onChange={(event) => setWarehouseReferenceNumber(event.target.value)} placeholder="例如 JOE-42；不可与其他PI重复" /></label>
      <label className="text-sm">客户付款币种<Required /><AppSelect className={field} aria-label="搜索并选择客户付款币种" value={currency} onChange={(event) => { setCurrency(event.target.value); setRate(String(exchangeRates.find((item) => item.currency === event.target.value)?.business_cny || "")); }}><option value="">请选择</option>{QUOTE_CURRENCIES.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}</AppSelect></label>
      <label className="text-sm">汇率：1 {currency || "付款币种"} = 多少人民币<Required /><input className={field} type="number" min="0.000001" step="0.000001" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="例如 7.200000" />{exchangeRates.find((item) => item.currency === currency)?.business_cny ? <span className="text-xs text-slate-500">已带入业务汇率，可按本单调整</span> : null}</label>
      <label className="text-sm">收款账户<Required /><AppSelect className={field} aria-label="选择PI收款账户" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">{availableAccounts.length ? "请选择管理员预设账户" : "尚无启用的收款账户"}</option>{availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</AppSelect>{!availableAccounts.length ? <span className="mt-1 block text-xs text-amber-700">{canManageAccounts ? <><Link href="/settings/pi-payment-accounts" className="underline">先配置并启用真实收款账户</Link>，再返回创建PI。</> : "请联系系统管理员配置并启用收款账户后再创建PI。"}</span> : null}</label>
      <label className="text-sm">付款方式<input className={field} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} placeholder="例如 T/T Bank Transfer" /></label>
      <label className="text-sm">PI有效期<Required /><input className={field} type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
      <label className="text-sm">预计交付日期<input className={field} type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></label>
      <label className="text-sm">运费（RMB）<input className={field} type="number" min="0" step="0.01" value={shippingCny} onChange={(event) => setShippingCny(Number(event.target.value))} /></label>
      {selectedAccount ? <p className="md:col-span-2 xl:col-span-4 rounded-lg bg-slate-50 p-3 text-xs whitespace-pre-wrap">所选收款信息（订单提交时固定快照）：{selectedAccount.instructions}</p> : null}
    </div></section>
    <section className="border-b border-slate-100 p-5"><h2 className="mb-4 font-semibold">客户及收货信息</h2><div className="grid gap-4 md:grid-cols-4">
      <label className="text-sm">收件人<input className={field} value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>
      <label className="text-sm">电话<input className={field} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
      <label className="text-sm">邮箱<input className={field} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="text-sm md:col-span-4">收货地址<input className={field} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
    </div></section>
    <section className="p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">PI产品明细</h2><p className="mt-1 text-xs text-slate-500">直接录入或批量导入；人民币销售价与成本分别填写，付款币种价格自动换算。表格可横向滚动。</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void downloadTemplate()} className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm text-blue-700"><FileDown size={16} />下载模板</button><input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => void importExcel(event.target.files?.[0])} /><button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm"><FileSpreadsheet size={16} />导入Excel</button><button type="button" onClick={() => void pasteRows()} className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm"><ClipboardPaste size={16} />粘贴表格</button><button type="button" onClick={() => setItems((current) => current.length < 500 ? [...current, newLine()] : current)} className="inline-flex h-9 items-center gap-1 rounded-lg bg-blue-50 px-3 text-sm text-blue-700"><Plus size={16} />添加产品</button><button type="button" onClick={() => setConfirmClearItems(true)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-rose-200 px-3 text-sm text-rose-700"><Trash2 size={16} />清空明细</button></div></div>
      <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[1900px] text-left text-xs"><thead className="bg-slate-50/70"><tr>{["No.", "Items *", "Brand", "Models", "Quality", "Description", "Warehouse Spec (CN) *", "Unit Price (RMB) *", "Cost (RMB) *", "Margin", `Unit Price (${currency})`, "Quantity *", "Amount (RMB)", `Amount (${currency})`, "Packing Requirement", "Warehouse Note", "Actions"].map((head) => <th key={head} className="whitespace-nowrap px-2 py-3 font-medium">{head.endsWith(" *") ? <>{head.slice(0, -2)}<Required /></> : head}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={index} className="border-t border-slate-100 align-middle">
        <td className="px-2 py-1.5">{index + 1}</td>
        {(["item_name", "brand", "model", "quality", "description", "description_zh"] as const).map((key) => <td key={key} className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行${key}`} className={`${field} h-9 min-w-28`} value={item[key]} onChange={(event) => editLine(index, key, event.target.value)} /></td>)}
        <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行人民币单价`} className={`${field} h-9 w-28`} type="number" min="0" step="0.01" value={item.unit_price_cny} onChange={(event) => editLine(index, "unit_price_cny", Number(event.target.value))} /></td>
        <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行预估成本`} className={`${field} h-9 w-28`} type="number" min="0" step="0.01" value={item.estimated_unit_cost_cny < 0 ? "" : item.estimated_unit_cost_cny} onChange={(event) => editLine(index, "estimated_unit_cost_cny", event.target.value === "" ? -1 : Number(event.target.value))} /></td>
        <td className={`whitespace-nowrap px-2 py-1.5 font-medium ${item.unit_price_cny > 0 && item.estimated_unit_cost_cny > item.unit_price_cny ? "text-rose-600" : "text-emerald-700"}`}>{item.unit_price_cny > 0 && item.estimated_unit_cost_cny >= 0 ? `${((item.unit_price_cny - item.estimated_unit_cost_cny) / item.unit_price_cny * 100).toFixed(2)}%` : "—"}</td>
        <td className="whitespace-nowrap px-2 py-1.5">{effectiveRate > 0 ? roundMoney(item.unit_price_cny * effectiveRate).toFixed(2) : "—"}</td>
        <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行数量`} className={`${field} h-9 w-20`} type="number" min="1" step="1" value={item.quantity} onChange={(event) => editLine(index, "quantity", Number(event.target.value))} /></td>
        <td className="whitespace-nowrap px-2 py-1.5">¥{roundMoney(item.quantity * item.unit_price_cny).toFixed(2)}</td>
        <td className="whitespace-nowrap px-2 py-1.5">{effectiveRate > 0 ? roundMoney(item.quantity * roundMoney(item.unit_price_cny * effectiveRate)).toFixed(2) : "—"}</td>
        <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行理货要求`} className={`${field} h-9 min-w-32`} value={item.preparation_requirement} onChange={(event) => editLine(index, "preparation_requirement", event.target.value)} /></td>
        <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行仓库备注`} className={`${field} h-9 min-w-32`} value={item.internal_note} onChange={(event) => editLine(index, "internal_note", event.target.value)} /></td>
        <td className="px-2 py-1.5"><div className="flex gap-2"><button type="button" title="复制该产品行" aria-label={`复制第${index + 1}行`} disabled={items.length >= 500} onClick={() => setItems((current) => [...current.slice(0, index + 1), { ...current[index] }, ...current.slice(index + 1)])} className="text-blue-600 disabled:opacity-30"><Copy size={16} /></button><button type="button" title="删除该产品行" aria-label={`删除第${index + 1}行`} disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, position) => position !== index))} className="text-rose-600 disabled:opacity-30"><Trash2 size={16} /></button></div></td>
      </tr>)}</tbody></table></div>
    </section>
    <section className="grid gap-4 border-t border-slate-100 p-5 lg:grid-cols-[1fr_auto]"><label className="text-sm">给仓库的特殊备货要求（选填）<input className={field} value={stockingRequirements} onChange={(event) => setStockingRequirements(event.target.value)} placeholder="无特殊要求时按PI明细常规备货" /></label>
      <div className="min-w-72 rounded-lg bg-slate-50 p-3 text-sm"><h2 className="font-semibold text-slate-900">PI费用汇总</h2><div className="mt-2 grid grid-cols-[auto_auto_auto] gap-x-5 gap-y-1 text-right text-slate-600"><span></span><span>RMB</span><span>{currency}</span><span className="text-left">产品小计</span><span>¥{totals.subtotalCny.toFixed(2)}</span><span>{totals.subtotalPayment.toFixed(2)}</span><span className="text-left">运费</span><span>¥{shippingCny.toFixed(2)}</span><span>{totals.shippingPayment.toFixed(2)}</span><span className="border-t pt-2 text-left font-semibold text-slate-900">PI总额</span><span className="border-t pt-2 font-semibold text-slate-900">¥{roundMoney(totals.subtotalCny + shippingCny).toFixed(2)}</span><span className="border-t pt-2 font-semibold text-blue-700">{roundMoney(totals.subtotalPayment + totals.shippingPayment).toFixed(2)}</span></div></div>
    </section>
    <div className="flex justify-end border-t border-slate-100 px-5 py-4"><button type="button" disabled={busy || loadingDraft || !availableAccounts.length} onClick={() => void create()} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "保存中，请勿重复提交…" : "保存PI草稿"}</button></div>
    </div>
    <ConfirmDialog open={confirmClearItems} title="确认清空产品明细？" description={`当前表单内的 ${items.length} 行产品将清空。已保存的 PI 草稿不会因此立即改变。`} confirmLabel="确认清空" danger onCancel={() => setConfirmClearItems(false)} onConfirm={() => { setItems([newLine()]); setConfirmClearItems(false); }} />
  </div></main>;
}
