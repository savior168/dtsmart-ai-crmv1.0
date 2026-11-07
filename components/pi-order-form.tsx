"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, Copy, FileDown, FileImage, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import { QUOTE_CURRENCIES } from "@/lib/currencies";
import { AppSelect } from "@/components/ui/app-select";
import { AppDialog, ConfirmDialog } from "@/components/ui/app-dialog";
import { CountryLabel } from "@/components/country-label";
import { cnyPerPayment as inverseRate, paymentPerCny } from "@/lib/pi-exchange-rate-math";
import { validPiMoney, validPiQuantity, validPiSellingPrice } from "@/lib/pi-line-values";
import { linkedPiUnitPrices, type PiUnitPriceSource } from "@/lib/pi-line-currency";
import { calculatePiFees, type PiFeeSource, type PiFeesInput } from "@/lib/pi-fees";
import { PI_PAYMENT_CHANNELS, type PiPaymentChannel } from "@/lib/pi-payment-channel";
import { numberedPiChangeNote } from "@/lib/pi-change-note";
import type { ImportedPiDocument } from "@/lib/pi-document-import";
import { derivePiCnyRate, detectPiPaymentCurrency, hasPiProductHeader, parsePiClipboardTsv, parsePiProductRows } from "@/lib/pi-product-import";
import { displayAddressList, displayShippingContacts, type ShippingContact } from "@/lib/customers/address-list";
import { customerDeliveryMatchesForwarder } from "@/lib/orders/pi-delivery-match";
import { PiRequirementAttachments, type PiRequirementAttachment } from "@/components/pi-requirement-attachments";
import { PI_REQUIREMENT_IMAGE_COUNT_LIMIT_PER_LINE, PI_REQUIREMENT_IMAGE_COUNT_LIMIT_PER_ORDER, PI_REQUIREMENT_IMAGE_LIMIT } from "@/lib/pi-requirement-image";

type Customer = { id: string; company_name: string; country?: string | null; contact_name?: string | null; tax_number?: string | null; tally_requirements?: string | null; phone?: string | null; email?: string | null; address?: string | null; shipping_address?: string | null; shipping_addresses?: string[] | null; shipping_contact_entries?: ShippingContact[] | null; forwarder_addresses?: string[] | null; forwarder_contact_entries?: ShippingContact[] | null };
type Salesperson = { id: string; name: string | null };
type Account = { id: string; label: string; currency: string; instructions: string; payment_channel: PiPaymentChannel; active?: boolean };
type ExchangeRate = { currency: string; business_cny: number | null; reference_cny?: number | null; source: string; source_url?: string | null; reference_date: string | null; source_updated_at?: string | null };
type Line = { item_name: string; brand: string; model: string; quality: string; description: string; description_zh: string; quantity: string; unit_price_cny: string; unit_price_payment: string; unit_price_source: PiUnitPriceSource; estimated_unit_cost_cny: string; preparation_requirement: string; internal_note: string };
type PendingRequirementFile = { key: string; lineIndex: number | null; file: File };
type FeeKey = "last_balance" | "discount" | "other";
type FeeField = { enabled: boolean; source: PiFeeSource; amount: string };
const emptyFee = (): FeeField => ({ enabled: false, source: "CNY", amount: "0.00" });
const newLine = (): Line => ({ item_name: "", brand: "", model: "", quality: "", description: "", description_zh: "", quantity: "", unit_price_cny: "", unit_price_payment: "", unit_price_source: "CNY", estimated_unit_cost_cny: "", preparation_requirement: "", internal_note: "" });
const hasLineContent = (line: Line) => [line.item_name, line.brand, line.model, line.quality, line.description, line.description_zh, line.quantity, line.unit_price_cny, line.unit_price_payment, line.estimated_unit_cost_cny, line.preparation_requirement, line.internal_note].some((value) => value.trim());
function missingLineFields(line: Line) {
  return [
    !line.item_name.trim() && "产品类型", !line.brand.trim() && "产品品牌", !line.model.trim() && "产品型号", !line.quality.trim() && "产品质量",
    !validPiMoney(line.estimated_unit_cost_cny) && "成本单价", !validPiMoney(line.unit_price_cny) && "销售单价",
    !validPiQuantity(line.quantity) && "数量",
  ].filter((value): value is string => Boolean(value));
}
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const normalizeCustomerName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const field = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none";
const Required = () => <span aria-hidden="true" className="font-semibold text-rose-600"> *</span>;
function PiLineTextArea({ label, value, onChange, invalid = false }: { label: string; value: string; onChange: (value: string) => void; invalid?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} aria-label={label} aria-invalid={invalid} rows={1} className={`min-h-9 w-full min-w-28 resize-y rounded-lg border bg-white px-2 py-2 text-xs leading-5 focus:border-blue-500 focus:outline-none ${invalid ? "border-amber-500" : "border-slate-300"}`} value={value} onChange={(event) => onChange(event.target.value.replace(/\s*\n+\s*/g, " "))} />;
}

function RequirementImagePicker({ lineIndex, pending, existing, onAdd, onRemove, onRemoveExisting }: {
  lineIndex: number | null;
  pending: PendingRequirementFile[];
  existing: PiRequirementAttachment[];
  onAdd: (lineIndex: number | null, files: FileList | null) => void;
  onRemove: (key: string) => void;
  onRemoveExisting?: (id: string) => void;
}) {
  const files = pending.filter((entry) => entry.lineIndex === lineIndex);
  return <div className="min-w-0 text-xs">
    <label title="上传理货图片（选填）" className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-blue-200 bg-blue-50/70 px-2 text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 focus-within:ring-2 focus-within:ring-blue-200">
      <FileImage size={15} aria-hidden="true"/><span className="whitespace-nowrap">上传图片</span>
      <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={lineIndex === null ? "整单理货图片" : `第 ${lineIndex + 1} 行理货图片`}
        onChange={(event) => { onAdd(lineIndex, event.target.files); event.target.value = ""; }}/>
    </label>
    {files.map((entry) => <div key={entry.key} className="mt-1 flex items-center gap-1 text-slate-600"><span className="max-w-32 truncate" title={entry.file.name}>{entry.file.name}</span><button type="button" onClick={() => onRemove(entry.key)} aria-label={`移除${entry.file.name}`} className="text-rose-600">移除</button></div>)}
    {existing.filter((item) => !item.archived && item.display_line_number === (lineIndex === null ? null : lineIndex + 1)).map((item) => <div key={item.id} className="mt-1 flex max-w-48 items-center gap-1"><PiRequirementAttachments attachments={[item]} lineNumber={lineIndex === null ? null : lineIndex + 1}/>{onRemoveExisting ? <button type="button" onClick={() => onRemoveExisting(item.id)} aria-label={`删除${item.filename}`} className="text-rose-600">删除</button> : null}</div>)}
  </div>;
}

export function PiOrderForm({ initialCustomerId = "", draftOrderId, importDraftId, initialIsClerk }: { initialCustomerId?: string; draftOrderId?: string; importDraftId?: string; initialIsClerk: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const customerScopeRequest = useRef(0);
  const currencyRateRequest = useRef(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [isClerk, setIsClerk] = useState(initialIsClerk);
  const [salesScopeReady, setSalesScopeReady] = useState(!initialIsClerk);
  const [salesUserId, setSalesUserId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [canManageAccounts, setCanManageAccounts] = useState(false);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [warehouseReferenceNumber, setWarehouseReferenceNumber] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [priceDisplayMode, setPriceDisplayMode] = useState<"PAYMENT_ONLY" | "DUAL">("PAYMENT_ONLY");
  const [rate, setRate] = useState("");
  const [rateReviewed, setRateReviewed] = useState(false);
  const [rateInfoOpen, setRateInfoOpen] = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const [shippingInput, setShippingInput] = useState("0.00");
  const [shippingSource, setShippingSource] = useState<PiFeeSource>("CNY");
  const [feeFields, setFeeFields] = useState<Record<FeeKey, FeeField>>({ last_balance: emptyFee(), discount: emptyFee(), other: emptyFee() });
  const [paypalRateInput, setPaypalRateInput] = useState("5");
  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>(PI_PAYMENT_CHANNELS[0]);
  const [customPaymentMethod, setCustomPaymentMethod] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [recipient, setRecipient] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [useCustomerDelivery, setUseCustomerDelivery] = useState(false);
  const [useForwarderDelivery, setUseForwarderDelivery] = useState(false);
  const [customerDeliveryProfileIndex, setCustomerDeliveryProfileIndex] = useState("");
  const [forwarderDeliveryProfileIndex, setForwarderDeliveryProfileIndex] = useState("");
  const [openCustomerDeliverySelector, setOpenCustomerDeliverySelector] = useState(false);
  const [openForwarderDeliverySelector, setOpenForwarderDeliverySelector] = useState(false);
  const [forwarderAddress, setForwarderAddress] = useState("");
  const [forwarderRecipient, setForwarderRecipient] = useState("");
  const [forwarderPhone, setForwarderPhone] = useState("");
  const [stockingRequirements, setStockingRequirements] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [initialChangeNote, setInitialChangeNote] = useState("");
  const [recalledDraft, setRecalledDraft] = useState(false);
  const [canSubmitDraft, setCanSubmitDraft] = useState(true);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [savedDraftId, setSavedDraftId] = useState("");
  const [savedRevision, setSavedRevision] = useState(0);
  const [pendingSubmitAfterUpload, setPendingSubmitAfterUpload] = useState(false);
  const [pendingRequirementFiles, setPendingRequirementFiles] = useState<PendingRequirementFile[]>([]);
  const [existingRequirementAttachments, setExistingRequirementAttachments] = useState<PiRequirementAttachment[]>([]);
  const uploadedRequirementKeys = useRef(new Set<string>());
  const [items, setItems] = useState<Line[]>([newLine()]);
  const [confirmClearItems, setConfirmClearItems] = useState(false);
  const [showAccountDetails, setShowAccountDetails] = useState(false);
  const [showCustomerTally, setShowCustomerTally] = useState(false);
  const [tallyCopyMessage, setTallyCopyMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(draftOrderId || importDraftId));
  const [importSource, setImportSource] = useState<ImportedPiDocument | null>(null);
  const [importRevision, setImportRevision] = useState(0);
  const [importDifferences, setImportDifferences] = useState<string[]>([]);
  const [submitAfterImportDifferences, setSubmitAfterImportDifferences] = useState(false);
  const [pasteFallbackOpen, setPasteFallbackOpen] = useState(false);
  const [pasteFallbackText, setPasteFallbackText] = useState("");
  const [revision, setRevision] = useState(1);
  const [error, setError] = useState("");
  const hasUnsavedChanges = useRef(false);
  const [pendingLeaveUrl, setPendingLeaveUrl] = useState("");
  const [pendingHistoryBack, setPendingHistoryBack] = useState(false);
  const selectedAccount = accounts.find((item) => item.id === accountId);
  const availableAccounts = accounts.filter((item) => item.active !== false && item.payment_channel === paymentMethod);
  const availablePaymentChannels = PI_PAYMENT_CHANNELS.filter((channel) => accounts.some((item) => item.active !== false && item.payment_channel === channel));
  const hasOtherPaymentAccount = accounts.some((item) => item.active !== false && item.payment_channel === "OTHER");
  const cnyPerPayment = Number(rate);
  const effectiveRate = paymentPerCny(cnyPerPayment);
  const shippingPair = linkedPiUnitPrices(shippingInput, shippingSource, effectiveRate);
  const shippingCny = Number(shippingPair.cny);
  const selectedCustomer = customers.find((item) => item.id === customerId);
  const selectedShippingAddresses = displayAddressList(selectedCustomer?.shipping_addresses, selectedCustomer?.shipping_address);
  const selectedShippingContacts = displayShippingContacts(selectedCustomer?.shipping_contact_entries, selectedShippingAddresses);
  const selectedForwarderAddresses = displayAddressList(selectedCustomer?.forwarder_addresses, null);
  const selectedForwarderContacts = displayShippingContacts(selectedCustomer?.forwarder_contact_entries, selectedForwarderAddresses);
  const totals = useMemo(() => {
    const subtotalCny = roundMoney(items.reduce((sum, item) => sum + Number(item.quantity || 0) * Math.max(0, Number(item.unit_price_cny || 0)), 0));
    const subtotalPayment = roundMoney(items.reduce((sum, item) => sum + Number(item.quantity || 0) * Math.max(0, Number(item.unit_price_payment || 0)), 0));
    const totalProfitCny = items.every((item) => validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && validPiQuantity(item.quantity))
      ? roundMoney(items.reduce((sum, item) => sum + Number(item.quantity) * (Number(item.unit_price_cny) - Number(item.estimated_unit_cost_cny)), 0)) : null;
    return { subtotalCny, subtotalPayment, totalProfitCny, shippingPayment: Number(shippingPair.payment) };
  }, [items, shippingPair.payment]);
  const feeInput = useMemo<PiFeesInput>(() => ({
    shipping: { source: shippingSource, amount: Number(shippingInput) },
    last_balance: { source: feeFields.last_balance.source, amount: feeFields.last_balance.enabled ? Number(feeFields.last_balance.amount) : 0 },
    discount: { source: feeFields.discount.source, amount: feeFields.discount.enabled ? Number(feeFields.discount.amount) : 0 },
    other: { source: feeFields.other.source, amount: feeFields.other.enabled ? Number(feeFields.other.amount) : 0 },
    paypal_rate_percent: paymentMethod === "PayPal" ? Number(paypalRateInput) : 0,
    show_dual_currency_prices: priceDisplayMode === "DUAL" && currency !== "CNY",
    price_display_mode: currency === "CNY" ? "CNY_ONLY" : priceDisplayMode,
  }), [feeFields, paymentMethod, paypalRateInput, priceDisplayMode, currency, shippingSource, shippingInput]);
  const feeCalculation = useMemo(() => {
    if (!effectiveRate) return { value: null, error: "请输入有效汇率" };
    try { return { value: calculatePiFees(totals.subtotalCny, totals.subtotalPayment, shippingCny, effectiveRate, paymentMethod, feeInput), error: "" }; }
    catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : "PI费用不正确" }; }
  }, [totals.subtotalCny, totals.subtotalPayment, shippingCny, effectiveRate, paymentMethod, feeInput]);
  function changeFee(key: FeeKey, patch: Partial<FeeField>) {
    markUnsaved();
    setFeeFields((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }
  function feeDisplay(key: FeeKey, source: PiFeeSource) {
    const field = feeFields[key];
    if (!field.enabled) return "0.00";
    if (field.source === source) return field.amount;
    const pair = linkedPiUnitPrices(field.amount, field.source, effectiveRate);
    return source === "CNY" ? pair.cny : pair.payment;
  }

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
      const clerk = Boolean(customerBody.is_clerk);
      setIsClerk(clerk);
      setSalesScopeReady(!clerk);
      setSalespeople(customerBody.salespeople || []);
      let listed = (customerBody.data || []) as Customer[];
      if (clerk && draftBody?.order?.sales_user_id) {
        const scopedResponse = await fetch(`/api/orders/pi-customers?sales_user_id=${encodeURIComponent(draftBody.order.sales_user_id)}`, { cache: "no-store" });
        const scopedBody = await scopedResponse.json().catch(() => ({}));
        if (!scopedResponse.ok) { setError(scopedBody.error || "PI客户加载失败"); setLoadingDraft(false); return; }
        listed = scopedBody.data || [];
        setSalesUserId(draftBody.order.sales_user_id);
        setSalesScopeReady(true);
      }
      const exact = initialCustomerId ? listed.find((item) => item.id === initialCustomerId) : null;
      setCustomers(listed);
      if (initialCustomerId && !exact && !draftOrderId && !clerk) { setCustomerId(""); setError("该客户当前不归属您，不能为其创建PI订单"); }
      const loadedAccounts = (accountBody.data || []) as Account[];
      setAccounts(loadedAccounts);
      if (!draftOrderId && !importDraftId) setPaymentMethod(loadedAccounts.find((item) => item.active !== false)?.payment_channel || "");
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
        const importedRate = Number(source.fx_rate_cny_per_payment || ratesBody.rates?.find((item: ExchangeRate) => item.currency === source.currency)?.business_cny || 0);
        setRate(importedRate > 0 ? String(importedRate) : "");
        if (source.shipping_cny !== undefined) setShippingInput(source.shipping_cny.toFixed(2));
        else if (importedRate > 0) setShippingInput(roundMoney(source.shipping_payment * importedRate).toFixed(2));
        const companyName = normalizeCustomerName(source.delivery_company);
        const exactCustomerMatches = companyName ? listed.filter((customer) => normalizeCustomerName(customer.company_name) === companyName && (!source.customer_name || normalizeCustomerName(customer.contact_name || "") === normalizeCustomerName(source.customer_name))) : [];
        if (exactCustomerMatches.length === 1) setCustomerId(exactCustomerMatches[0].id);
        if (source.payment_method) {
          if (PI_PAYMENT_CHANNELS.some((method) => method === source.payment_method)) setPaymentMethod(source.payment_method);
          else { setPaymentMethod("OTHER"); setCustomPaymentMethod(source.payment_method); }
        }
        setDeliveryDate(source.delivery_date);
        if (source.valid_until) setValidUntil(source.valid_until);
        setRecipient(source.delivery_recipient);
        setPhone(source.delivery_phone);
        setEmail(source.delivery_email);
        setAddress(source.delivery_address);
        setUseCustomerDelivery(Boolean(source.delivery_recipient || source.delivery_phone || source.delivery_address));
        if (source.stocking_requirements) setStockingRequirements(source.stocking_requirements);
        setPriceDisplayMode(source.show_dual_currency_prices ? "DUAL" : "PAYMENT_ONLY");
        if (source.paypal_rate_percent !== undefined) setPaypalRateInput(String(source.paypal_rate_percent));
        setFeeFields({
          last_balance: { source: "CNY", enabled: Boolean(source.last_balance_cny), amount: (source.last_balance_cny || 0).toFixed(2) },
          discount: { source: "CNY", enabled: Boolean(source.discount_cny), amount: (source.discount_cny || 0).toFixed(2) },
          other: { source: "CNY", enabled: Boolean(source.other_cny), amount: (source.other_cny || 0).toFixed(2) },
        });
        setItems(source.items.map((item) => ({ ...newLine(), item_name: item.item_name, brand: item.brand,
          model: item.model, quality: item.quality, description: item.description, description_zh: item.description_zh || "", quantity: String(item.quantity),
          unit_price_source: item.unit_price_cny !== undefined ? "CNY" as const : "PAYMENT" as const,
          unit_price_payment: item.unit_price_cny !== undefined && importedRate > 0 ? roundMoney(item.unit_price_cny / importedRate).toFixed(2) : item.unit_price_payment.toFixed(2),
          unit_price_cny: item.unit_price_cny !== undefined ? item.unit_price_cny.toFixed(2) : importedRate > 0 ? roundMoney(item.unit_price_payment * importedRate).toFixed(2) : "",
          estimated_unit_cost_cny: item.estimated_unit_cost_cny?.toFixed(2) || "", preparation_requirement: item.preparation_requirement || "", internal_note: item.internal_note || "" })));
        setAccountId(source.payment_account_id || "");
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
        setPriceDisplayMode(order.price_display_mode === "DUAL" || order.show_dual_currency_prices === true ? "DUAL" : "PAYMENT_ONLY");
        setRate(String(inverseRate(Number(order.fx_rate_cny_to_payment))));
        setShippingInput(Number(order.shipping_cny).toFixed(2));
        setFeeFields({
          last_balance: { enabled: Number(order.last_balance_cny || 0) > 0 || Number(order.last_balance_amount || 0) > 0, source: order.last_balance_source === "PAYMENT" ? "PAYMENT" : "CNY", amount: Number(order.last_balance_source === "PAYMENT" ? order.last_balance_amount : order.last_balance_cny || 0).toFixed(2) },
          discount: { enabled: Number(order.discount_cny || 0) > 0 || Number(order.discount_amount || 0) > 0, source: order.discount_source === "PAYMENT" ? "PAYMENT" : "CNY", amount: Number(order.discount_source === "PAYMENT" ? order.discount_amount : order.discount_cny || 0).toFixed(2) },
          other: { enabled: Number(order.other_charge_cny || 0) > 0 || Number(order.other_charge_amount || 0) > 0, source: order.other_charge_source === "PAYMENT" ? "PAYMENT" : "CNY", amount: Number(order.other_charge_source === "PAYMENT" ? order.other_charge_amount : order.other_charge_cny || 0).toFixed(2) },
        });
        setPaypalRateInput(order.payment_method === "PayPal" ? Number(order.paypal_fee_percent ?? 5).toString() : "5");
        setAccountId(order.payment_account_id || "");
        const storedMethod = String(order.payment_method || "").trim();
        if (PI_PAYMENT_CHANNELS.some((method) => method === storedMethod)) setPaymentMethod(storedMethod);
        else if (storedMethod) { setPaymentMethod("OTHER"); setCustomPaymentMethod(storedMethod); }
        setValidUntil(order.pi_valid_until || "");
        setDeliveryDate(order.delivery_date || "");
        setRecipient(order.delivery_recipient || "");
        setPhone(order.delivery_phone || "");
        setEmail(order.delivery_email || "");
        setAddress(order.delivery_address || "");
        setForwarderAddress(order.forwarder_address || "");
        setForwarderRecipient(order.forwarder_recipient || "");
        setForwarderPhone(order.forwarder_phone || "");
        setUseCustomerDelivery(Boolean(order.delivery_recipient || order.delivery_phone || order.delivery_address));
        setUseForwarderDelivery(Boolean(order.forwarder_address));
        setStockingRequirements(draftBody.stocking_requirements || "");
        setExistingRequirementAttachments(draftBody.requirement_attachments || []);
        setChangeNote(draftBody.order.confirmation_note || "");
        setInitialChangeNote(draftBody.order.confirmation_note || "");
        setRecalledDraft(draftBody.stock_order?.status === "DRAFT");
        setCanSubmitDraft(Boolean(draftBody.can_submit));
        setItems((draftBody.items || []).map((item: Line) => ({
          item_name: item.item_name || "", brand: item.brand || "", model: item.model || "", quality: item.quality || "",
          description: item.description || "", description_zh: item.description_zh || "", quantity: String(item.quantity),
          unit_price_cny: String(item.unit_price_cny), estimated_unit_cost_cny: String(item.estimated_unit_cost_cny),
          unit_price_payment: Number((item as Line & { unit_price?: number }).unit_price ?? roundMoney(Number(item.unit_price_cny) * Number(order.fx_rate_cny_to_payment))).toFixed(2),
          unit_price_source: item.unit_price_source === "PAYMENT" ? "PAYMENT" : "CNY",
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
    setShowCustomerTally(false);
    setTallyCopyMessage("");
    setUseCustomerDelivery(false);
    setUseForwarderDelivery(false);
    setCustomerDeliveryProfileIndex("");
    setForwarderDeliveryProfileIndex("");
    setOpenCustomerDeliverySelector(false);
    setOpenForwarderDeliverySelector(false);
    const customer = customers.find((item) => item.id === id);
    if (!customer) {
      setRecipient("");
      setPhone("");
      setEmail("");
      setAddress("");
      setForwarderAddress(""); setForwarderRecipient(""); setForwarderPhone("");
      return;
    }
    setRecipient(""); setPhone(""); setEmail(""); setAddress(""); setForwarderAddress(""); setForwarderRecipient(""); setForwarderPhone("");
  }
  async function chooseSalesperson(id: string) {
    if (id === salesUserId) return;
    const requestNumber = ++customerScopeRequest.current;
    markUnsaved();
    setSalesUserId(id);
    setSalesScopeReady(false);
    setCustomerId("");
    setCustomers([]);
    setRecipient(""); setPhone(""); setEmail(""); setAddress(""); setForwarderAddress(""); setForwarderRecipient(""); setForwarderPhone("");
    setUseCustomerDelivery(false); setUseForwarderDelivery(false);
    setError("");
    if (!id) return;
    try {
      const response = await fetch(`/api/orders/pi-customers?sales_user_id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (requestNumber !== customerScopeRequest.current) return;
      if (!response.ok) throw new Error(body.error || "该销售员客户加载失败");
      setCustomers(body.data || []);
      setSalesScopeReady(true);
    } catch (cause) { if (requestNumber === customerScopeRequest.current) setError(cause instanceof Error ? cause.message : "该销售员客户加载失败"); }
  }
  async function copyCustomerTally() {
    if (!selectedCustomer?.tally_requirements?.trim()) return;
    try {
      await navigator.clipboard.writeText(selectedCustomer.tally_requirements);
      setTallyCopyMessage("已复制客户资料中的理货要求");
    } catch {
      setTallyCopyMessage("复制失败，请手动选中文字复制");
    }
  }
  function editLine(index: number, key: keyof Line, value: string) {
    if (items[index]?.[key] !== value) markUnsaved();
    setItems((current) => current.map((item, position) => position === index ? { ...item, [key]: value } : item));
  }
  function editUnitPrice(index: number, source: PiUnitPriceSource, value: string) {
    if (items[index]?.[source === "CNY" ? "unit_price_cny" : "unit_price_payment"] !== value) markUnsaved();
    setItems((current) => current.map((item, position) => {
      if (position !== index) return item;
      const prices = linkedPiUnitPrices(value, source, effectiveRate);
      return { ...item, unit_price_source: source, unit_price_cny: prices.cny, unit_price_payment: prices.payment };
    }));
  }
  function updateRate(nextRate: string, currencyChanged = false) {
    setRate(nextRate);
    setRateReviewed(false);
    const convertedRate = paymentPerCny(Number(nextRate));
    setItems((current) => current.map((item) => {
      const source = currencyChanged ? "CNY" : item.unit_price_source;
      const prices = linkedPiUnitPrices(source === "CNY" ? item.unit_price_cny : item.unit_price_payment, source, convertedRate);
      return { ...item, unit_price_source: source, unit_price_cny: prices.cny, unit_price_payment: prices.payment };
    }));
  }
  function changeCurrency(nextCurrency: string) {
    if (nextCurrency === currency) return;
    if (!effectiveRate && Object.values(feeFields).some((fee) => fee.enabled && fee.source === "PAYMENT" && Number(fee.amount) > 0)) {
      setError("请先填写有效汇率，或将外币附加费用改为人民币，再切换付款币种");
      return;
    }
    markUnsaved();
    setError("");
    setFeeFields((current) => {
      const converted = (key: FeeKey): FeeField => {
        const fee = current[key];
        return fee.source === "PAYMENT" && effectiveRate
          ? { ...fee, source: "CNY", amount: fee.amount === "" ? "" : roundMoney(Number(fee.amount) / effectiveRate).toFixed(2) }
          : fee;
      };
      return { last_balance: converted("last_balance"), discount: converted("discount"), other: converted("other") };
    });
    setCurrency(nextCurrency);
    if (nextCurrency === "CNY") setPriceDisplayMode("PAYMENT_ONLY");
    setRateReviewed(false);
    const cachedRate = exchangeRates.find((item) => item.currency === nextCurrency)?.business_cny;
    updateRate(cachedRate && cachedRate > 0 ? String(cachedRate) : "", true);
    void refreshSelectedCurrencyRate(nextCurrency);
  }
  async function refreshSelectedCurrencyRate(nextCurrency: string) {
    const requestId = ++currencyRateRequest.current;
    setRateLoading(true);
    try {
      const response = await fetch(`/api/pi-exchange-rates?currency=${encodeURIComponent(nextCurrency)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "最新汇率获取失败");
      if (requestId !== currencyRateRequest.current) return;
      const selectedRate = (body.rates || []).find((item: ExchangeRate) => item.currency === nextCurrency) as ExchangeRate | undefined;
      setExchangeRates((current) => [...current.filter((item) => item.currency !== nextCurrency), ...(selectedRate ? [selectedRate] : [])]);
      updateRate(selectedRate?.business_cny && selectedRate.business_cny > 0 ? String(selectedRate.business_cny) : "", true);
      if (!selectedRate?.business_cny) setError(`${nextCurrency}暂时没有可用的有效业务汇率，请点击参考来源核对后手动填写本单汇率`);
    } catch (cause) {
      if (requestId !== currencyRateRequest.current) return;
      updateRate("", true);
      setError(cause instanceof Error ? cause.message : "最新汇率获取失败，请核对来源后手动填写");
    } finally {
      if (requestId === currencyRateRequest.current) setRateLoading(false);
    }
  }
  function importRows(rows: unknown[][], selectedRate = effectiveRate, selectedCurrency = currency) {
    const parsed = parsePiProductRows(rows, selectedRate, selectedCurrency);
    const imported = parsed.map(({ source_row: _sourceRow, ...item }) => { void _sourceRow; return { ...newLine(), ...item }; });
    if (items.filter(hasLineContent).length + imported.length > 500) throw new Error("每张PI最多500条明细，请分批处理");
    const retained = items.map((item, index) => hasLineContent(item) ? index : -1).filter((index) => index >= 0);
    setPendingRequirementFiles((current) => current.flatMap((entry) => {
      if (entry.lineIndex === null) return [entry];
      const position = retained.indexOf(entry.lineIndex);
      return position >= 0 ? [{ ...entry, lineIndex: position }] : [];
    }));
    setItems((current) => [...current.filter(hasLineContent), ...imported]);
    markUnsaved();
    const incomplete = parsed.flatMap((item, index) => {
      const missing = missingLineFields(imported[index]);
      return missing.length ? [`原文件第${item.source_row}行：${missing.join("、")}`] : [];
    });
    setError(incomplete.length ? `已导入${imported.length}行产品，以下信息待补全：${incomplete.slice(0, 5).join("；")}${incomplete.length > 5 ? `等${incomplete.length}行` : ""}。补齐后才可保存草稿或提交备货单。` : "");
  }
  async function prepareImportRows(rows: unknown[][]) {
    const selectedCurrency = detectPiPaymentCurrency(rows) || currency;
    const documentRate = derivePiCnyRate(rows, selectedCurrency);
    let selectedCnyRate = documentRate || (selectedCurrency === currency ? cnyPerPayment : selectedCurrency === "CNY" ? 1 : 0);
    if (!selectedCnyRate) {
      const response = await fetch(`/api/pi-exchange-rates?currency=${encodeURIComponent(selectedCurrency)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `${selectedCurrency}业务汇率获取失败`);
      selectedCnyRate = Number((body.rates || []).find((item: ExchangeRate) => item.currency === selectedCurrency)?.business_cny || 0);
    }
    if (!Number.isFinite(selectedCnyRate) || selectedCnyRate <= 0) throw new Error(`${selectedCurrency}暂无有效业务汇率，请先选择付款币种并填写本单汇率后重试`);
    const selectedPaymentRate = paymentPerCny(selectedCnyRate);
    // Validate all rows before changing the PI form; invalid imports must not mutate existing work.
    parsePiProductRows(rows, selectedPaymentRate, selectedCurrency);
    if (selectedCurrency !== currency || (documentRate && Math.abs(cnyPerPayment - documentRate) > 0.000001)) {
      if (!effectiveRate && Object.values(feeFields).some((fee) => fee.enabled && fee.source === "PAYMENT" && Number(fee.amount) > 0)) {
        throw new Error("请先填写当前币种的有效汇率，或将外币附加费用改为人民币，再导入其他币种的产品");
      }
      setFeeFields((current) => {
        const converted = (key: FeeKey): FeeField => {
          const fee = current[key];
          return fee.source === "PAYMENT" && effectiveRate
            ? { ...fee, source: "CNY", amount: fee.amount === "" ? "" : roundMoney(Number(fee.amount) / effectiveRate).toFixed(2) }
            : fee;
        };
        return { last_balance: converted("last_balance"), discount: converted("discount"), other: converted("other") };
      });
      setCurrency(selectedCurrency);
      if (selectedCurrency === "CNY") setPriceDisplayMode("PAYMENT_ONLY");
      else if (documentRate) setPriceDisplayMode("DUAL");
      updateRate(String(selectedCnyRate), selectedCurrency !== currency);
    }
    importRows(rows, selectedPaymentRate, selectedCurrency);
  }
  function addRequirementFiles(lineIndex: number | null, selected: FileList | null) {
    const files = Array.from(selected || []);
    if (!files.length) return;
    {
      const currentCount = pendingRequirementFiles.filter((entry) => entry.lineIndex === lineIndex).length
        + existingRequirementAttachments.filter((entry) => !entry.archived && entry.display_line_number === (lineIndex === null ? null : lineIndex + 1)).length;
      const limit = lineIndex === null ? PI_REQUIREMENT_IMAGE_COUNT_LIMIT_PER_ORDER : PI_REQUIREMENT_IMAGE_COUNT_LIMIT_PER_LINE;
      if (currentCount + files.length > limit) {
        setError(`${lineIndex === null ? "整单理货要求" : "每个产品项"}最多上传 ${limit} 张图片，请减少本次选择或先移除已有图片`); return;
      }
    }
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      || file.size <= 0 || file.size > PI_REQUIREMENT_IMAGE_LIMIT)) {
      setError("理货图片仅支持 JPG、PNG 或 WebP，单张大小须大于 0 且不超过 5MB"); return;
    }
    markUnsaved();
    setPendingRequirementFiles((current) => [...current, ...files.map((file) => ({
      key: crypto.randomUUID(), lineIndex, file,
    }))]);
    setError("");
  }
  function removeRequirementFile(key: string) {
    markUnsaved();
    setPendingRequirementFiles((current) => current.filter((entry) => entry.key !== key));
  }
  async function removeExistingRequirementFile(id: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "删除图片失败");
      setExistingRequirementAttachments((current) => current.filter((item) => item.id !== id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除图片失败"); }
    finally { setBusy(false); }
  }
  async function uploadRequirementFiles(orderId: string) {
    for (const entry of pendingRequirementFiles) {
      if (uploadedRequirementKeys.current.has(entry.key)) continue;
      const form = new FormData();
      form.set("file", entry.file);
      if (entry.lineIndex !== null) form.set("line_number", String(entry.lineIndex + 1));
      const response = await fetch(`/api/orders/${orderId}/requirement-attachments`, { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`${entry.file.name}：${body.error || "上传失败"}`);
      uploadedRequirementKeys.current.add(entry.key);
    }
  }
  async function submitSavedDraft(orderId: string, currentRevision: number, submitToWarehouse: boolean) {
    await uploadRequirementFiles(orderId);
    if (submitToWarehouse) {
      const submitResponse = await fetch(`/api/orders/${orderId}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: currentRevision }),
      });
      const submitBody = await submitResponse.json().catch(() => ({}));
      if (!submitResponse.ok) throw new Error(submitBody.error || "提交仓库失败");
    }
    hasUnsavedChanges.current = false;
    window.location.assign(`/orders/${orderId}`);
  }
  async function retrySavedDraft() {
    if (!savedDraftId || busy) return;
    setBusy(true); setError("");
    try { await submitSavedDraft(savedDraftId, savedRevision, pendingSubmitAfterUpload); }
    catch (cause) { setError(`${cause instanceof Error ? cause.message : "提交失败"}；PI 草稿已保存，可重试或进入详情核对`); }
    finally { setBusy(false); }
  }
  function downloadTemplate() {
    const link = document.createElement("a");
    link.href = "/templates/pi-line-import-template.xlsx";
    link.download = "PI产品明细导入模板.xlsx";
    link.click();
  }
  async function importExcel(file?: File) {
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheets = book.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: "", raw: false }) }));
      const productSheet = sheets.find((sheet) => sheet.name === "PI产品明细" && hasPiProductHeader(sheet.rows))
        || sheets.find((sheet) => hasPiProductHeader(sheet.rows))
        || (sheets.length === 1 ? sheets[0] : null);
      if (!productSheet) throw new Error("未找到产品明细表头，请核对产品类型、品牌、型号、质量、成本、售价和数量列");
      await prepareImportRows(productSheet.rows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Excel导入失败"); }
    if (fileRef.current) fileRef.current.value = "";
  }
  async function importPastedText(text: string) {
    if (!text.trim()) {
      setError("剪贴板内容为空，请复制产品明细表格后再粘贴");
      return false;
    }
    try {
      await prepareImportRows(parsePiClipboardTsv(text));
      setPasteFallbackOpen(false);
      setPasteFallbackText("");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法识别表格内容，请检查产品明细列和金额格式后重试");
      return false;
    }
  }
  async function pasteRows() {
    setError("");
    try {
      if (!navigator.clipboard?.readText) throw new Error("clipboard-unavailable");
      if (!document.hasFocus()) window.focus();
      const text = await navigator.clipboard.readText();
      await importPastedText(text);
    } catch {
      setPasteFallbackText("");
      setPasteFallbackOpen(true);
    }
  }
  async function create(submitToWarehouse = false, acknowledgeDifferences = false) {
    if (busy) return;
    if (savedDraftId && !draftOrderId) { setError("当前PI草稿已保存，请先进入详情核对，避免重复创建"); return; }
    setError("");
    if (rateLoading) { setError("正在刷新所选币种汇率，请稍候再继续"); return; }
    if (!rateReviewed) { setError("请点击参考来源核对汇率，并勾选确认后再保存PI"); return; }
    if (isClerk && !salesUserId) { setError("请先选择负责此PI的销售员"); return; }
    if (!validUntil) { setError("请选择PI有效期"); return; }
    if (!customerId || !warehouseReferenceNumber.trim() || !currency || !accountId || !Number.isFinite(cnyPerPayment) || cnyPerPayment <= 0) {
      setError("请选择客户、填写订单编号、付款币种、收款账户及正数汇率"); return;
    }
    if (!availableAccounts.some((account) => account.id === accountId)) { setError("所选收款账户与付款渠道不匹配或已停用，请重新选择"); return; }
    if (!shippingInput.trim() || !Number.isFinite(shippingCny) || shippingCny < 0 || shippingCny > 999999999999 || !/^\d+(?:\.\d{1,2})?$/.test(shippingInput) || !shippingPair.cny || !shippingPair.payment) {
      setError("请输入非负且最多两位小数的运费，并核对汇率"); return;
    }
    if (feeFields.last_balance.enabled && !/^\d+(?:\.\d{1,2})?$/.test(feeFields.last_balance.amount) ||
        feeFields.discount.enabled && !/^\d+(?:\.\d{1,2})?$/.test(feeFields.discount.amount) ||
        feeFields.other.enabled && !/^\d+(?:\.\d{1,2})?$/.test(feeFields.other.amount) ||
        paymentMethod === "PayPal" && !/^\d+(?:\.\d{1,4})?$/.test(paypalRateInput) || !feeCalculation.value) {
      setError(feeCalculation.error || "请核对附加费用和PayPal手续费百分比"); return;
    }
    if (useCustomerDelivery && (!recipient.trim() || !phone.trim() || !address.trim())) { setError("启用客户收货信息后，请填写收货人、电话和收货地址"); return; }
    if (useForwarderDelivery && (!forwarderRecipient.trim() || !forwarderPhone.trim() || !forwarderAddress.trim())) { setError("启用货代收货信息后，请填写收货人、电话和收货地址"); return; }
    if (useCustomerDelivery && selectedCustomer &&
      customerDeliveryMatchesForwarder(address, selectedCustomer.forwarder_addresses, selectedCustomer.forwarder_contact_entries)) {
      setError("客户收货地址与客户档案中的货代地址匹配；请在“货代收货信息”栏选择该地址，勿填入客户收货栏"); return;
    }
    const invalidRow = items.findIndex((item) => !item.item_name.trim() || !item.brand.trim() || !item.model.trim() || !item.quality.trim() || !validPiQuantity(item.quantity) || !validPiMoney(item.unit_price_cny) || !validPiMoney(item.unit_price_payment) || !validPiMoney(item.estimated_unit_cost_cny));
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
        body: JSON.stringify({ customer_id: customerId, sales_user_id: isClerk ? salesUserId : undefined, warehouse_reference_number: warehouseReferenceNumber.trim(), currency, fx_rate_cny_to_payment: effectiveRate, shipping_cny: shippingCny, fees: feeInput,
          payment_method: chosenPaymentMethod, payment_account_id: accountId, valid_until: validUntil, delivery_date: deliveryDate,
          delivery_recipient: useCustomerDelivery ? recipient : "", delivery_phone: useCustomerDelivery ? phone : "", delivery_email: useCustomerDelivery ? email : "", delivery_address: useCustomerDelivery ? address : "", forwarder_address: useForwarderDelivery ? forwarderAddress : "", forwarder_recipient: useForwarderDelivery ? forwarderRecipient : "", forwarder_phone: useForwarderDelivery ? forwarderPhone : "",
          stocking_requirements: stockingRequirements, items: items.map((item) => ({ ...item, quantity: Number(item.quantity), unit_price_cny: Number(item.unit_price_cny), unit_price_payment: Number(item.unit_price_payment), estimated_unit_cost_cny: Number(item.estimated_unit_cost_cny) })), revision,
          import_revision: importRevision, acknowledge_differences: acknowledgeDifferences, fx_rate_confirmed: rateReviewed }),
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
      setSavedRevision(currentRevision);
      setPendingSubmitAfterUpload(submitToWarehouse);
      await submitSavedDraft(saved.id, currentRevision, submitToWarehouse);
    } catch (cause) { setError(justSavedId ? `${cause instanceof Error ? cause.message : "网络异常"}；PI 草稿已保存，请重试上传/提交或进入详情核对` : "网络异常，未确认创建结果；请先检查PI订单列表，避免重复提交"); }
    finally { setBusy(false); }
  }

  return <main className="p-4 lg:p-6" onInputCapture={(event) => { if (!(event.target as HTMLElement).hasAttribute("readonly")) markUnsaved(); }}><div className="mx-auto max-w-[1500px] space-y-5">
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h1 className="text-xl font-bold">{importDraftId ? "核对并补全导入PI" : draftOrderId ? "编辑PI草稿" : "创建PI订单"}</h1><p className="mt-1 text-sm text-slate-500">{importDraftId ? "请关联本人客户，补齐人民币售价与成本、汇率及收款账户；先生成PI草稿，核对后再提交仓库。" : "客户与价格只录入一次；保存草稿后核对，确认后生成仓库备货单。"}</p></div><Link href={importDraftId ? "/orders/import" : draftOrderId ? `/orders/${draftOrderId}` : "/orders"} className="inline-flex h-9 items-center rounded-lg border bg-white px-3 text-sm hover:bg-slate-50">返回</Link></header>
    {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}{savedDraftId ? <> · {savedRevision > 0 ? <><button type="button" disabled={busy} onClick={() => void retrySavedDraft()} className="font-semibold underline disabled:opacity-50">重试上传并继续</button> · </> : null}<Link className="font-semibold underline" href={`/orders/${savedDraftId}`}>查看已保存PI</Link></> : null}</div> : null}
    {isClerk ? <section className="border-b border-slate-100 p-5"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><label className="text-sm">为哪位销售员创建PI<Required /><AppSelect className={field} aria-label="选择PI归属销售员（含主管）" value={salesUserId} disabled={Boolean(draftOrderId)} placeholderValue="" onChange={(event) => void chooseSalesperson(event.target.value)}><option value="">请选择销售员（含主管）</option>{salespeople.map((person) => <option key={person.id} value={person.id}>{person.name || person.id}</option>)}</AppSelect></label></div><p className="mt-2 text-xs text-slate-500">请先选择本单归属的销售员；客户、产品与费用信息将在其客户范围加载完成后开放填写。</p></section> : null}
    <fieldset disabled={isClerk && !salesScopeReady} aria-disabled={isClerk && !salesScopeReady} className={`min-w-0 border-0 p-0 ${isClerk && !salesScopeReady ? "pointer-events-none opacity-50" : ""}`}>
    {importSource ? <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      {importSource.source_kind === "SYSTEM_TEMPLATE"
        ? <>系统整单模板：{importSource.warehouse_reference_number}。人民币售价、成本和费用已带入；{effectiveRate > 0 ? "请核对汇率与换算后的客户付款金额。" : "请填写有效汇率后核对客户付款金额。"}模板中未提供收款账户时请手动选择。费用与 PayPal 手续费将在页面计算 PI 总额。</>
        : <>原客户 PI：{importSource.warehouse_reference_number} · {importSource.currency} {importSource.total_payment.toFixed(2)}（含运费 {importSource.shipping_payment.toFixed(2)}）。人民币售价和运费{effectiveRate > 0 ? "已按当前业务汇率自动折算，可核对调整" : "需在汇率可用后折算"}；预估成本及收款账户需补充或核对。</>}
      {selectedCustomer && normalizeCustomerName(selectedCustomer.company_name) === normalizeCustomerName(importSource.delivery_company) ? "客户已按公司名称匹配，请确认联系人。" : "请选择与公司和联系人一致的有权访问客户。"}
      {importSource.payment_account_id ? "收款账户已按付款信息唯一精确匹配。" : "收款账户仅在唯一精确匹配时自动选择，否则请手动选择。"}与导入文件不一致时会要求逐项确认。
    </div> : null}
    <section className="border-b border-slate-100 p-5"><h2 className="mb-4 font-semibold">PI基本信息</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <label className="text-sm">客户名称<Required /><AppSelect className={field} aria-label="搜索客户名称或公司名称并选择PI客户" forceSearch placeholderValue="" disabled={Boolean(draftOrderId)} value={customerId} onChange={(event) => chooseCustomer(event.target.value)}><option value="">搜索客户名称或公司名称</option>{customers.map((customer) => <option key={customer.id} value={customer.id} data-search-text={`${customer.contact_name || ""} ${customer.company_name || ""}`} data-secondary-label={customer.company_name || ""}>{customer.contact_name?.trim() || "未填写客户名称"}</option>)}</AppSelect></label>
      <label className="text-sm">公司名称<input className={`${field} bg-slate-50 text-slate-600`} value={selectedCustomer?.company_name || ""} readOnly aria-readonly="true" placeholder="选择客户后自动带出" /></label>
      <label className="text-sm">客户税号<input className={`${field} bg-slate-50 text-slate-600`} value={selectedCustomer?.tax_number || ""} readOnly aria-readonly="true" placeholder="客户资料未填写" title="只可在客户资料中修改客户税号" /></label>
      <label className="text-sm">目的国家<span className={`${field} flex items-center bg-slate-50 text-slate-600`} aria-readonly="true" title="从所选客户档案自动带入">{selectedCustomer?.country ? <CountryLabel value={selectedCustomer.country} /> : "客户档案未填写"}</span></label>
      <label className="text-sm">订单编号<Required /><input className={field} maxLength={80} value={warehouseReferenceNumber} onChange={(event) => setWarehouseReferenceNumber(event.target.value)} placeholder="例如 D60020733；不可与其他PI重复" /></label>
      <label className="text-sm">客户付款币种<Required /><AppSelect className={field} aria-label="搜索并选择客户付款币种" value={currency} onChange={(event) => changeCurrency(event.target.value)}><option value="">请选择</option>{QUOTE_CURRENCIES.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}</AppSelect></label>
      <div className="text-sm"><div className="flex items-center gap-1"><label htmlFor="pi-fx-rate">汇率：1 {currency || "付款币种"} = 多少人民币<Required /></label><div className="relative" onMouseEnter={() => setRateInfoOpen(true)} onMouseLeave={() => setRateInfoOpen(false)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setRateInfoOpen(false); }}><button type="button" aria-label="查看业务汇率和参考来源" aria-expanded={rateInfoOpen} aria-controls="pi-rate-reference" onClick={() => setRateInfoOpen(true)} onFocus={() => setRateInfoOpen(true)} className="rounded-full px-1 text-blue-600 focus:outline-blue-600">ⓘ</button>{rateInfoOpen ? <div id="pi-rate-reference" role="tooltip" className="absolute left-0 top-7 z-30 w-80 max-w-[calc(100vw-3rem)] space-y-1 rounded-lg border border-blue-200 bg-white p-3 text-xs leading-5 text-slate-700 shadow-lg">{(() => { const selectedRate = exchangeRates.find((item) => item.currency === currency); return <>{selectedRate?.business_cny ? <p>系统业务汇率：1 {currency} = {Number(selectedRate.business_cny).toFixed(["USD","EUR","GBP","AUD","CAD","NZD"].includes(currency) ? 2 : 6)} CNY；可按本单实际交易条件调整</p> : null}{selectedRate?.reference_cny ? <p>参考报价：1 {currency} = {selectedRate.reference_cny} CNY{selectedRate.source_updated_at ? ` · 更新于 ${selectedRate.source_updated_at}（北京时间）` : selectedRate.reference_date ? ` · ${selectedRate.reference_date}` : ""}</p> : selectedRate?.source === "UNAVAILABLE" ? <p>暂未获取到可用参考报价；请核对来源并手动填写</p> : null}{selectedRate?.source_url ? <a href={selectedRate.source_url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline">查看{["USD","EUR","GBP","AUD","CAD","NZD"].includes(currency) ? "百度" : "汇率"}参考来源</a> : null}</>; })()}</div> : null}</div></div><input id="pi-fx-rate" className={field} type="number" min="0.000001" step="0.000001" value={rate} onChange={(event) => updateRate(event.target.value)} placeholder="例如 7.200000" aria-describedby="pi-rate-confirmation" /><div className="mt-1 text-xs text-slate-600">{rateLoading ? <p>正在刷新{currency}参考汇率…</p> : null}<label id="pi-rate-confirmation" className="flex items-start gap-2 pt-1 text-slate-700"><input type="checkbox" checked={rateReviewed} onChange={(event) => setRateReviewed(event.target.checked)} disabled={rateLoading} className="mt-0.5" /><span>{currency === "CNY" ? "我已确认人民币付款币种及本单汇率" : "我已核对参考汇率及来源，并确认本单使用的汇率"} <b className="text-rose-600" aria-label="必选">*</b></span></label></div></div>
      <label className="text-sm">PI有效期<Required /><input className={`${field} cursor-pointer`} type="date" value={validUntil} onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* Keep native typing when the picker is unavailable. */ } }} onChange={(event) => setValidUntil(event.target.value)} /></label>
      <label className="text-sm">预计交付日期<input className={`${field} cursor-pointer`} type="date" value={deliveryDate} onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* Keep native typing when the picker is unavailable. */ } }} onChange={(event) => setDeliveryDate(event.target.value)} /></label>
      <div className="text-sm"><label>付款渠道<Required /><AppSelect className={field} value={availablePaymentChannels.includes(paymentMethod as typeof PI_PAYMENT_CHANNELS[number]) || (paymentMethod === "OTHER" && hasOtherPaymentAccount) ? paymentMethod : ""} onChange={(event) => { if (event.target.value !== paymentMethod) { markUnsaved(); setAccountId(""); } setPaymentMethod(event.target.value); }}><option value="">请选择已配置收款账户的付款渠道</option>{availablePaymentChannels.map((method) => <option key={method} value={method}>{method}</option>)}{hasOtherPaymentAccount ? <option value="OTHER">其他渠道（手工填写）</option> : null}</AppSelect></label>{paymentMethod === "OTHER" && hasOtherPaymentAccount ? <input aria-label="其他付款渠道" className={`${field} mt-2`} maxLength={300} value={customPaymentMethod} onChange={(event) => setCustomPaymentMethod(event.target.value)} placeholder="填写实际收款渠道" /> : null}{!availablePaymentChannels.length && !hasOtherPaymentAccount ? <span className="mt-1 block text-xs text-amber-700">当前暂无已启用的收款账户，请联系系统管理员先配置收款账户。</span> : null}</div>
      <div className="text-sm"><label>收款账户<Required /><AppSelect className={field} aria-label="选择PI收款账户" placeholderValue="" value={availableAccounts.some((account) => account.id === accountId) ? accountId : ""} onChange={(event) => { if (event.target.value !== accountId) markUnsaved(); setAccountId(event.target.value); }}><option value="">{availableAccounts.length ? "请选择此渠道的收款账户" : "该付款渠道暂无启用的收款账户"}</option>{availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</AppSelect></label>{selectedAccount && availableAccounts.some((account) => account.id === accountId) ? <button type="button" onClick={() => setShowAccountDetails(true)} className="mt-1 text-xs font-medium text-blue-700 underline">查看账户详情</button> : null}{!availableAccounts.length ? <span className="mt-1 block text-xs text-amber-700">{canManageAccounts ? <><Link href="/settings/pi-payment-accounts" className="underline">先为此付款渠道配置并启用收款账户</Link>，再返回创建PI。</> : "请联系系统管理员为此付款渠道配置并启用收款账户。"}</span> : null}</div>
    </div></section>
    <section className="border-b border-slate-100 p-5"><h2 className="mb-1 font-semibold">客户及货代收货信息（选填）</h2><p className="mb-4 text-xs text-slate-500">默认不添加；按本单需要勾选，保存后作为 PI 快照。</p><div className="grid items-stretch gap-4 xl:grid-cols-2">
      <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-4"><label className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={useCustomerDelivery} onChange={(event) => { markUnsaved(); setUseCustomerDelivery(event.target.checked); setOpenCustomerDeliverySelector(event.target.checked && selectedShippingContacts.length > 0); if (event.target.checked) { const index = selectedShippingContacts.length === 1 ? "0" : ""; const chosen = index ? selectedShippingContacts[0] : null; setCustomerDeliveryProfileIndex(index); setRecipient(chosen?.recipient || selectedCustomer?.contact_name?.trim() || ""); setPhone(chosen?.phone || selectedCustomer?.phone || "");  setAddress(chosen?.address || ""); } else { setCustomerDeliveryProfileIndex(""); setRecipient(""); setPhone(""); setEmail(""); setAddress(""); } }} />添加客户收货信息</label>{useCustomerDelivery ? <><p className="mb-3 mt-2 text-xs text-slate-500">可从客户资料选择已有收货信息；带出后可编辑本单内容，不会修改客户资料。</p>{selectedShippingContacts.length ? <label className="mb-3 block text-sm">选择客户资料中的收货信息<AppSelect className={field} aria-label="选择客户资料中的客户收货信息" value={customerDeliveryProfileIndex} openOnMount={openCustomerDeliverySelector} onChange={(event) => { markUnsaved(); setOpenCustomerDeliverySelector(false); const index = event.target.value; setCustomerDeliveryProfileIndex(index); const chosen = index === "" ? null : selectedShippingContacts[Number(index)]; setRecipient(chosen?.recipient || selectedCustomer?.contact_name?.trim() || ""); setPhone(chosen?.phone || selectedCustomer?.phone || "");  setAddress(chosen?.address || ""); }}><option value="">请选择或手动填写</option>{selectedShippingContacts.map((item, index) => <option key={`${index}-${item.address}`} value={String(index)}>{`${item.recipient || "未填写收货人"} | ${item.phone || "未填写电话"} | ${item.address || "未填写地址"}`}</option>)}</AppSelect></label> : null}<div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">收货人<Required /><input className={field} required maxLength={200} value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>
        <label className="text-sm">电话<Required /><input className={field} type="tel" required maxLength={100} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <label className="text-sm sm:col-span-2">收货地址<Required /><textarea className={`${field} min-h-20 resize-y py-2`} required maxLength={500} value={address} onChange={(event) => { markUnsaved(); setAddress(event.target.value); }} placeholder="输入或选择客户资料中的收货地址" rows={2} /></label>
      </div></> : <p className="mt-2 text-xs text-slate-500">本单不使用客户收货信息</p>}</div>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-4"><label className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={useForwarderDelivery} onChange={(event) => { markUnsaved(); setUseForwarderDelivery(event.target.checked); setOpenForwarderDeliverySelector(event.target.checked && selectedForwarderContacts.length > 0); if (event.target.checked) { const index = selectedForwarderContacts.length === 1 ? "0" : ""; const chosen = index ? selectedForwarderContacts[0] : null; setForwarderDeliveryProfileIndex(index); setForwarderAddress(chosen?.address || ""); setForwarderRecipient(chosen?.recipient || ""); setForwarderPhone(chosen?.phone || ""); } else { setForwarderDeliveryProfileIndex(""); setForwarderAddress(""); setForwarderRecipient(""); setForwarderPhone(""); } }} />添加货代收货信息</label>{useForwarderDelivery ? <><p className="mb-3 mt-2 text-xs text-slate-500">可从客户资料选择已有货代收货信息；带出后可编辑本单内容，不会修改客户资料。</p>
        {selectedForwarderContacts.length ? <label className="mb-3 block text-sm">选择客户资料中的货代收货信息<AppSelect className={field} aria-label="选择客户资料中的货代收货信息" value={forwarderDeliveryProfileIndex} openOnMount={openForwarderDeliverySelector} onChange={(event) => { markUnsaved(); setOpenForwarderDeliverySelector(false); const index = event.target.value; setForwarderDeliveryProfileIndex(index); const chosen = index === "" ? null : selectedForwarderContacts[Number(index)]; setForwarderAddress(chosen?.address || ""); setForwarderRecipient(chosen?.recipient || ""); setForwarderPhone(chosen?.phone || ""); }}><option value="">请选择或手动填写</option>{selectedForwarderContacts.map((item, index) => <option key={`${index}-${item.address}`} value={String(index)}>{`${item.recipient || "未填写收货人"} | ${item.phone || "未填写电话"} | ${item.address || "未填写地址"}`}</option>)}</AppSelect></label> : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">收货人<Required /><input className={field} required maxLength={200} value={forwarderRecipient} onChange={(event) => { markUnsaved(); setForwarderRecipient(event.target.value); }} /></label><label className="text-sm">电话<Required /><input className={field} type="tel" required maxLength={100} value={forwarderPhone} onChange={(event) => { markUnsaved(); setForwarderPhone(event.target.value); }} /></label><label className="text-sm sm:col-span-2">收货地址<Required /><textarea className={`${field} min-h-20 resize-y py-2`} required maxLength={500} value={forwarderAddress} onChange={(event) => { markUnsaved(); setForwarderAddress(event.target.value); }} rows={2} /></label></div></> : <p className="mt-2 text-xs text-slate-500">本单不使用货代收货信息</p>}
      </div>
    </div></section>
    <section className="p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">PI产品明细</h2><p className="mt-1 text-xs text-slate-500">销售单价可任选 CNY 或{currency ? ` ${currency}` : "付款币种"}录入，另一币种自动换算；成本和利润按 CNY 核算。表格可横向滚动。</p>{currency !== "CNY" ? <fieldset className="mt-3 flex flex-wrap items-center gap-3 text-xs"><legend className="sr-only">PI单据报价显示方式</legend><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><input type="radio" name="pi-price-display-mode" checked={priceDisplayMode === "PAYMENT_ONLY"} onChange={() => { markUnsaved(); setPriceDisplayMode("PAYMENT_ONLY"); }} />{currency} 报价</label><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><input type="radio" name="pi-price-display-mode" checked={priceDisplayMode === "DUAL"} onChange={() => { markUnsaved(); setPriceDisplayMode("DUAL"); }} />CNY + {currency} 双报价</label></fieldset> : null}</div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => void downloadTemplate()} className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm text-blue-700"><FileDown size={16} />下载模板</button><input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => void importExcel(event.target.files?.[0])} /><button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm"><FileSpreadsheet size={16} />导入Excel</button><button type="button" onClick={() => void pasteRows()} className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm"><ClipboardPaste size={16} />粘贴表格</button><button type="button" onClick={() => { if (items.length < 500) { markUnsaved(); setItems((current) => [...current, newLine()]); } }} className="inline-flex h-9 items-center gap-1 rounded-lg bg-blue-50 px-3 text-sm text-blue-700"><Plus size={16} />添加产品</button><button type="button" onClick={() => setConfirmClearItems(true)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-rose-200 px-3 text-sm text-rose-700"><Trash2 size={16} />清空明细</button></div></div>
      <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[2050px] text-left text-xs"><thead className="bg-slate-50/70"><tr>{["序号", "产品类型 *", "产品品牌 *", "产品型号 *", "产品质量 *", "产品描述", "产品质量/描述中文（展示给后端）", "成本单价（CNY） *", "销售单价（¥） *", ...(currency !== "CNY" ? [`销售单价（${currency || "付款币种"}） *`] : []), "数量 *", "销售金额（¥）", ...(currency !== "CNY" ? [`销售金额（${currency || "付款币种"}）`] : []), "总利润（¥）", "利润率", "理货要求", "销售备注", "操作"].map((head) => <th key={head} className="whitespace-nowrap px-2 py-3 font-medium">{head.endsWith(" *") ? <>{head.slice(0, -2)}<Required /></> : head}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={index} className={`border-t border-slate-100 align-middle ${hasLineContent(item) && missingLineFields(item).length ? "bg-amber-50/70" : ""}`}>
        <td className="px-2 py-1.5">{index + 1}{hasLineContent(item) && missingLineFields(item).length ? <span className="mt-1 block whitespace-nowrap text-[11px] font-medium text-amber-700" title={`待补齐：${missingLineFields(item).join("、")}`}>待补齐</span> : null}</td>
        {(["item_name", "brand", "model", "quality", "description"] as const).map((key) => <td key={key} className="px-1.5 py-1.5"><PiLineTextArea label={`第${index + 1}行${({ item_name: "产品类型", brand: "产品品牌", model: "产品型号", quality: "产品质量", description: "产品描述" } as const)[key]}`} value={item[key]} invalid={key !== "description" && hasLineContent(item) && !item[key].trim()} onChange={(value) => editLine(index, key, value)} /></td>)}
        <td className="px-1.5 py-1.5"><PiLineTextArea label={`第${index + 1}行产品质量/描述中文（展示给后端）`} value={item.description_zh} onChange={(value) => editLine(index, "description_zh", value)} /></td>
        <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行预估成本`} aria-invalid={Boolean(hasLineContent(item) && !validPiMoney(item.estimated_unit_cost_cny))} className={`${field} h-9 w-28 ${hasLineContent(item) && !validPiMoney(item.estimated_unit_cost_cny) ? "border-amber-500" : ""}`} type="text" inputMode="decimal" maxLength={15} value={item.estimated_unit_cost_cny} onChange={(event) => { if (event.target.value === "" || /^(?:0|[1-9]\d{0,11})(?:\.\d{0,2})?$/.test(event.target.value)) editLine(index, "estimated_unit_cost_cny", event.target.value); }} /></td>
        <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行人民币单价`} aria-invalid={Boolean(hasLineContent(item) && !validPiMoney(item.unit_price_cny))} className={`${field} h-9 w-28 ${hasLineContent(item) && !validPiMoney(item.unit_price_cny) ? "border-amber-500" : validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && !validPiSellingPrice(item.unit_price_cny, item.estimated_unit_cost_cny) ? "border-rose-400" : ""}`} type="text" inputMode="decimal" maxLength={15} value={item.unit_price_cny} onChange={(event) => { if (event.target.value === "" || /^(?:0|[1-9]\d{0,11})(?:\.\d{0,2})?$/.test(event.target.value)) editUnitPrice(index, "CNY", event.target.value); }} />{validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && !validPiSellingPrice(item.unit_price_cny, item.estimated_unit_cost_cny) ? <span className="block text-[11px] text-rose-600">售价必须高于成本</span> : null}</td>
        {currency !== "CNY" ? <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行${currency}单价`} aria-invalid={Boolean(hasLineContent(item) && !validPiMoney(item.unit_price_payment))} className={`${field} h-9 w-28 ${hasLineContent(item) && !validPiMoney(item.unit_price_payment) ? "border-amber-500" : validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && !validPiSellingPrice(item.unit_price_cny, item.estimated_unit_cost_cny) ? "border-rose-400" : ""}`} type="text" inputMode="decimal" maxLength={15} value={item.unit_price_payment} onChange={(event) => { if (event.target.value === "" || /^(?:0|[1-9]\d{0,11})(?:\.\d{0,2})?$/.test(event.target.value)) editUnitPrice(index, "PAYMENT", event.target.value); }} />{importSource?.items[index] ? <span className="mt-1 block whitespace-nowrap text-[11px] text-amber-700">{importSource.source_kind === "SYSTEM_TEMPLATE" ? `模板单价 CNY ${importSource.items[index].unit_price_cny?.toFixed(2)}` : `原单价 ${currency} ${importSource.items[index].unit_price_payment.toFixed(2)}`}</span> : null}</td> : null}
        <td className="px-1.5 py-1.5"><input aria-label={`第${index + 1}行数量`} aria-invalid={Boolean(hasLineContent(item) && !validPiQuantity(item.quantity))} className={`${field} h-9 w-20 ${hasLineContent(item) && !validPiQuantity(item.quantity) ? "border-amber-500" : ""}`} type="text" inputMode="numeric" maxLength={10} value={item.quantity} onChange={(event) => { if (event.target.value === "" || /^[1-9]\d{0,9}$/.test(event.target.value)) editLine(index, "quantity", event.target.value); }} /></td>
        <td className="whitespace-nowrap px-2 py-1.5 font-medium">{validPiMoney(item.unit_price_cny) && validPiQuantity(item.quantity) ? `¥${roundMoney(Number(item.quantity) * Number(item.unit_price_cny)).toFixed(2)}` : "—"}</td>
        {currency !== "CNY" ? <td className="whitespace-nowrap px-2 py-1.5 font-medium text-blue-700">{validPiMoney(item.unit_price_payment) && validPiQuantity(item.quantity) ? `${currency} ${roundMoney(Number(item.quantity) * Number(item.unit_price_payment)).toFixed(2)}` : "—"}</td> : null}
        <td className={`whitespace-nowrap px-2 py-1.5 ${validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && !validPiSellingPrice(item.unit_price_cny, item.estimated_unit_cost_cny) ? "text-rose-600" : ""}`}>{validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && validPiQuantity(item.quantity) ? `¥${roundMoney((Number(item.unit_price_cny) - Number(item.estimated_unit_cost_cny)) * Number(item.quantity)).toFixed(2)}` : "—"}</td>
        <td className={`whitespace-nowrap px-2 py-1.5 font-medium ${validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && !validPiSellingPrice(item.unit_price_cny, item.estimated_unit_cost_cny) ? "text-rose-600" : "text-emerald-700"}`}>{validPiMoney(item.unit_price_cny) && validPiMoney(item.estimated_unit_cost_cny) && Number(item.unit_price_cny) > 0 ? `${((Number(item.unit_price_cny) - Number(item.estimated_unit_cost_cny)) / Number(item.unit_price_cny) * 100).toFixed(2)}%` : "—"}</td>
        <td className="px-1.5 py-1.5"><div className="flex min-w-56 items-start gap-1.5"><div className="min-w-0 flex-1"><PiLineTextArea label={`第${index + 1}行理货要求`} value={item.preparation_requirement} onChange={(value) => editLine(index, "preparation_requirement", value)} /></div><RequirementImagePicker lineIndex={index} pending={pendingRequirementFiles} existing={existingRequirementAttachments} onAdd={addRequirementFiles} onRemove={removeRequirementFile} onRemoveExisting={draftOrderId ? removeExistingRequirementFile : undefined}/></div></td>
        <td className="px-1.5 py-1.5"><PiLineTextArea label={`第${index + 1}行销售备注`} value={item.internal_note} onChange={(value) => editLine(index, "internal_note", value)} /></td>
        <td className="px-2 py-1.5"><div className="flex gap-2"><button type="button" title="复制该产品行" aria-label={`复制第${index + 1}行`} disabled={items.length >= 500} onClick={() => { if (existingRequirementAttachments.some((entry) => !entry.archived && entry.display_line_number !== null && entry.display_line_number > index + 1)) { setError("后续产品已有理货图片，请先删除对应图片再插入产品行"); return; } markUnsaved(); setItems((current) => [...current.slice(0, index + 1), { ...current[index] }, ...current.slice(index + 1)]); setPendingRequirementFiles((current) => current.map((entry) => entry.lineIndex !== null && entry.lineIndex > index ? { ...entry, lineIndex: entry.lineIndex + 1 } : entry)); }} className="text-blue-600 disabled:opacity-30"><Copy size={16} /></button><button type="button" title="删除该产品行" aria-label={`删除第${index + 1}行`} disabled={items.length === 1} onClick={() => { if (existingRequirementAttachments.some((entry) => !entry.archived && entry.display_line_number !== null && entry.display_line_number >= index + 1)) { setError("本行或后续产品已有理货图片，请先删除对应图片再移除产品行"); return; } markUnsaved(); setItems((current) => current.filter((_, position) => position !== index)); setPendingRequirementFiles((current) => current.flatMap((entry) => entry.lineIndex === index ? [] : [entry.lineIndex !== null && entry.lineIndex > index ? { ...entry, lineIndex: entry.lineIndex - 1 } : entry])); }} className="text-rose-600 disabled:opacity-30"><Trash2 size={16} /></button></div></td>
      </tr>)}</tbody></table></div>
      <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm" aria-live="polite"><span>产品总金额（RMB）：<strong>¥{totals.subtotalCny.toFixed(2)}</strong></span><span>产品总利润（RMB）：<strong className={totals.totalProfitCny !== null && totals.totalProfitCny < 0 ? "text-rose-600" : ""}>{totals.totalProfitCny === null ? "待填写成本" : `¥${totals.totalProfitCny.toFixed(2)}`}</strong></span><span>产品总利润率：<strong className={totals.totalProfitCny !== null && totals.totalProfitCny < 0 ? "text-rose-600" : ""}>{totals.totalProfitCny === null ? "待填写成本" : totals.subtotalCny > 0 ? `${(totals.totalProfitCny / totals.subtotalCny * 100).toFixed(2)}%` : "—"}</strong></span></div>
    </section>
    <section className="grid items-stretch gap-5 border-t border-slate-100 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]"><div className={`grid h-full min-w-0 items-stretch gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 ${recalledDraft ? "lg:grid-cols-2" : ""}`}>{recalledDraft ? <div className="flex min-w-0 flex-col"><label htmlFor="pi-change-note" className="text-sm">订单变更说明（选填）</label><textarea id="pi-change-note" className={`${field} min-h-48 flex-1 py-2`} rows={6} maxLength={2000} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="每行填写一项变更，保存后自动按 1、2、3 编号" />{changeNote.trim() ? <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-500">{numberedPiChangeNote(changeNote)}</p> : null}</div> : null}<div className="flex min-w-0 flex-col"><div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="pi-stocking-requirements" className="text-sm">整单理货要求（选填）</label><button type="button" disabled={!selectedCustomer?.tally_requirements?.trim()} onClick={() => setShowCustomerTally(true)} className="text-xs font-medium text-blue-700 disabled:text-slate-400">查看客户资料理货要求</button></div><textarea id="pi-stocking-requirements" className={`${field} min-h-48 flex-1 py-2`} rows={6} maxLength={2000} value={stockingRequirements} onChange={(event) => setStockingRequirements(event.target.value)} placeholder="本栏位详细说明标签/印章/保护膜等作业的要求，无要求则备注常规理货" /><RequirementImagePicker lineIndex={null} pending={pendingRequirementFiles} existing={existingRequirementAttachments} onAdd={addRequirementFiles} onRemove={removeRequirementFile} onRemoveExisting={draftOrderId ? removeExistingRequirementFile : undefined}/><p className="mt-1 text-xs text-slate-500">整单最多 5 张；每个产品项最多 3 张；单张不超过 5MB。提交仓库前须全部上传成功。</p></div></div>
      <div className="min-w-0 w-full rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm"><h2 className="font-semibold text-slate-900">PI费用汇总</h2><p className="mt-1 text-xs text-slate-500">勾选需要的项目并输入正数金额；人民币与付款币种可任填一栏，另一栏自动换算。运费同样支持双币种输入；未付尾款、其他费用和 PayPal 手续费加收，折扣扣减。</p><div className="mt-4 grid grid-cols-[minmax(7rem,1fr)_minmax(5.5rem,6.5rem)_minmax(5.5rem,6.5rem)] items-center gap-x-2 gap-y-2 text-right tabular-nums text-slate-600"><span></span><span>CNY</span><span>{currency}</span><span className="text-left">产品小计</span><span>¥{totals.subtotalCny.toFixed(2)}</span><span>{totals.subtotalPayment.toFixed(2)}</span><label htmlFor="pi-shipping-cny" className="text-left">运费</label><div className="relative min-w-0"><span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500">¥</span><input id="pi-shipping-cny" aria-label="人民币运费" className="h-8 w-full min-w-0 rounded border border-slate-300 bg-white pl-5 pr-2 text-right" type="text" inputMode="decimal" value={shippingSource === "CNY" ? shippingInput : shippingPair.cny} onChange={(event) => { if (/^\d*(?:\.\d{0,2})?$/.test(event.target.value)) { markUnsaved(); setShippingSource("CNY"); setShippingInput(event.target.value); } }} onBlur={() => { if (shippingSource === "CNY" && shippingInput.trim()) setShippingInput(Number(shippingInput).toFixed(2)); }} /></div><input aria-label={`${currency}运费`} className="h-8 w-full min-w-0 rounded border border-slate-300 bg-white px-2 text-right" type="text" inputMode="decimal" value={shippingSource === "PAYMENT" ? shippingInput : shippingPair.payment} onChange={(event) => { if (/^\d*(?:\.\d{0,2})?$/.test(event.target.value)) { markUnsaved(); setShippingSource("PAYMENT"); setShippingInput(event.target.value); } }} onBlur={() => { if (shippingSource === "PAYMENT" && shippingInput.trim()) setShippingInput(Number(shippingInput).toFixed(2)); }} />
      {([ ["last_balance", "未付尾款"], ["discount", "折扣（扣减）"], ["other", "其他费用"] ] as const).map(([key, label]) => <div key={key} className="contents"><label className="flex items-center gap-1 text-left"><input type="checkbox" checked={feeFields[key].enabled} onChange={(event) => changeFee(key, { enabled: event.target.checked })} />{label}<span className={key === "discount" ? "text-rose-600" : "text-emerald-700"} aria-hidden="true">{key === "discount" ? "−" : "+"}</span></label>{(["CNY", "PAYMENT"] as const).map((source) => <input key={source} aria-label={`${label}${source === "CNY" ? "人民币" : currency}金额`} disabled={!feeFields[key].enabled} className="h-8 min-w-0 rounded border border-slate-300 bg-white px-2 text-right disabled:bg-slate-100" type="text" inputMode="decimal" value={feeDisplay(key, source)} onChange={(event) => { if (/^\d*(?:\.\d{0,2})?$/.test(event.target.value)) changeFee(key, { source, amount: event.target.value }); }} onBlur={() => { const amount = feeFields[key].amount; if (feeFields[key].enabled && amount.trim()) changeFee(key, { amount: Number(amount).toFixed(2) }); }} />)}</div>)}
      {paymentMethod === "PayPal" ? <>
        <label htmlFor="pi-paypal-rate" className="flex min-w-0 items-center gap-1 whitespace-nowrap text-left text-xs">
          <span>PayPal 手续费（</span>
          <input id="pi-paypal-rate" aria-label="PayPal手续费百分比" className="h-8 w-12 min-w-0 rounded border border-slate-300 bg-white px-1 text-center font-semibold text-blue-700 focus:border-blue-500 focus:outline-none" type="text" inputMode="decimal" value={paypalRateInput} onChange={(event) => { if (/^\d*(?:\.\d{0,4})?$/.test(event.target.value)) { markUnsaved(); setPaypalRateInput(event.target.value); } }} />
          <span>%）</span>
        </label>
        <span aria-label="PayPal人民币手续费金额">¥{feeCalculation.value?.paypalFee.cny.toFixed(2) || "—"}</span>
        <span aria-label={`PayPal ${currency} 手续费金额`}>{feeCalculation.value?.paypalFee.payment.toFixed(2) || "—"}</span>
      </> : null}
      <span className="border-t pt-2 text-left font-semibold text-slate-900">PI总额</span><span className="border-t pt-2 font-semibold text-slate-900">¥{feeCalculation.value?.totalCny.toFixed(2) || "—"}</span><span className="border-t pt-2 font-semibold text-blue-700">{feeCalculation.value?.totalPayment.toFixed(2) || "—"}</span></div>{feeCalculation.error && effectiveRate > 0 ? <p role="alert" className="mt-2 text-xs text-rose-700">{feeCalculation.error}</p> : null}</div>
    </section>
    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4"><button type="button" disabled={busy || loadingDraft || !availableAccounts.length || Boolean(savedDraftId)} onClick={() => void create()} className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">{busy ? "处理中…" : "保存PI草稿"}</button><button type="button" disabled={busy || loadingDraft || !availableAccounts.length || !canSubmitDraft || Boolean(savedDraftId)} onClick={() => setConfirmSubmit(true)} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50">确认并生成备货单</button></div>
    </fieldset>
    </div>
    <ConfirmDialog open={pendingLeaveUrl !== ""} title="当前 PI 内容尚未保存" description="离开后，当前尚未保存的填写内容将丢失。建议先保存 PI 草稿。" confirmLabel="放弃填写并离开" danger onCancel={() => setPendingLeaveUrl("")} onConfirm={() => { const url = pendingLeaveUrl; hasUnsavedChanges.current = false; setPendingLeaveUrl(""); window.location.assign(url); }} />
    <ConfirmDialog open={pendingHistoryBack} title="当前 PI 内容尚未保存" description="后退将丢失当前尚未保存的填写内容。建议先保存 PI 草稿。" confirmLabel="放弃填写并后退" danger onCancel={() => setPendingHistoryBack(false)} onConfirm={() => { hasUnsavedChanges.current = false; setPendingHistoryBack(false); window.history.go(-2); }} />
    <ConfirmDialog open={confirmClearItems} title="确认清空产品明细？" description={`当前表单内的 ${items.length} 行产品将清空。已保存的 PI 草稿不会因此立即改变。`} confirmLabel="确认清空" danger onCancel={() => setConfirmClearItems(false)} onConfirm={() => { setConfirmClearItems(false); if (existingRequirementAttachments.some((entry) => entry.display_line_number !== null)) { setError("产品行已有理货图片，请先逐项删除图片再清空明细"); return; } markUnsaved(); setItems([newLine()]); setPendingRequirementFiles((current) => current.filter((entry) => entry.lineIndex === null)); }} />
    <ConfirmDialog open={confirmSubmit} title="确认提交PI给仓库？" description="系统将先保存当前PI，再生成仓库可见的备货单。提交后不能直接修改产品或价格；仓库未开始备货前可撤回。" confirmLabel="确认并生成备货单" busy={busy} onCancel={() => { if (!busy) setConfirmSubmit(false); }} onConfirm={() => { setConfirmSubmit(false); void create(true); }} />
    <ConfirmDialog open={importDifferences.length > 0} title="导入数据与原Excel不一致" description={importDifferences.join("；") + `。请逐项核对；确认后${submitAfterImportDifferences ? "将保存PI并生成备货单" : "将保存为PI草稿"}。`} confirmLabel={submitAfterImportDifferences ? "已核对，确认生成备货单" : "已核对，保存PI草稿"} busy={busy} onCancel={() => { setImportDifferences([]); setSubmitAfterImportDifferences(false); }} onConfirm={() => { const shouldSubmit = submitAfterImportDifferences; setImportDifferences([]); setSubmitAfterImportDifferences(false); void create(shouldSubmit, true); }} />
    {showAccountDetails && selectedAccount ? <AppDialog title={`${selectedAccount.label} · 收款账户`} description="此账户信息会在保存PI时固化，之后管理员修改账户不会改写已保存的PI。" onClose={() => setShowAccountDetails(false)}><p className="whitespace-pre-wrap break-all text-sm leading-6 text-slate-700">{selectedAccount.instructions}</p></AppDialog> : null}
    {showCustomerTally && selectedCustomer?.tally_requirements ? <AppDialog title="客户资料理货要求" description={`${selectedCustomer.company_name} · 只读参考；复制后可粘贴到本单理货要求或产品明细。`} onClose={() => { setShowCustomerTally(false); setTallyCopyMessage(""); }}><div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-slate-50 p-3 text-sm leading-6 text-slate-700">{selectedCustomer.tally_requirements}</div><div className="mt-3 flex flex-wrap items-center justify-end gap-3"><span role="status" className="text-xs text-slate-600">{tallyCopyMessage}</span><button type="button" onClick={() => void copyCustomerTally()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white">复制理货要求</button></div></AppDialog> : null}
    {pasteFallbackOpen ? <AppDialog title="粘贴产品明细" description="浏览器暂时无法直接读取剪贴板。请点击下方输入框并按 Ctrl+V；只复制产品明细表格即可，无需复制 PI 抬头。系统会继续自动识别币种、汇率和各产品列。" onClose={() => { setPasteFallbackOpen(false); setPasteFallbackText(""); }} width="max-w-3xl">{error ? <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}<textarea autoFocus aria-label="粘贴产品明细表格" value={pasteFallbackText} onChange={(event) => setPasteFallbackText(event.target.value)} rows={10} placeholder="点击此处后按 Ctrl+V 粘贴 Excel 产品明细" className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs leading-5 focus:border-blue-500 focus:outline-none"/><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => { setPasteFallbackOpen(false); setPasteFallbackText(""); }} className="h-10 rounded-lg border border-slate-200 px-4 text-sm">取消</button><button type="button" onClick={() => void importPastedText(pasteFallbackText)} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white">识别并导入</button></div></AppDialog> : null}
  </div></main>;
}
