"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, Copy, FileDown, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import { QUOTE_CURRENCIES } from "@/lib/currencies";
import { AppSelect } from "@/components/ui/app-select";
import { AppDialog, ConfirmDialog } from "@/components/ui/app-dialog";
import { cnyPerPayment as inverseRate, paymentPerCny } from "@/lib/pi-exchange-rate-math";
import { countryInfo } from "@/lib/countries";
import { validPiMoney, validPiQuantity, validPiSellingPrice } from "@/lib/pi-line-values";
import { numberedPiChangeNote } from "@/lib/pi-change-note";
import type { ImportedPiDocument } from "@/lib/pi-document-import";

type Customer = { id: string; company_name: string; country?: string | null; contact_name?: string | null; phone?: string | null; email?: string | null; address?: string | null };
type Account = { id: string; label: string; currency: string; instructions: string; active?: boolean };
type ExchangeRate = { currency: string; business_cny: number | null; source: string; reference_date: string | null };
type Line = { item_name: string; brand: string; model: string; quality: string; description: string; description_zh: string; quantity: string; unit_price_cny: string; estimated_unit_cost_cny: string; preparation_requirement: string; internal_note: string };
const newLine = (): Line => ({ item_name: "", brand: "", model: "", quality: "", description: "", description_zh: "", quantity: "1", unit_price_cny: "", estimated_unit_cost_cny: "", preparation_requirement: "", internal_note: "" });
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const normalizeCustomerName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const defaultValidity = () => { const date = new Date(); date.setDate(date.getDate() + 5); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const field = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none";
const importHeaders = ["产品", "品牌", "型号", "质量", "产品描述", "成本（RMB）", "售价（RMB）", "数量", "理货要求", "备注"];
const Required = () => <span aria-hidden="true" className="font-semibold text-rose-600"> *</span>;
function PiLineTextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} aria-label={label} rows={1} className="min-h-9 w-full min-w-28 resize-y rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs leading-5 focus:border-blue-500 focus:outline-none" value={value} onChange={(event) => onChange(event.target.value.replace(/\s*\n+\s*/g, " "))} />;
}
const PAYMENT_CHANNELS = ["T/T Bank Transfer", "Alipay", "PayPal", "Wise Transfer", "Payoneer Transfer"] as const;

export function PiOrderForm({ initialCustomerId = "", draftOrderId, importDraftId }: { initialCustomerId?: string; draftOrderId?: string; importDraftId?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [canManageAccounts, setCanManageAccounts] = useState(false);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [warehouseReferenceNumber, setWarehouseReferenceNumber] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState("");
  const [shippingInput, setShippingInput] = useState("0.00");
  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_CHANNELS[0]);
  const [customPaymentMethod, setCustomPaymentMethod] = useState("");
  const [validUntil, setValidUntil] = useState(defaultValidity);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [recipient, setRecipient] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [stockingRequirements, setStockingRequirements] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [initialChangeNote, setInitialChangeNote] = useState("");
  const [recalledDraft, setRecalledDraft] = useState(false);
  const [canSubmitDraft, setCanSubmitDraft] = useState(true);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [savedDraftId, setSavedDraftId] = useState("");
  const [items, setItems] = useState<Line[]>([newLine()]);
  const [confirmClearItems, setConfirmClearItems] = useState(false);
  const [showAccountDetails, setShowAccountDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(draftOrderId || importDraftId));
  const [importSource, setImportSource] = useState<ImportedPiDocument | null>(null);
  const [importRevision, setImportRevision] = useState(0);
  const [importDifferences, setImportDifferences] = useState<string[]>([]);
  const [submitAfterImportDifferences, setSubmitAfterImportDifferences] = useState(false);
  const [revision, setRevision] = useState(1);
  const [error, setError] = useState("");
  const hasUnsavedChanges = useRef(false);
  const [pendingLeaveUrl, setPendingLeaveUrl] = useState("");
  const [pendingHistoryBack, setPendingHistoryBack] = useState(false);
  const selectedAccount = accounts.find((item) => item.id === accountId);
  const availableAccounts = accounts.filter((item) => item.active !== false);
  const cnyPerPayment = Number(rate);
  const effectiveRate = paymentPerCny(cnyPerPayment);
  const shippingCny = Number(shippingInput);
  const selectedCustomer = customers.find((item) => item.id === customerId);
  const totals = useMemo(() => {
    const subtotalCny = roundMoney(items.reduce((sum, item) => sum + Number(item.quantity || 0) * Math.max(0, Number(item.unit_price_cny || 0)), 0));
    const subtotalPayment = roundMoney(items.reduce((sum, item) => sum + Number(item.quantity || 0) * roundMoney(Math.max(0, Number(item.unit_price_cny || 0)) * effectiveRate), 0));
    const totalProfitCny = items.every((item) => validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && validPiQuantity(item.quantity))
      ? roundMoney(items.reduce((sum, item) => sum + Number(item.quantity) * (Number(item.unit_price_cny) - Number(item.estimated_unit_cost_cny)), 0)) : null;
    return { subtotalCny, subtotalPayment, totalProfitCny, shippingPayment: roundMoney(shippingCny * effectiveRate) };
  }, [items, shippingCny, effectiveRate]);

  function markUnsaved() {
    if (hasUnsavedChanges.current) return;
    hasUnsavedChanges.current = true;
    // A same-URL history entry lets browser Back be intercepted before Next.js unmounts the form.
    window.history.pushState({ piUnsavedGuard: true }, "", window.location.href);
  }

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const interceptLink = (event: MouseEvent) => {
      if (!hasUnsavedChanges.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target && anchor.target !== "_self" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingLeaveUrl(destination.href);
    };
    const interceptBack = () => {
      if (!hasUnsavedChanges.current) return;
      window.history.pushState({ piUnsavedGuard: true }, "", window.location.href);
      setPendingHistoryBack(true);
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", interceptLink, true);
    window.addEventListener("popstate", interceptBack);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", interceptLink, true);
      window.removeEventListener("popstate", interceptBack);
    };
  }, []);

  useEffect(() => {
    if (error) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [error]);

  useEffect(() => {
    void (async () => {
      try {
      const [customersResponse, accountsResponse, ratesResponse, draftResponse, importResponse] = await Promise.all([
        fetch("/api/orders/pi-customers", { cache: "no-store" }),
        fetch("/api/pi-payment-accounts", { cache: "no-store" }),
        fetch("/api/pi-exchange-rates", { cache: "no-store" }),
        draftOrderId ? fetch(`/api/orders/${draftOrderId}`, { cache: "no-store" }) : Promise.resolve(null),
        importDraftId ? fetch(`/api/orders/import-drafts/${importDraftId}`, { cache: "no-store" }) : Promise.resolve(null),
      ]);
      const [customerBody, accountBody, ratesBody, draftBody, importBody] = await Promise.all([customersResponse.json().catch(() => ({})), accountsResponse.json().catch(() => ({})), ratesResponse.json().catch(() => ({})), draftResponse?.json().catch(() => ({})) || Promise.resolve(null), importResponse?.json().catch(() => ({})) || Promise.resolve(null)]);
      if (!customersResponse.ok || !accountsResponse.ok || (draftResponse && !draftResponse.ok) || (importResponse && !importResponse.ok)) {
        setError(customerBody.error || accountBody.error || draftBody?.error || importBody?.error || "PI基础资料加载失败");
        setLoadingDraft(false);
        return;
      }
      const listed = (customerBody.data || []) as Customer[];
      const exact = initialCustomerId ? listed.find((item) => item.id === initialCustomerId) : null;
      setCustomers(listed);
      if (initialCustomerId && !exact && !draftOrderId) { setCustomerId(""); setError("该客户当前不归属您，不能为其创建PI订单"); }
      if (exact) { setRecipient(exact.contact_name?.trim() || exact.company_name); setPhone(exact.phone || ""); setEmail(exact.email || ""); setAddress(exact.address || ""); }
      setAccounts(accountBody.data || []);
      if (ratesResponse.ok) {
        setExchangeRates(ratesBody.rates || []);
        if (!draftOrderId && ratesBody.rates?.find((item: ExchangeRate) => item.currency === "USD")?.business_cny > 0) setRate(String(ratesBody.rates.find((item: ExchangeRate) => item.currency === "USD").business_cny));
      }
      setCanManageAccounts(Boolean(accountBody.can_manage));
      if (importResponse) {
        if (importBody.data?.status !== "PENDING") { setError("该导入草稿已转换或不可补全"); setLoadingDraft(false); return; }
        const source = importBody.data.payload as ImportedPiDocument;
        if (!source || !Array.isArray(source.items) || !source.items.length) { setError("导入草稿内容无效，请重新导入"); setLoadingDraft(false); return; }
        setImportSource(source);
        setImportRevision(importBody.data.revision);
        setWarehouseReferenceNumber(source.warehouse_reference_number);
        setCurrency(source.currency);
        const importedRate = Number(ratesBody.rates?.find((item: ExchangeRate) => item.currency === source.currency)?.business_cny || 0);
        setRate(importedRate > 0 ? String(importedRate) : "");
        if (importedRate > 0) setShippingInput(roundMoney(source.shipping_payment * importedRate).toFixed(2));
        const companyName = normalizeCustomerName(source.delivery_company);
        const exactCustomerMatches = companyName ? listed.filter((customer) => normalizeCustomerName(customer.company_name) === companyName) : [];
        if (exactCustomerMatches.length === 1) setCustomerId(exactCustomerMatches[0].id);
        if (source.payment_method) {
          if (PAYMENT_CHANNELS.some((method) => method === source.payment_method)) setPaymentMethod(source.payment_method);
          else { setPaymentMethod("OTHER"); setCustomPaymentMethod(source.payment_method); }
        }
        setDeliveryDate(source.delivery_date);
        setRecipient(source.delivery_recipient);
        setPhone(source.delivery_phone);
        setEmail(source.delivery_email);
        setAddress(source.delivery_address);
        setItems(source.items.map((item) => ({ ...newLine(), item_name: item.item_name, brand: item.brand,
          model: item.model, quality: item.quality, description: item.description, quantity: String(item.quantity),
          unit_price_cny: importedRate > 0 ? roundMoney(item.unit_price_payment * importedRate).toFixed(2) : "" })));
        setLoadingDraft(false);
      }
      if (draftResponse) {
        if (!draftBody.can_edit_draft) { setError("当前PI订单不是可编辑草稿"); setLoadingDraft(false); return; }
        const order = draftBody.order;
        setRevision(order.pi_revision);
        setCustomerId(order.customer_id);
        setWarehouseReferenceNumber(order.warehouse_reference_number || "");
        if (!listed.some((item) => item.id === order.customer_id)) {
          setCustomers((current) => [{ id: order.customer_id, company_name: order.customer?.company_name || order.customer_short_name, country: order.destination_country }, ...current]);
        }
        setCurrency(order.currency);
        setRate(String(inverseRate(Number(order.fx_rate_cny_to_payment))));
        setShippingInput(Number(order.shipping_cny).toFixed(2));
        setAccountId(order.payment_account_id || "");
        const storedMethod = String(order.payment_method || "").trim();
        if (PAYMENT_CHANNELS.some((method) => method === storedMethod)) setPaymentMethod(storedMethod);
        else if (storedMethod) { setPaymentMethod("OTHER"); setCustomPaymentMethod(storedMethod); }
        setValidUntil(order.pi_valid_until || "");
        setDeliveryDate(order.delivery_date || "");
        const draftCustomer = listed.find((item) => item.id === order.customer_id);
        setRecipient(order.delivery_recipient || draftCustomer?.contact_name?.trim() || draftCustomer?.company_name || order.customer?.company_name || order.customer_short_name || "");
        setPhone(order.delivery_phone || "");
        setEmail(order.delivery_email || "");
        setAddress(order.delivery_address || "");
        setStockingRequirements(draftBody.stocking_requirements || "");
        setChangeNote(draftBody.order.confirmation_note || "");
        setInitialChangeNote(draftBody.order.confirmation_note || "");
        setRecalledDraft(draftBody.stock_order?.status === "DRAFT");
        setCanSubmitDraft(Boolean(draftBody.can_submit));
        setItems((draftBody.items || []).map((item: Line) => ({
          item_name: item.item_name || "", brand: item.brand || "", model: item.model || "", quality: item.quality || "",
          description: item.description || "", description_zh: item.description_zh || "", quantity: String(item.quantity),
          unit_price_cny: String(item.unit_price_cny), estimated_unit_cost_cny: String(item.estimated_unit_cost_cny),
          preparation_requirement: item.preparation_requirement || "", internal_note: item.internal_note || "",
        })));
        setLoadingDraft(false);
      }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "PI基础资料加载失败，请刷新重试");
        setLoadingDraft(false);
      }
    })();
  }, [initialCustomerId, draftOrderId, importDraftId]);

  function chooseCustomer(id: string) {
    if (id !== customerId) markUnsaved();
    setCustomerId(id);
    const customer = customers.find((item) => item.id === id);
    if (!customer) return;
    setRecipient(customer.contact_name?.trim() || customer.company_name);
    setPhone(customer.phone || "");
    setEmail(customer.email || "");
    setAddress(customer.address || "");
  }
  function editLine(index: number, key: keyof Line, value: string) {
    if (items[index]?.[key] !== value) markUnsaved();
    setItems((current) => current.map((item, position) => position === index ? { ...item, [key]: value } : item));
  }
  function importRows(rows: unknown[][]) {
    const cells = rows.map((row) => row.map((value) => String(value ?? "").trim())).filter((row) => row.some(Boolean));
    const legacy = cells[0]?.[0] === "产品名称";
    if (cells[0]?.[0] === importHeaders[0] || legacy) cells.shift();
    if (!cells.length || cells.length > 500) throw new Error("请导入1至500条产品明细");
    const imported = cells.map((row, index) => {
      const quantity = Number(row[legacy ? 6 : 7]);
      const unitPrice = Number(row[legacy ? 7 : 6]);
      const cost = Number(row[legacy ? 8 : 5]);
      if (!row[0] || !row[1] || !row[2] || !row[3] || !validPiQuantity(row[legacy ? 6 : 7]) || !validPiMoney(row[legacy ? 7 : 6]) || !validPiMoney(row[legacy ? 8 : 5])) {
        throw new Error(`第${index + 1}行须填写产品、品牌、型号、质量、整数数量、人民币成本和售价（金额最多两位小数）`);
      }
      if (!validPiSellingPrice(row[legacy ? 7 : 6], row[legacy ? 8 : 5])) throw new Error(`第${index + 1}行人民币售价必须高于成本价`);
      return { ...newLine(), item_name: row[0], brand: row[1] || "", model: row[2] || "", quality: row[3] || "",
        description: row[4] || "", description_zh: legacy ? row[5] : "", quantity: String(quantity), unit_price_cny: String(unitPrice),
        estimated_unit_cost_cny: String(cost), preparation_requirement: row[legacy ? 9 : 8] || "", internal_note: legacy ? "" : row[9] || "" };
    });
    if (items.filter((item) => item.item_name.trim()).length + imported.length > 500) throw new Error("每张PI最多500条产品，请分批处理");
    setItems((current) => [...current.filter((item) => item.item_name.trim()), ...imported]);
    markUnsaved();
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
  async function create(submitToWarehouse = false, acknowledgeDifferences = false) {
    if (busy) return;
    if (savedDraftId && !draftOrderId) { setError("当前PI草稿已保存，请先进入详情核对，避免重复创建"); return; }
    setError("");
    if (!customerId || !warehouseReferenceNumber.trim() || !currency || !accountId || !Number.isFinite(cnyPerPayment) || cnyPerPayment <= 0) {
      setError("请选择客户、填写订单编号、付款币种、收款账户及正数汇率"); return;
    }
    if (!shippingInput.trim() || !Number.isFinite(shippingCny) || shippingCny < 0 || shippingCny > 999999999999 || !/^\d+(?:\.\d{1,2})?$/.test(shippingInput)) {
      setError("请输入非负且最多两位小数的人民币运费"); return;
    }
    if (!recipient.trim() || !phone.trim() || !email.trim() || !address.trim()) {
      setError("请填写收件人、电话、邮箱和收货地址；这四项是PI收货必填信息"); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("请输入有效的收货邮箱地址"); return; }
    const invalidRow = items.findIndex((item) => !item.item_name.trim() || !item.brand.trim() || !item.model.trim() || !item.quality.trim() || !validPiQuantity(item.quantity) || !validPiMoney(item.unit_price_cny) || !validPiMoney(item.estimated_unit_cost_cny));
    if (invalidRow >= 0) {
      setError(`第${invalidRow + 1}行请填写产品、品牌、型号、质量、正整数数量，以及最多两位小数的非负人民币成本和售价`); return;
    }
    const losingRow = items.findIndex((item) => !validPiSellingPrice(item.unit_price_cny, item.estimated_unit_cost_cny));
    if (losingRow >= 0) { setError(`第${losingRow + 1}行售价必须高于成本价，请调整后再保存`); return; }
    const chosenPaymentMethod = paymentMethod === "OTHER" ? customPaymentMethod.trim() : paymentMethod;
    if (!chosenPaymentMethod || chosenPaymentMethod.length > 300) { setError("请填写有效的客户付款渠道"); return; }
    const formattedChangeNote = numberedPiChangeNote(changeNote);
    if (formattedChangeNote.length > 2000) { setError("订单变更说明最多2000字"); return; }
    let justSavedId = "";
    setBusy(true);
    try {
      const response = await fetch(importDraftId ? `/api/orders/import-drafts/${importDraftId}/convert` : draftOrderId ? `/api/orders/${draftOrderId}/draft` : "/api/orders/create-pi", {
        method: draftOrderId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId, warehouse_reference_number: warehouseReferenceNumber.trim(), currency, fx_rate_cny_to_payment: effectiveRate, shipping_cny: shippingCny,
          payment_method: chosenPaymentMethod, payment_account_id: accountId, valid_until: validUntil, delivery_date: deliveryDate,
          delivery_recipient: recipient, delivery_phone: phone, delivery_email: email, delivery_address: address,
          stocking_requirements: stockingRequirements, items: items.map((item) => ({ ...item, quantity: Number(item.quantity), unit_price_cny: Number(item.unit_price_cny), estimated_unit_cost_cny: Number(item.estimated_unit_cost_cny) })), revision,
          import_revision: importRevision, acknowledge_differences: acknowledgeDifferences }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && importDraftId && Array.isArray(body.differences)) { setSubmitAfterImportDifferences(submitToWarehouse); setImportDifferences(body.differences); return; }
      if (!response.ok) { setError(body.error || "PI订单创建失败"); return; }
      setImportDifferences([]);
      const saved = body.data as { id: string; pi_revision: number };
      justSavedId = saved.id;
      setSavedDraftId(saved.id);
      let currentRevision = saved.pi_revision;
      if (formattedChangeNote !== initialChangeNote) {
        const noteResponse = await fetch(`/api/orders/${saved.id}/change-note`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: currentRevision, note: formattedChangeNote }),
        });
        const noteBody = await noteResponse.json().catch(() => ({}));
        if (!noteResponse.ok) { setError(`${noteBody.error || "订单变更说明保存失败"}；PI草稿已保存，请进入草稿核对`); return; }
        currentRevision = noteBody.data.pi_revision;
      }
      if (submitToWarehouse) {
        const submitResponse = await fetch(`/api/orders/${saved.id}/submit`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: currentRevision }),
        });
        const submitBody = await submitResponse.json().catch(() => ({}));
        if (!submitResponse.ok) { setError(`${submitBody.error || "提交仓库失败"}；PI草稿已保存，请进入详情核对后重试`); return; }
      }
      hasUnsavedChanges.current = false;
      window.location.assign(`/orders/${saved.id}`);
    } catch { setError(justSavedId ? "网络异常，草稿可能已保存或提交；请先进入详情核对，勿重复创建" : "网络异常，未确认创建结果；请先检查PI订单列表，避免重复提交"); }
    finally { setBusy(false); }
  }

  return <main className="p-4 lg:p-6" onInputCapture={(event) => { if (!(event.target as HTMLElement).hasAttribute("readonly")) markUnsaved(); }}><div className="mx-auto max-w-[1500px] space-y-5">
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h1 className="text-xl font-bold">{importDraftId ? "核对并补全导入PI" : draftOrderId ? "编辑PI草稿" : "创建PI订单"}</h1><p className="mt-1 text-sm text-slate-500">{importDraftId ? "请关联本人客户，补齐人民币售价与成本、汇率及收款账户；先生成PI草稿，核对后再提交仓库。" : "客户与价格只录入一次；保存草稿后核对，确认后生成仓库备货单。"}</p></div><Link href={importDraftId ? "/orders/import" : draftOrderId ? `/orders/${draftOrderId}` : "/orders"} className="inline-flex h-9 items-center rounded-lg border bg-white px-3 text-sm hover:bg-slate-50">返回</Link></header>
    {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}{savedDraftId ? <> · <Link className="font-semibold underline" href={`/orders/${savedDraftId}`}>查看已保存PI</Link></> : null}</div> : null}
    {importSource ? <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">原Excel：{importSource.warehouse_reference_number} · {importSource.currency} {importSource.total_payment.toFixed(2)}（含运费 {importSource.shipping_payment.toFixed(2)}）。{selectedCustomer && normalizeCustomerName(selectedCustomer.company_name) === normalizeCustomerName(importSource.delivery_company) ? "客户已按PI公司名称精确匹配，请确认。" : "请从本人客户中选择与PI公司名称一致的客户。"}人民币售价和运费{effectiveRate > 0 ? "已按当前业务汇率自动折算，可核对调整" : "需在汇率可用后折算"}；预估成本及收款账户需补充。与原文件金额不一致时会要求逐项确认。</div> : null}
    <section className="border-b border-slate-100 p-5"><h2 className="mb-4 font-semibold">PI基本信息</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <label className="text-sm">客户名称<Required /><AppSelect className={field} aria-label="搜索并选择我的PI客户" forceSearch placeholderValue="" disabled={Boolean(draftOrderId)} value={customerId} onChange={(event) => chooseCustomer(event.target.value)}><option value="">请选择我的客户</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.company_name}</option>)}</AppSelect></label>
      <label className="text-sm">目的国家<input className={`${field} bg-slate-50 text-slate-600`} value={selectedCustomer?.country ? countryInfo(selectedCustomer.country).name : "客户档案未填写"} readOnly aria-readonly="true" title="从所选客户档案自动带入" /></label>
      <label className="text-sm">订单编号<Required /><input className={field} maxLength={80} value={warehouseReferenceNumber} onChange={(event) => setWarehouseReferenceNumber(event.target.value)} placeholder="例如 D60020733；不可与其他PI重复" /></label>
      <label className="text-sm">客户付款币种<Required /><AppSelect className={field} aria-label="搜索并选择客户付款币种" value={currency} onChange={(event) => { if (event.target.value !== currency) markUnsaved(); setCurrency(event.target.value); setRate(String(exchangeRates.find((item) => item.currency === event.target.value)?.business_cny || "")); }}><option value="">请选择</option>{QUOTE_CURRENCIES.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}</AppSelect></label>
      <label className="text-sm">汇率：1 {currency || "付款币种"} = 多少人民币<Required /><input className={field} type="number" min="0.000001" step="0.000001" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="例如 7.200000" />{exchangeRates.find((item) => item.currency === currency)?.business_cny ? <span className="text-xs text-slate-500">已带入业务汇率，可按本单调整</span> : null}</label>
      <label className="text-sm">PI有效期<Required /><input className={`${field} cursor-pointer`} type="date" value={validUntil} onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* Keep native typing when the picker is unavailable. */ } }} onChange={(event) => setValidUntil(event.target.value)} /></label>
      <label className="text-sm">预计交付日期<input className={`${field} cursor-pointer`} type="date" value={deliveryDate} onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* Keep native typing when the picker is unavailable. */ } }} onChange={(event) => setDeliveryDate(event.target.value)} /></label>
      <div className="text-sm"><label>付款渠道<AppSelect className={field} value={paymentMethod} onChange={(event) => { if (event.target.value !== paymentMethod) markUnsaved(); setPaymentMethod(event.target.value); }}>{PAYMENT_CHANNELS.map((method) => <option key={method} value={method}>{method}</option>)}<option value="OTHER">其他渠道（手工填写）</option></AppSelect></label>{paymentMethod === "OTHER" ? <input aria-label="其他付款渠道" className={`${field} mt-2`} maxLength={300} value={customPaymentMethod} onChange={(event) => setCustomPaymentMethod(event.target.value)} placeholder="填写实际收款渠道" /> : null}</div>
      <div className="text-sm"><label>收款账户<Required /><AppSelect className={field} aria-label="选择PI收款账户" placeholderValue="" value={accountId} onChange={(event) => { if (event.target.value !== accountId) markUnsaved(); setAccountId(event.target.value); }}><option value="">{availableAccounts.length ? "请选择管理员预设账户" : "尚无启用的收款账户"}</option>{availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</AppSelect></label>{selectedAccount ? <button type="button" onClick={() => setShowAccountDetails(true)} className="mt-1 text-xs font-medium text-blue-700 underline">查看账户详情</button> : null}{!availableAccounts.length ? <span className="mt-1 block text-xs text-amber-700">{canManageAccounts ? <><Link href="/settings/pi-payment-accounts" className="underline">先配置并启用真实收款账户</Link>，再返回创建PI。</> : "请联系系统管理员配置并启用收款账户后再创建PI。"}</span> : null}</div>
    </div></section>
    <section className="border-b border-slate-100 p-5"><h2 className="mb-4 font-semibold">客户及收货信息</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm">收件人<Required /><input className={field} required maxLength={200} value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>
      <label className="text-sm">电话<Required /><input className={field} required maxLength={100} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
      <label className="text-sm">邮箱<Required /><input className={field} type="email" required maxLength={200} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="text-sm">收货地址<Required /><input className={field} required maxLength={1000} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
    </div></section>
    <section className="p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">PI产品明细</h2><p className="mt-1 text-xs text-slate-500">人民币销售价与成本分别填写；质量与描述按录入原文用于单据，表格可横向滚动。</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void downloadTemplate()} className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm text-blue-700"><FileDown size={16} />下载模板</button><input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => void importExcel(event.target.files?.[0])} /><button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm"><FileSpreadsheet size={16} />导入Excel</button><button type="button" onClick={() => void pasteRows()} className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm"><ClipboardPaste size={16} />粘贴表格</button><button type="button" onClick={() => { if (items.length < 500) { markUnsaved(); setItems((current) => [...current, newLine()]); } }} className="inline-flex h-9 items-center gap-1 rounded-lg bg-blue-50 px-3 text-sm text-blue-700"><Plus size={16} />添加产品</button><button type="button" onClick={() => setConfirmClearItems(true)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-rose-200 px-3 text-sm text-rose-700"><Trash2 size={16} />清空明细</button></div></div>
      <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[1600px] text-left text-xs"><thead className="bg-slate-50/70"><tr>{["序号", "产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "成本单价（人民币） *", "销售单价（人民币） *", "数量 *", "销售金额（人民币）", "总利润（人民币）", "利润率", "理货要求", "仓库备注", "操作"].map((head) => <th key={head} className="whitespace-nowrap px-2 py-3 font-medium">{head.endsWith(" *") ? <>{head.slice(0, -2)}<Required /></> : head}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={index} className="border-t border-slate-100 align-middle">
        <td className="px-2 py-1.5">{index + 1}</td>
        {(["item_name", "brand", "model", "quality", "description"] as const).map((key) => <td key={key} className="px-1.5 py-1.5"><PiLineTextArea label={`第${index + 1}行${({ item_name: "产品类型", brand: "产品品牌", model: "产品型号", quality: "产品质量", description: "产品描述" } as const)[key]}`} value={item[key]} onChange={(value) => editLine(index, key, value)} /></td>)}
        <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行预估成本`} className={`${field} h-9 w-28`} type="text" inputMode="decimal" maxLength={15} value={item.estimated_unit_cost_cny} onChange={(event) => { if (event.target.value === "" || /^(?:0|[1-9]\d{0,11})(?:\.\d{0,2})?$/.test(event.target.value)) editLine(index, "estimated_unit_cost_cny", event.target.value); }} /></td>
        <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行人民币单价`} className={`${field} h-9 w-28 ${validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && !validPiSellingPrice(item.unit_price_cny, item.estimated_unit_cost_cny) ? "border-rose-400" : ""}`} type="text" inputMode="decimal" maxLength={15} value={item.unit_price_cny} onChange={(event) => { if (event.target.value === "" || /^(?:0|[1-9]\d{0,11})(?:\.\d{0,2})?$/.test(event.target.value)) editLine(index, "unit_price_cny", event.target.value); }} />{validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && !validPiSellingPrice(item.unit_price_cny, item.estimated_unit_cost_cny) ? <span className="block text-[11px] text-rose-600">售价必须高于成本</span> : null}<span className="mt-1 block whitespace-nowrap rounded bg-blue-50 px-1.5 py-1 text-[11px] font-medium text-blue-700">{effectiveRate > 0 && validPiMoney(item.unit_price_cny) ? `客户单价 ${currency} ${roundMoney(Number(item.unit_price_cny) * effectiveRate).toFixed(2)}` : "客户单价待换算"}</span></td>
        <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行数量`} className={`${field} h-9 w-20`} type="text" inputMode="numeric" maxLength={10} value={item.quantity} onChange={(event) => { if (event.target.value === "" || /^[1-9]\d{0,9}$/.test(event.target.value)) editLine(index, "quantity", event.target.value); }} />{importSource?.items[index] ? <span className="mt-1 block whitespace-nowrap text-[11px] text-amber-700">原单价 {currency} {importSource.items[index].unit_price_payment.toFixed(2)}</span> : null}</td>
        <td className="whitespace-nowrap px-2 py-1.5"><span className="font-medium">{validPiMoney(item.unit_price_cny) && validPiQuantity(item.quantity) ? `¥${roundMoney(Number(item.quantity) * Number(item.unit_price_cny)).toFixed(2)}` : "—"}</span><span className="mt-1 block rounded bg-blue-50 px-1.5 py-1 text-[11px] font-medium text-blue-700">{effectiveRate > 0 && validPiMoney(item.unit_price_cny) && validPiQuantity(item.quantity) ? `客户金额 ${currency} ${roundMoney(roundMoney(Number(item.unit_price_cny) * effectiveRate) * Number(item.quantity)).toFixed(2)}` : "客户金额待换算"}</span></td>
        <td className={`whitespace-nowrap px-2 py-1.5 ${validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && !validPiSellingPrice(item.unit_price_cny, item.estimated_unit_cost_cny) ? "text-rose-600" : ""}`}>{validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && validPiQuantity(item.quantity) ? `¥${roundMoney((Number(item.unit_price_cny) - Number(item.estimated_unit_cost_cny)) * Number(item.quantity)).toFixed(2)}` : "—"}</td>
        <td className={`whitespace-nowrap px-2 py-1.5 font-medium ${validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && !validPiSellingPrice(item.unit_price_cny, item.estimated_unit_cost_cny) ? "text-rose-600" : "text-emerald-700"}`}>{validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && Number(item.unit_price_cny) > 0 ? `${((Number(item.unit_price_cny) - Number(item.estimated_unit_cost_cny)) / Number(item.unit_price_cny) * 100).toFixed(2)}%` : "—"}</td>
        <td className="px-1.5 py-1.5"><PiLineTextArea label={`第${index + 1}行理货要求`} value={item.preparation_requirement} onChange={(value) => editLine(index, "preparation_requirement", value)} /></td>
        <td className="px-1.5 py-1.5"><PiLineTextArea label={`第${index + 1}行仓库备注`} value={item.internal_note} onChange={(value) => editLine(index, "internal_note", value)} /></td>
        <td className="px-2 py-1.5"><div className="flex gap-2"><button type="button" title="复制该产品行" aria-label={`复制第${index + 1}行`} disabled={items.length >= 500} onClick={() => { markUnsaved(); setItems((current) => [...current.slice(0, index + 1), { ...current[index] }, ...current.slice(index + 1)]); }} className="text-blue-600 disabled:opacity-30"><Copy size={16} /></button><button type="button" title="删除该产品行" aria-label={`删除第${index + 1}行`} disabled={items.length === 1} onClick={() => { markUnsaved(); setItems((current) => current.filter((_, position) => position !== index)); }} className="text-rose-600 disabled:opacity-30"><Trash2 size={16} /></button></div></td>
      </tr>)}</tbody></table></div>
      <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm" aria-live="polite"><span>产品总金额（RMB）：<strong>¥{totals.subtotalCny.toFixed(2)}</strong></span><span>产品总利润（RMB）：<strong className={totals.totalProfitCny !== null && totals.totalProfitCny < 0 ? "text-rose-600" : ""}>{totals.totalProfitCny === null ? "待填写成本" : `¥${totals.totalProfitCny.toFixed(2)}`}</strong></span><span>产品总利润率：<strong className={totals.totalProfitCny !== null && totals.totalProfitCny < 0 ? "text-rose-600" : ""}>{totals.totalProfitCny === null ? "待填写成本" : totals.subtotalCny > 0 ? `${(totals.totalProfitCny / totals.subtotalCny * 100).toFixed(2)}%` : "—"}</strong></span></div>
    </section>
    <section className="grid gap-4 border-t border-slate-100 p-5 lg:grid-cols-[minmax(0,1fr)_auto]"><div className={`grid gap-3 ${recalledDraft ? "lg:grid-cols-2" : ""}`}>{recalledDraft ? <div><label className="text-sm">订单变更说明（选填）<textarea className={`${field} min-h-24 py-2`} rows={3} maxLength={2000} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="每行填写一项变更，保存后自动按 1、2、3 编号" /></label>{changeNote.trim() ? <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-500">{numberedPiChangeNote(changeNote)}</p> : null}</div> : null}<label className="text-sm">理货要求（选填）<textarea className={`${field} min-h-24 py-2`} rows={3} maxLength={2000} value={stockingRequirements} onChange={(event) => setStockingRequirements(event.target.value)} placeholder="本栏位详细说明标签/印章/保护膜等作业的要求，无要求则备注常规理货" /></label></div>
      <div className="min-w-72 rounded-lg bg-slate-50 p-3 text-sm"><h2 className="font-semibold text-slate-900">PI费用汇总</h2><div className="mt-2 grid grid-cols-[auto_auto_auto] items-center gap-x-3 gap-y-1 text-right text-slate-600"><span></span><span>RMB</span><span>{currency}</span><span className="text-left">产品小计</span><span>¥{totals.subtotalCny.toFixed(2)}</span><span>{totals.subtotalPayment.toFixed(2)}</span><label htmlFor="pi-shipping" className="text-left">运费</label><div className="relative min-w-0"><span aria-hidden="true" className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-slate-500">¥</span><input id="pi-shipping" aria-label="人民币运费" className="h-7 w-full min-w-0 border-b border-dashed border-slate-400 bg-transparent pl-3 text-right text-sm outline-none focus:border-blue-600" type="text" inputMode="decimal" value={shippingInput} onChange={(event) => { if (/^\d*(?:\.\d{0,2})?$/.test(event.target.value)) setShippingInput(event.target.value); }} onBlur={() => { if (shippingInput.trim()) setShippingInput(Number(shippingInput).toFixed(2)); }} /></div><span>{totals.shippingPayment.toFixed(2)}</span><span className="border-t pt-2 text-left font-semibold text-slate-900">PI总额</span><span className="border-t pt-2 font-semibold text-slate-900">¥{roundMoney(totals.subtotalCny + shippingCny).toFixed(2)}</span><span className="border-t pt-2 font-semibold text-blue-700">{roundMoney(totals.subtotalPayment + totals.shippingPayment).toFixed(2)}</span></div></div>
    </section>
    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4"><button type="button" disabled={busy || loadingDraft || !availableAccounts.length || Boolean(savedDraftId)} onClick={() => void create()} className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">{busy ? "处理中…" : "保存PI草稿"}</button><button type="button" disabled={busy || loadingDraft || !availableAccounts.length || !canSubmitDraft || Boolean(savedDraftId)} onClick={() => setConfirmSubmit(true)} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50">确认并生成备货单</button></div>
    </div>
    <ConfirmDialog open={pendingLeaveUrl !== ""} title="当前 PI 内容尚未保存" description="离开后，当前尚未保存的填写内容将丢失。建议先保存 PI 草稿。" confirmLabel="放弃填写并离开" danger onCancel={() => setPendingLeaveUrl("")} onConfirm={() => { const url = pendingLeaveUrl; hasUnsavedChanges.current = false; setPendingLeaveUrl(""); window.location.assign(url); }} />
    <ConfirmDialog open={pendingHistoryBack} title="当前 PI 内容尚未保存" description="后退将丢失当前尚未保存的填写内容。建议先保存 PI 草稿。" confirmLabel="放弃填写并后退" danger onCancel={() => setPendingHistoryBack(false)} onConfirm={() => { hasUnsavedChanges.current = false; setPendingHistoryBack(false); window.history.go(-2); }} />
    <ConfirmDialog open={confirmClearItems} title="确认清空产品明细？" description={`当前表单内的 ${items.length} 行产品将清空。已保存的 PI 草稿不会因此立即改变。`} confirmLabel="确认清空" danger onCancel={() => setConfirmClearItems(false)} onConfirm={() => { markUnsaved(); setItems([newLine()]); setConfirmClearItems(false); }} />
    <ConfirmDialog open={confirmSubmit} title="确认提交PI给仓库？" description="系统将先保存当前PI，再生成仓库可见的备货单。提交后不能直接修改产品或价格；仓库未开始备货前可撤回。" confirmLabel="确认并生成备货单" busy={busy} onCancel={() => { if (!busy) setConfirmSubmit(false); }} onConfirm={() => { setConfirmSubmit(false); void create(true); }} />
    <ConfirmDialog open={importDifferences.length > 0} title="导入数据与原Excel不一致" description={importDifferences.join("；") + `。请逐项核对；确认后${submitAfterImportDifferences ? "将保存PI并生成备货单" : "将保存为PI草稿"}。`} confirmLabel={submitAfterImportDifferences ? "已核对，确认生成备货单" : "已核对，保存PI草稿"} busy={busy} onCancel={() => { setImportDifferences([]); setSubmitAfterImportDifferences(false); }} onConfirm={() => { const shouldSubmit = submitAfterImportDifferences; setImportDifferences([]); setSubmitAfterImportDifferences(false); void create(shouldSubmit, true); }} />
    {showAccountDetails && selectedAccount ? <AppDialog title={`${selectedAccount.label} · 收款账户`} description="此账户信息会在保存PI时固化，之后管理员修改账户不会改写已保存的PI。" onClose={() => setShowAccountDetails(false)}><p className="whitespace-pre-wrap break-all text-sm leading-6 text-slate-700">{selectedAccount.instructions}</p></AppDialog> : null}
  </div></main>;
}

