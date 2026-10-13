"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { QUOTE_CURRENCIES } from "@/lib/currencies";

type Customer = { id: string; company_name: string; contact_name?: string | null; phone?: string | null; email?: string | null; address?: string | null };
type Account = { id: string; label: string; currency: string; instructions: string; active?: boolean };
type Product = { id: string; sku: string; name_en: string | null; name_zh: string; brand: string | null; model: string | null; quality: string | null; description_en: string | null };
type Line = { item_name: string; brand: string; model: string; quality: string; description: string; description_zh: string; quantity: number; unit_price_cny: number; estimated_unit_cost_cny: number; preparation_requirement: string; internal_note: string };
const newLine = (): Line => ({ item_name: "", brand: "", model: "", quality: "", description: "", description_zh: "", quantity: 1, unit_price_cny: 0, estimated_unit_cost_cny: -1, preparation_requirement: "", internal_note: "" });
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const defaultValidity = () => { const date = new Date(); date.setDate(date.getDate() + 5); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const field = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none";

export function PiOrderForm({ initialCustomerId = "", draftOrderId }: { initialCustomerId?: string; draftOrderId?: string }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productQuery, setProductQuery] = useState("");
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
  const [busy, setBusy] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(draftOrderId));
  const [revision, setRevision] = useState(1);
  const [error, setError] = useState("");
  const selectedAccount = accounts.find((item) => item.id === accountId);
  const availableAccounts = accounts.filter((item) => item.active !== false);
  const effectiveRate = Number(rate);
  const totals = useMemo(() => {
    const subtotalCny = roundMoney(items.reduce((sum, item) => sum + item.quantity * item.unit_price_cny, 0));
    const subtotalPayment = roundMoney(items.reduce((sum, item) => sum + item.quantity * roundMoney(item.unit_price_cny * effectiveRate), 0));
    return { subtotalCny, subtotalPayment, shippingPayment: roundMoney(shippingCny * effectiveRate) };
  }, [items, shippingCny, effectiveRate]);

  useEffect(() => {
    void (async () => {
      const [customersResponse, accountsResponse, exactResponse, draftResponse] = await Promise.all([
        fetch("/api/customers?pageSize=200&ai_status=all&sort=updated_at", { cache: "no-store" }),
        fetch("/api/pi-payment-accounts", { cache: "no-store" }),
        initialCustomerId ? fetch(`/api/customers/${initialCustomerId}`, { cache: "no-store" }) : Promise.resolve(null),
        draftOrderId ? fetch(`/api/orders/${draftOrderId}`, { cache: "no-store" }) : Promise.resolve(null),
      ]);
      const [customerBody, accountBody, exactBody, draftBody] = await Promise.all([customersResponse.json().catch(() => ({})), accountsResponse.json().catch(() => ({})), exactResponse?.json().catch(() => ({})) || Promise.resolve(null), draftResponse?.json().catch(() => ({})) || Promise.resolve(null)]);
      if (!customersResponse.ok || !accountsResponse.ok || (draftResponse && !draftResponse.ok)) {
        setError(customerBody.error || accountBody.error || draftBody?.error || "PI基础资料加载失败");
        setLoadingDraft(false);
        return;
      }
      const listed = (customerBody.data || []) as Customer[];
      const exact = exactResponse?.ok && exactBody?.id ? exactBody as Customer : null;
      setCustomers(exact && !listed.some((item) => item.id === exact.id) ? [exact, ...listed] : listed);
      if (exact) { setRecipient(exact.contact_name || ""); setPhone(exact.phone || ""); setEmail(exact.email || ""); setAddress(exact.address || ""); }
      setAccounts(accountBody.data || []);
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
        setRate(String(order.fx_rate_cny_to_payment));
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
  async function searchProducts() {
    setError("");
    const response = await fetch(`/api/quote-products?q=${encodeURIComponent(productQuery)}&quantity=1`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error || "商品搜索失败"); return; }
    setProducts(body.data || []);
  }
  async function create() {
    if (busy) return;
    setError("");
    if (!customerId || !warehouseReferenceNumber.trim() || !currency || !accountId || !Number.isFinite(effectiveRate) || effectiveRate <= 0) {
      setError("请选择客户、填写仓库约定订单编号、付款币种、收款账户及正数汇率"); return;
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
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">{draftOrderId ? "编辑PI草稿" : "创建PI订单"}</h1><p className="mt-1 text-sm text-slate-500">保存草稿后可继续增删商品；核对无误后在详情页确认并提交仓库。</p></div><Link href={draftOrderId ? `/orders/${draftOrderId}` : "/orders"} className="rounded-lg border px-4 py-2 text-sm">返回</Link></div>
    {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
    <section className="grid gap-4 rounded-xl border bg-white p-5 md:grid-cols-3">
      <label className="text-sm">客户 *<select className={field} disabled={Boolean(draftOrderId)} value={customerId} onChange={(event) => chooseCustomer(event.target.value)}><option value="">请选择我的客户</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.company_name}</option>)}</select></label>
      <label className="text-sm">仓库约定订单编号 *<input className={field} maxLength={80} value={warehouseReferenceNumber} onChange={(event) => setWarehouseReferenceNumber(event.target.value)} placeholder="例如 JOE-42；不可与其他PI重复" /></label>
      <label className="text-sm">客户付款币种 *<select className={field} value={currency} onChange={(event) => { setCurrency(event.target.value); setRate(""); }}><option value="">请选择</option>{QUOTE_CURRENCIES.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}</select></label>
      <label className="text-sm">汇率：1 CNY = 多少 {currency || "付款币种"} *<input className={field} type="number" min="0.000001" step="0.000001" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="例如 209.000000" /></label>
      <label className="text-sm">收款账户 *<select className={field} value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">{availableAccounts.length ? "请选择管理员预设账户" : "尚无启用的收款账户"}</option>{availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label>
      <label className="text-sm">付款方式<input className={field} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} placeholder="例如 T/T Bank Transfer" /></label>
      <label className="text-sm">PI有效期 *<input className={field} type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
      <label className="text-sm">预计交付日期<input className={field} type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></label>
      {selectedAccount ? <p className="md:col-span-3 rounded-lg bg-slate-50 p-3 text-xs whitespace-pre-wrap">所选收款信息（订单提交时固定快照）：{selectedAccount.instructions}</p> : null}
    </section>
    <section className="rounded-xl border bg-white p-5"><h2 className="mb-4 font-semibold">客户及收货信息</h2><div className="grid gap-4 md:grid-cols-4">
      <label className="text-sm">收件人<input className={field} value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>
      <label className="text-sm">电话<input className={field} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
      <label className="text-sm">邮箱<input className={field} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="text-sm md:col-span-4">收货地址<input className={field} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
    </div></section>
    <section className="rounded-xl border bg-white p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">产品明细</h2><button type="button" onClick={() => setItems((current) => [...current, newLine()])} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700"><Plus size={16} />添加产品行</button></div>
      <div className="mb-4 flex gap-2"><input className={field} value={productQuery} onChange={(event) => setProductQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchProducts(); } }} placeholder="从商品库搜索名称、SKU、品牌或型号" /><button type="button" onClick={() => void searchProducts()} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-4 text-sm text-white"><Search size={16} />搜索</button></div>
      {products.length ? <div className="mb-4 grid gap-2 md:grid-cols-2">{products.map((product) => <button key={product.id} type="button" className="rounded-lg border p-2 text-left text-sm hover:bg-blue-50" onClick={() => { setItems((current) => [...current.filter((item) => item.item_name.trim()), { ...newLine(), item_name: product.name_en || product.name_zh, brand: product.brand || "", model: product.model || "", quality: product.quality || "", description: product.description_en || "", description_zh: product.name_zh }]); setProducts([]); }}>{product.sku} · {product.name_zh}</button>)}</div> : null}
      <div className="overflow-x-auto"><table className="w-full min-w-[1600px] text-left text-xs"><thead><tr>{["序号", "产品名称", "品牌", "型号", "质量", "描述（客户）", "仓库中文规格 *", "数量", "人民币销售价 *", "人民币预估成本 *", "利润率", `${currency}单价`, "金额（人民币 / 付款币种）", "逐项理货要求", "仓库备注", ""].map((head) => <th key={head} className="p-2">{head}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={index} className="border-t">
        <td className="p-2">{index + 1}</td>{(["item_name", "brand", "model", "quality", "description", "description_zh"] as const).map((key) => <td key={key} className="p-2"><input aria-label={`第${index + 1}行${key}`} className={`${field} min-w-24`} value={item[key]} onChange={(event) => editLine(index, key, event.target.value)} /></td>)}
        <td className="p-2"><input aria-label={`第${index + 1}行数量`} className={`${field} w-20`} type="number" min="1" step="1" value={item.quantity} onChange={(event) => editLine(index, "quantity", Number(event.target.value))} /></td>
        <td className="p-2"><input aria-label={`第${index + 1}行人民币单价`} className={`${field} w-28`} type="number" min="0" step="0.01" value={item.unit_price_cny} onChange={(event) => editLine(index, "unit_price_cny", Number(event.target.value))} /></td>
        <td className="p-2"><input aria-label={`第${index + 1}行预估成本`} className={`${field} w-28`} type="number" min="0" step="0.01" value={item.estimated_unit_cost_cny < 0 ? "" : item.estimated_unit_cost_cny} onChange={(event) => editLine(index, "estimated_unit_cost_cny", event.target.value === "" ? -1 : Number(event.target.value))} /></td>
        <td className={`p-2 font-medium ${item.unit_price_cny > 0 && item.estimated_unit_cost_cny > item.unit_price_cny ? "text-rose-600" : "text-emerald-700"}`}>{item.unit_price_cny > 0 && item.estimated_unit_cost_cny >= 0 ? `${((item.unit_price_cny - item.estimated_unit_cost_cny) / item.unit_price_cny * 100).toFixed(2)}%` : "—"}</td>
        <td className="p-2">{effectiveRate > 0 ? roundMoney(item.unit_price_cny * effectiveRate).toFixed(2) : "—"}</td>
        <td className="p-2 whitespace-nowrap">¥{roundMoney(item.quantity * item.unit_price_cny).toFixed(2)} / {currency} {effectiveRate > 0 ? roundMoney(item.quantity * roundMoney(item.unit_price_cny * effectiveRate)).toFixed(2) : "—"}</td>
        <td className="p-2"><input aria-label={`第${index + 1}行理货要求`} className={`${field} min-w-32`} value={item.preparation_requirement} onChange={(event) => editLine(index, "preparation_requirement", event.target.value)} /></td>
        <td className="p-2"><input aria-label={`第${index + 1}行仓库备注`} className={`${field} min-w-32`} value={item.internal_note} onChange={(event) => editLine(index, "internal_note", event.target.value)} /></td>
        <td className="p-2"><button type="button" aria-label={`删除第${index + 1}行`} disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, position) => position !== index))} className="text-rose-600 disabled:opacity-30"><Trash2 size={16} /></button></td>
      </tr>)}</tbody></table></div>
    </section>
    <section className="grid gap-4 rounded-xl border bg-white p-5 md:grid-cols-2"><label className="text-sm">人民币运费<input className={field} type="number" min="0" step="0.01" value={shippingCny} onChange={(event) => setShippingCny(Number(event.target.value))} /></label><label className="text-sm">给仓库的特殊备货要求（选填）<input className={field} value={stockingRequirements} onChange={(event) => setStockingRequirements(event.target.value)} placeholder="无特殊要求时按PI明细常规备货" /></label>
      <div className="text-sm md:col-span-2">人民币：产品 ¥{totals.subtotalCny.toFixed(2)} + 运费 ¥{shippingCny.toFixed(2)} = <b>¥{roundMoney(totals.subtotalCny + shippingCny).toFixed(2)}</b><br />{currency}：产品 {totals.subtotalPayment.toFixed(2)} + 运费 {totals.shippingPayment.toFixed(2)} = <b>{roundMoney(totals.subtotalPayment + totals.shippingPayment).toFixed(2)}</b></div>
    </section>
    <div className="flex justify-end"><button type="button" disabled={busy || loadingDraft || !availableAccounts.length} onClick={() => void create()} className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "保存中，请勿重复提交…" : "保存PI草稿"}</button></div>
  </div></main>;
}
