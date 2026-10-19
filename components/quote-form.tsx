"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Copy,
  FileDown,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  Minus,
  Paperclip,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import type { QuoteItem, QuoteStatus } from "@/lib/types";
import { QUOTE_STATUS_LABELS } from "@/lib/types";
import { summarizeProductSpecifications, type ProductFamily } from "@/lib/product-specifications";
import { initialQuoteUnitPrice } from "@/lib/product-pricing";
import { QUOTE_CURRENCIES } from "@/lib/currencies";
import { COUNTRY_OPTIONS, countryInfo, countrySearchTokens } from "@/lib/countries";
import { CountryLabel } from "@/components/country-label";
import {
  AppDialog,
  ConfirmDialog,
  DialogActions,
} from "@/components/ui/app-dialog";
import { AttachmentPreview } from "@/components/ui/attachment-preview";

type CustomerOption = {
  id: string;
  company_name: string;
  country?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
};
const PAYMENT_METHOD_OPTIONS=[
  ["T/T (Bank Transfer)","银行电汇"],["T/T 100% Before Shipment","发货前付清"],["T/T 30% Deposit, 70% Before Shipment","30% 定金，发货前付清余款"],["PayPal","PayPal"],["Wise","Wise"],["Letter of Credit (L/C)","信用证"],["Western Union","西联汇款"],["Credit Card","信用卡"],
] as const;
type QuoteData = {
  id: string;
  customer_id: string;
  quote_number: string;
  currency: string;
  status: QuoteStatus;
  valid_until: string | null;
  payment_method: string | null;
  delivery_date: string | null;
  customer_short_name: string | null;
  destination_country: string | null;
  shipping_cost: number;
  notes: string | null;
  total_amount: number;
  customer?: CustomerOption | null;
};
type Attachment = {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};
type QuoteProduct = {
  id:string;sku:string;supplier_code:string|null;name_zh:string;name_en:string|null;brand:string|null;model:string|null;quality:string|null;color:string|null;specifications:Record<string,string>|null;category:{product_family:ProductFamily}|null;description_en:string|null;unit:string;minimum_order_quantity:number;
  total_cost_cny:number|null;suggested_price_usd:number;sale_reference_usd:number|null;exchange_rate:number;pricing_rule:Record<string,unknown>;quantity:number;
};
type Detail = {
  quote: QuoteData;
  items: QuoteItem[];
  attachments: Attachment[];
  sales_order?: { id: string; order_number: string; status: string } | null;
  stock_order?: { id: string; stock_number: string; status: string } | null;
  can_edit: boolean;
  can_attach: boolean;
  can_revise: boolean;
  can_confirm: boolean;
  can_cancel: boolean;
  can_delete: boolean;
};
const emptyItem = (): QuoteItem => ({
  line_number: 1,
  item_name: "",
  brand: "",
  model: "",
  quality: "",
  description: "",
  description_zh: null,
  quantity: 1,
  unit_price: 0,
  procurement_cost: 0,
  preparation_requirement: null,
});
const countryDisplayName = (value?: string | null) =>
  String(value || "").trim() ? countryInfo(value).name : "";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function ValidatedNumberInput({ value, onValueChange, onBlur, integer = false, blankZero = false, disabled, className }: {
  value: number; onValueChange: (value: number) => void; integer?: boolean; blankZero?: boolean;
  disabled?: boolean; className: string; onBlur?: () => void;
}) {
  const [draft, setDraft] = useState(value === 0 && blankZero ? "" : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value === 0 && blankZero ? "" : String(value));
  }, [value, blankZero]);
  return <input
    disabled={disabled}
    type="text"
    inputMode={integer ? "numeric" : "decimal"}
    value={draft}
    onFocus={() => { focused.current = true; }}
    onChange={(event) => {
      const raw = event.target.value;
      if (integer ? /^\d{0,8}$/.test(raw) : /^\d{0,12}(?:\.\d{0,2})?$/.test(raw) && Number(raw) <= 999999999999.99) {
        setDraft(raw);
        onValueChange(Number(raw || 0));
      }
    }}
    onBlur={() => { focused.current = false; setDraft(value === 0 && blankZero ? "" : String(value)); onBlur?.(); }}
    className={className}
  />;
}

export function QuoteForm({
  quoteId,
  initialCustomerId = "",
}: {
  quoteId?: string;
  initialCustomerId?: string;
}) {
  const editing = Boolean(quoteId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [message, setMessage] = useState("");
  const [productQuery,setProductQuery]=useState("");
  const [productOptions,setProductOptions]=useState<QuoteProduct[]>([]);
  const [productSearching,setProductSearching]=useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState({
    order_number: "",
    method: "WhatsApp",
    note: "",
  });
  const [pendingConfirm, setPendingConfirm] = useState<{
    kind: "attachment" | "draft" | "revise" | "clear" | "sent";
    id?: string;
  } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [currencyOpen,setCurrencyOpen]=useState(false);
  const [currencyQuery,setCurrencyQuery]=useState("");
  const currencyPickerRef=useRef<HTMLDivElement|null>(null);
  const [countryOpen,setCountryOpen]=useState(false);
  const [countryQuery,setCountryQuery]=useState("");
  const countryPickerRef=useRef<HTMLDivElement|null>(null);
  const [paymentOpen,setPaymentOpen]=useState(false);
  const paymentPickerRef=useRef<HTMLDivElement|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachmentRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    customer_id: initialCustomerId,
    currency: "USD",
    valid_until: "",
    payment_method: "T/T (Bank Transfer)",
    delivery_date: "",
    customer_short_name: "",
    destination_country: "",
    shipping_cost: 0,
    notes: "",
    status: "DRAFT" as QuoteStatus,
    items: [emptyItem()],
  });
  const filteredCurrencies=useMemo(()=>{const query=currencyQuery.trim().toLocaleLowerCase();return QUOTE_CURRENCIES.filter(([code,label])=>!query||code.toLocaleLowerCase().includes(query)||label.toLocaleLowerCase().includes(query)).slice(0,40)},[currencyQuery]);
  const filteredCountries=useMemo(()=>{const query=countryQuery.trim().toLocaleLowerCase();return COUNTRY_OPTIONS.filter(country=>!query||[...countrySearchTokens(country.code),country.englishName].some(token=>token.toLocaleLowerCase().includes(query))).slice(0,40)},[countryQuery]);
  useEffect(()=>{const close=(event:MouseEvent)=>{const target=event.target as Node;if(currencyPickerRef.current&&!currencyPickerRef.current.contains(target))setCurrencyOpen(false);if(countryPickerRef.current&&!countryPickerRef.current.contains(target))setCountryOpen(false);if(paymentPickerRef.current&&!paymentPickerRef.current.contains(target))setPaymentOpen(false)};document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close)},[]);
  useEffect(() => {
    void (async () => {
      const [listResponse, exactResponse] = await Promise.all([
        fetch("/api/customers?pageSize=200&ai_status=all&sort=updated_at"),
        initialCustomerId
          ? fetch(`/api/customers/${initialCustomerId}`, { cache: "no-store" })
          : Promise.resolve(null),
      ]);
      const listBody = await listResponse.json().catch(() => ({}));
      const exactBody = exactResponse
        ? await exactResponse.json().catch(() => ({}))
        : null;
      if (!listResponse.ok) return;
      const options = (listBody.data || []) as CustomerOption[];
      const exact =
        exactResponse?.ok && exactBody?.id
          ? (exactBody as CustomerOption)
          : null;
      const merged =
        exact && !options.some((item) => item.id === exact.id)
          ? [exact, ...options]
          : options;
      setCustomers(merged);
      const customer =
        exact || merged.find((item) => item.id === initialCustomerId);
      if (customer)
        setForm((current) => ({
          ...current,
          customer_id: customer.id,
          customer_short_name: customer.company_name,
          destination_country: countryDisplayName(customer.country),
        }));
    })();
  }, [initialCustomerId]);
  useEffect(() => {
    if (!quoteId) return;
    void (async () => {
      setLoading(true);
      const response = await fetch(`/api/quotes/${quoteId}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      setLoading(false);
      if (!response.ok) {
        setMessage(body.error || "报价详情加载失败");
        return;
      }
      setDetail(body);
      const q = body.quote as QuoteData;
      setForm({
        customer_id: q.customer_id,
        currency: q.currency,
        valid_until: q.valid_until || "",
        payment_method: q.payment_method || "",
        delivery_date: q.delivery_date || "",
        customer_short_name:
          q.customer_short_name || q.customer?.company_name || "",
        destination_country: countryDisplayName(
          q.destination_country || q.customer?.country,
        ),
        shipping_cost: Number(q.shipping_cost || 0),
        notes: q.notes || "",
        status: q.status,
        items: (body.items || []).map((item: QuoteItem, index: number) => ({...item,line_number:index+1})),
      });
    })();
  }, [quoteId]);
  const canEdit = !editing || Boolean(detail?.can_edit);
  const totals = useMemo(() => {
    const subtotal = form.items.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
      0,
    );
    return { subtotal, total: subtotal + Number(form.shipping_cost || 0) };
  }, [form.items, form.shipping_cost]);
  function selectCustomer(id: string) {
    const customer = customers.find((x) => x.id === id);
    setForm((current) => ({
      ...current,
      customer_id: id,
      customer_short_name:
        customer?.company_name || current.customer_short_name,
      destination_country: customer?.country
        ? countryDisplayName(customer.country)
        : current.destination_country,
    }));
  }
  function updateItem(
    index: number,
    key: keyof QuoteItem,
    value: string | number,
  ) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, row) =>
        row === index ? { ...item, [key]: value } : item,
      ),
    }));
  }
  function addItem() {
    setForm((current) => ({
      ...current,
      items: [
        ...current.items,
        { ...emptyItem(), line_number: current.items.length + 1 },
      ],
    }));
  }
  async function searchProducts(){setProductSearching(true);try{const params=new URLSearchParams({q:productQuery,quantity:"1"});const response=await fetch(`/api/quote-products?${params}`,{cache:"no-store"});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||"可报价商品加载失败");setProductOptions(body.data||[])}catch(cause){setProductOptions([]);setMessage(cause instanceof Error?cause.message:"可报价商品加载失败，请重试")}finally{setProductSearching(false)}}
  function addProduct(product:QuoteProduct){
    const initialPrice=initialQuoteUnitPrice(product.suggested_price_usd,product.sale_reference_usd);
    const item:QuoteItem={...emptyItem(),product_id:product.id,product_sku_snapshot:product.sku,supplier_code_snapshot:product.supplier_code,product_color_snapshot:product.color,product_specifications_snapshot:product.specifications,item_name:product.name_en||product.name_zh,brand:product.brand||"",model:product.model||"",quality:product.quality||"",description:product.description_en||"",quantity:Math.max(1,Math.ceil(Number(product.minimum_order_quantity)||1)),unit_price:initialPrice,procurement_cost:0,unit_cost_cny:product.total_cost_cny,suggested_unit_price:product.suggested_price_usd||null,exchange_rate_snapshot:Number(product.exchange_rate||0),pricing_rule_snapshot:product.pricing_rule};
    setForm(current=>{const hasOnlyEmpty=current.items.length===1&&!current.items[0].item_name;const rows=hasOnlyEmpty?[item]:[...current.items,item];return{...current,items:rows.map((row,index)=>({...row,line_number:index+1}))}});
    setProductOptions([]);setProductQuery("");setMessage(product.total_cost_cny===null?`已添加 ${product.sku}。完整成本未确认，系统未计算成本建议价；${product.sale_reference_usd?"已预填美元销售参考价，":"未设置美元销售参考价，"}请核对实际销售价。`:`已添加 ${product.sku} · ${product.name_zh}，请核对数量和实际销售价。`);
  }
  async function refreshItemPricing(index:number,item:QuoteItem){
    if(!item.product_id)return;
    const params=new URLSearchParams({q:item.product_sku_snapshot||item.item_name,quantity:String(item.quantity)});
    const response=await fetch(`/api/quote-products?${params}`,{cache:"no-store"});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){setMessage(body.error||"商品价格重新计算失败，请重试后保存报价");return}
    const product=(body.data||[]).find((row:QuoteProduct)=>row.id===item.product_id) as QuoteProduct|undefined;
    if(!product){setMessage("未找到当前商品，请重新搜索核对价格");return}
    setForm(current=>({...current,items:current.items.map((row,rowIndex)=>rowIndex===index&&row.product_id===item.product_id&&row.quantity===item.quantity?{...row,unit_cost_cny:product.total_cost_cny,suggested_unit_price:product.suggested_price_usd||null,exchange_rate_snapshot:Number(product.exchange_rate||0),pricing_rule_snapshot:product.pricing_rule}:row)}));
    if(product.total_cost_cny===null)setMessage("当前数量的采购价、包装费或其他成本尚未全部确认；系统未计算建议价，请核对后报价。");
  }
  function insertItem(index: number) {
    setForm((current) => {
      const rows = [...current.items];
      rows.splice(index + 1, 0, { ...emptyItem() });
      return {
        ...current,
        items: rows.map((item, row) => ({ ...item, line_number: row + 1 })),
      };
    });
  }
  function duplicateItem(index: number) {
    setForm((current) => {
      const rows = [...current.items];
      rows.splice(index + 1, 0, { ...current.items[index] });
      return {
        ...current,
        items: rows.map((item, row) => ({
          ...item,
          id: undefined,
          line_number: row + 1,
        })),
      };
    });
  }
  function removeItem(index: number) {
    setForm((current) => ({
      ...current,
      items: current.items
        .filter((_, row) => row !== index)
        .map((item, row) => ({ ...item, line_number: row + 1 })),
    }));
  }
  function clearItems() {
    setForm((current) => ({ ...current, items: [] }));
    setMessage("产品明细已清空。保存前请添加至少一条产品明细。");
    setPendingConfirm(null);
  }
  async function pasteRows() {
    try {
      const raw = await navigator.clipboard.readText();
      const rows = raw
        .split(/\r?\n/)
        .map((line) => line.split("\t"))
        .filter((row) => row.some((cell) => cell.trim()));
      if (!rows.length) {
        window.dispatchEvent(new CustomEvent("dtsmart-toast",{detail:{message:"剪贴板中没有可识别的表格数据",type:"info"}}));
        return;
      }
      const imported = rows
        .map((row, index) => ({
          ...emptyItem(),
          line_number: index + 1,
          item_name: (row[0] || "").trim(),
          brand: (row[1] || "").trim(),
          model: (row[2] || "").trim(),
          quality: (row[3] || "").trim(),
          description: (row[4] || "").trim(),
          quantity: Math.max(1,Math.round(Number(row[5] || 1))),
          unit_price: Number(row[6] || 0),
        }))
        .filter((item) => item.item_name);
      if (!imported.length)
        throw new Error(
          "请按产品、品牌、型号、质量、描述、数量、销售单价的列顺序复制",
        );
      setForm((current) => ({ ...current, items: imported }));
      setMessage(`已从剪贴板粘贴 ${imported.length} 条产品明细，请核对。`);
    } catch (error) {
      const text=error instanceof Error ? error.message : "读取剪贴板失败";
      window.dispatchEvent(new CustomEvent("dtsmart-toast",{detail:{message:text,type:"error"}}));
    }
  }
  async function importExcel(file?: File) {
    if (!file) return;
    setMessage("");
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = book.Sheets[book.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
      });
      const headerIndex = rows.findIndex(
        (row) =>
          Array.isArray(row) &&
          row.some((cell) => /Items|产品类型|产品名称/i.test(String(cell))),
      );
      if (headerIndex < 0) throw new Error("没有识别到产品明细表头");
      const headers = (rows[headerIndex] as unknown[]).map((x) =>
        String(x).trim(),
      );
      const index = (patterns: RegExp[]) =>
        headers.findIndex((value) =>
          patterns.some((pattern) => pattern.test(value)),
        );
      const indices = {
        item: index([/Items/i, /产品类型/, /产品名称/]),
        brand: index([/Brand/i, /产品品牌/]),
        model: index([/Models?/i, /产品型号/]),
        quality: index([/Quality/i, /产品质量/]),
        description: index([/Description/i, /产品描述/]),
        unit: index([/Unit Price/i, /销售单价/]),
        quantity: index([/Quantity/i, /订单数量/]),
      };
      const imported = rows
        .slice(headerIndex + 1)
        .filter(
          (row) => Array.isArray(row) && String(row[indices.item] ?? "").trim(),
        )
        .map((row, line) => ({
          ...emptyItem(),
          line_number: line + 1,
          item_name: String(row[indices.item] ?? "").trim(),
          brand: String(row[indices.brand] ?? "").trim(),
          model: String(row[indices.model] ?? "").trim(),
          quality: String(row[indices.quality] ?? "").trim(),
          description: String(row[indices.description] ?? "").trim(),
          unit_price: Number(row[indices.unit] || 0),
          quantity: Math.max(1,Math.round(Number(row[indices.quantity] || 1))),
        }));
      if (!imported.length) throw new Error("文件中没有有效产品明细");
      setForm((current) => ({ ...current, items: imported }));
      setMessage(
        `已导入 ${imported.length} 条客户报价产品明细，请核对数量和销售价。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "明细导入失败");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function save(status: QuoteStatus) {
    if (!form.items.length) {
      setMessage("请至少添加一条产品明细");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await fetch(
      editing ? `/api/quotes/${quoteId}` : "/api/quotes",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, status }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error || "保存失败");
      return;
    }
    const id = body.data?.id || quoteId;
    window.location.href = `/quotes/${id}`;
  }
  async function action(path: string, body?: object) {
    setBusy(true);
    setMessage("");
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error || "操作失败");
      return;
    }
    window.location.reload();
  }
  async function uploadAttachment(file?: File) {
    if (!file || !quoteId) return;
    setBusy(true);
    setMessage("");
    const payload = new FormData();
    payload.set("file", file);
    payload.set("quote_id", quoteId);
    const response = await fetch("/api/attachments", {
      method: "POST",
      body: payload,
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (attachmentRef.current) attachmentRef.current.value = "";
    if (!response.ok) {
      setMessage(body.error || "附件上传失败");
      return;
    }
    window.location.reload();
  }
  async function deleteAttachment(id: string) {
    setBusy(true);
    const response = await fetch(`/api/attachments/${id}`, {
      method: "DELETE",
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error || "附件删除失败");
      return;
    }
    setPendingConfirm(null);
    setDetail((current) =>
      current
        ? {
            ...current,
            attachments: current.attachments.filter((item) => item.id !== id),
          }
        : current,
    );
  }
  async function confirmQuote() {
    if (!quoteId) return;
    if (!confirmation.order_number.trim()) {
      setMessage("请输入客户确认后的订单编号");
      return;
    }
    await action(`/api/quotes/${quoteId}/confirm`, confirmation);
  }
  async function deleteDraft() {
    if (!quoteId) return;
    setBusy(true);
    const response = await fetch(`/api/quotes/${quoteId}`, {
      method: "DELETE",
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error || "删除失败");
      return;
    }
    window.location.href = "/quotes";
  }
  async function revise() {
    if (!quoteId) return;
    setBusy(true);
    const response = await fetch(`/api/quotes/${quoteId}/revise`, {
      method: "POST",
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error || "创建新版本失败");
      return;
    }
    window.location.href = `/quotes/${body.data.id}`;
  }
  if (loading)
    return (
      <main className="grid min-h-[70vh] place-items-center">
        <LoaderCircle className="animate-spin text-blue-600" />
      </main>
    );
  const readonly = editing && !canEdit;
  return (
    <main className="p-4 lg:p-6">
      <div className="mx-auto max-w-[1660px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/quotes"
            className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-sm"
          >
            <ArrowLeft size={16} />
            返回报价列表
          </Link>
          <div className="flex flex-wrap gap-2">
            {editing && quoteId ? (
              <>
                <a
                  href={`/api/quotes/${quoteId}/export`}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm text-blue-700"
                >
                  <FileDown size={16} />
                  导出标准Excel
                </a>
                <Link
                  href={`/quotes/${quoteId}/print`}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm text-violet-700"
                >
                  <FileText size={16} />
                  打印/保存PDF
                </Link>
              </>
            ) : null}
            {detail?.sales_order ? (
              <Link
                href={`/orders/${detail.sales_order.id}`}
                className="inline-flex h-10 items-center rounded-lg border border-blue-300 px-4 text-sm text-blue-700"
              >
                查看订单 {detail.sales_order.order_number}
              </Link>
            ) : null}
            {detail?.stock_order ? (
              <Link
                href={`/stock-orders/${detail.stock_order.id}`}
                className="inline-flex h-10 items-center rounded-lg border border-emerald-300 px-4 text-sm text-emerald-700"
              >
                完善/查看备货单
              </Link>
            ) : null}
            {detail?.can_revise ? (
              <button
                disabled={busy}
                onClick={() => setPendingConfirm({ kind: "revise" })}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-violet-300 px-4 text-sm text-violet-700"
              >
                <Copy size={16} />
                创建新版本
              </button>
            ) : null}
            {detail?.can_confirm ? (
              <button
                disabled={busy}
                onClick={() => setConfirmOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm text-white"
              >
                <CheckCircle2 size={17} />
                记录客户确认
              </button>
            ) : null}
            {detail?.can_delete ? (
              <button
                disabled={busy}
                onClick={() => setPendingConfirm({ kind: "draft" })}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-300 px-4 text-sm text-rose-700"
              >
                <Minus size={17} />
                删除草稿
              </button>
            ) : detail?.can_cancel ? (
              <button
                disabled={busy}
                onClick={() => setCancelOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-300 px-4 text-sm text-rose-700"
              >
                <XCircle size={17} />
                取消报价
              </button>
            ) : null}
          </div>
        </div>
        <section className="rounded-xl border bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div>
              <h1 className="text-xl font-bold">
                {editing ? detail?.quote.quote_number : "创建报价单"}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                字段与客户PI模板、仓库备货模板保持一致；产品只录入一次。
              </p>
            </div>
            {editing ? (
              <span className="rounded bg-blue-50 px-3 py-1.5 text-sm text-blue-700">
                {QUOTE_STATUS_LABELS[detail?.quote.status || "DRAFT"]}
              </span>
            ) : null}
          </header>
          {message ? (
            <div
              className={`m-5 rounded-lg p-3 text-sm ${message.startsWith("已导入") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
            >
              {message}
            </div>
          ) : null}
          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
            <Field label="客户">
              <select
                disabled={editing || readonly}
                value={form.customer_id}
                onChange={(e) => selectCustomer(e.target.value)}
                className="h-10 w-full rounded-lg border px-3 text-sm"
              >
                <option value="">请选择本人客户</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="公司简称">
              <input
                disabled={readonly}
                value={form.customer_short_name}
                onChange={(e) =>
                  setForm({ ...form, customer_short_name: e.target.value })
                }
                className="h-10 w-full rounded-lg border px-3 text-sm"
              />
            </Field>
            <Field label="目的国家">
              <div ref={countryPickerRef} className="relative">
                <button type="button" disabled={readonly} aria-haspopup="listbox" aria-expanded={countryOpen} onClick={()=>{setCountryOpen(value=>!value);setCountryQuery("")}} className="flex h-10 w-full items-center justify-between rounded-lg border bg-white px-3 text-sm disabled:bg-slate-50">{form.destination_country?<CountryLabel value={form.destination_country}/>:<span className="text-slate-400">搜索选择国家/地区</span>}<ChevronDown size={16} className={`text-slate-400 transition ${countryOpen?"rotate-180":""}`}/></button>
                {countryOpen?<div className="absolute right-0 top-[44px] z-50 w-full min-w-[260px] overflow-hidden rounded-lg border bg-white shadow-xl"><div className="border-b p-2"><input autoFocus value={countryQuery} onChange={event=>setCountryQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Escape")setCountryOpen(false)}} placeholder="搜索中文名、英文名或代码" className="h-9 w-full rounded-md border px-3 text-sm outline-none focus:border-blue-500"/></div><div role="listbox" aria-label="目的国家" className="max-h-64 overflow-y-auto p-1">{filteredCountries.map(country=><button key={country.code} type="button" role="option" aria-selected={form.destination_country===country.name} onClick={()=>{setForm(current=>({...current,destination_country:country.name}));setCountryOpen(false);setCountryQuery("")}} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${form.destination_country===country.name?"bg-blue-50 font-medium text-blue-700":"hover:bg-slate-50"}`}><CountryLabel value={country.code}/><span className="text-slate-400">{country.code}</span></button>)}{!filteredCountries.length?<p className="px-3 py-8 text-center text-sm text-slate-400">未找到匹配国家/地区</p>:null}</div></div>:null}
              </div>
            </Field>
            <Field label="币种">
              <div ref={currencyPickerRef} className="relative">
                <button type="button" disabled={readonly} aria-haspopup="listbox" aria-expanded={currencyOpen} onClick={()=>{setCurrencyOpen(value=>!value);setCurrencyQuery("")}} className="flex h-10 w-full items-center justify-between rounded-lg border bg-white px-3 text-sm disabled:bg-slate-50">
                  <span>{form.currency} · {QUOTE_CURRENCIES.find(([code])=>code===form.currency)?.[1]||"请选择币种"}</span><ChevronDown size={16} className={`text-slate-400 transition ${currencyOpen?"rotate-180":""}`}/>
                </button>
                {currencyOpen?<div className="absolute right-0 top-[44px] z-50 w-full min-w-[240px] overflow-hidden rounded-lg border bg-white shadow-xl">
                  <div className="border-b p-2"><input autoFocus value={currencyQuery} onChange={event=>setCurrencyQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Escape")setCurrencyOpen(false)}} placeholder="搜索代码或中文名称" className="h-9 w-full rounded-md border px-3 text-sm outline-none focus:border-blue-500"/></div>
                  <div role="listbox" aria-label="币种" className="max-h-64 overflow-y-auto p-1">{filteredCurrencies.map(([code,label])=><button key={code} type="button" role="option" aria-selected={form.currency===code} onClick={()=>{setForm(current=>({...current,currency:code}));setCurrencyOpen(false);setCurrencyQuery("")}} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${form.currency===code?"bg-blue-50 font-medium text-blue-700":"hover:bg-slate-50"}`}><span>{code}</span><span className="text-slate-500">{label}</span></button>)}{!filteredCurrencies.length?<p className="px-3 py-8 text-center text-sm text-slate-400">未找到匹配币种</p>:null}</div>
                </div>:null}
              </div>
            </Field>
            <Field label="报价有效期">
              <input
                disabled={readonly}
                type="date"
                value={form.valid_until}
                onChange={(e) =>
                  setForm({ ...form, valid_until: e.target.value })
                }
                className="h-10 w-full rounded-lg border px-3 text-sm"
              />
            </Field>
            <Field label="预计交付日期">
              <input
                disabled={readonly}
                type="date"
                value={form.delivery_date}
                onChange={(e) =>
                  setForm({ ...form, delivery_date: e.target.value })
                }
                className="h-10 w-full rounded-lg border px-3 text-sm"
              />
            </Field>
            <Field label="付款方式">
              <div ref={paymentPickerRef} className="relative"><div className="relative"><input disabled={readonly} value={form.payment_method} onFocus={()=>setPaymentOpen(true)} onChange={event=>{setForm(current=>({...current,payment_method:event.target.value}));setPaymentOpen(true)}} onKeyDown={event=>{if(event.key==="Escape")setPaymentOpen(false)}} placeholder="选择常用方式或输入约定" className="h-10 w-full rounded-lg border px-3 pr-9 text-sm"/><button type="button" disabled={readonly} aria-label="展开付款方式" onClick={()=>setPaymentOpen(value=>!value)} className="absolute right-0 top-0 grid h-10 w-9 place-items-center text-slate-400"><ChevronDown size={16} className={`transition ${paymentOpen?"rotate-180":""}`}/></button></div>{paymentOpen?<div className="absolute right-0 top-[44px] z-50 w-full min-w-[300px] overflow-hidden rounded-lg border bg-white p-1 shadow-xl">{PAYMENT_METHOD_OPTIONS.filter(([value,label])=>!form.payment_method.trim()||`${value} ${label}`.toLocaleLowerCase().includes(form.payment_method.toLocaleLowerCase())).map(([value,label])=><button key={value} type="button" onClick={()=>{setForm(current=>({...current,payment_method:value}));setPaymentOpen(false)}} className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50"><span>{value}</span><span className="shrink-0 text-slate-400">{label}</span></button>)}<p className="px-3 py-2 text-xs text-slate-400">也可直接输入客户约定的付款条款</p></div>:null}</div>
            </Field>
            <Field label="运费">
              <ValidatedNumberInput disabled={readonly} value={form.shipping_cost}
                onValueChange={(value) => setForm((current) => ({ ...current, shipping_cost: value }))}
                className="h-10 w-full rounded-lg border px-3 text-sm" />
            </Field>
          </div>
          <div className="px-5 pb-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">客户报价产品明细</h2>
                <p className="mt-1 text-xs text-slate-500">
                  仅填写客户可见内容；销售员在备货单中补充中文说明和理货要求，实际采购价由采购人员核实后填写。
                </p>
              </div>
              {!readonly ? (
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/api/quotes/template"
                    prefetch={false}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm text-blue-700"
                  >
                    <FileDown size={16} />
                    下载导入模板
                  </Link>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => void importExcel(e.target.files?.[0])}
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm"
                  >
                    <FileSpreadsheet size={16} />
                    导入Excel
                  </button>
                  <button
                    onClick={() => void pasteRows()}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm"
                  >
                    <ClipboardPaste size={16} />
                    粘贴表格
                  </button>
                  <button
                    type="button"
                    onClick={addItem}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-50 px-3 text-sm text-blue-700"
                  >
                    <Plus size={16} />
                    添加产品
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingConfirm({ kind: "clear" })}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-rose-200 px-3 text-sm text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 size={16} />
                    清空明细
                  </button>
                </div>
              ) : null}
            </div>
            {!readonly?<section className="mb-4 rounded-xl border border-blue-100 bg-blue-50/40 p-4"><div className="flex flex-wrap items-end gap-3"><label className="min-w-[320px] flex-1"><span className="mb-1.5 block text-sm font-medium text-slate-700">从商品库添加</span><div className="relative"><Search size={17} className="absolute left-3 top-3 text-slate-400"/><input value={productQuery} onChange={event=>{setProductQuery(event.target.value);setProductOptions([])}} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();void searchProducts()}}} placeholder="搜索商品名称、系统SKU、供应商编号/货号、品牌或型号" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm"/></div></label><button type="button" disabled={productSearching} onClick={()=>void searchProducts()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50">{productSearching?<LoaderCircle size={16} className="animate-spin"/>:<Search size={16}/>}搜索商品</button></div>{productOptions.length?<div className="mt-3 grid gap-2 lg:grid-cols-2">{productOptions.map(product=><button key={product.id} type="button" onClick={()=>addProduct(product)} className="rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-blue-300 hover:bg-blue-50"><div className="flex items-start justify-between gap-3"><div><b className="text-blue-700">{product.sku} · {product.name_zh}</b><small className="mt-1 block text-slate-500">{[product.brand,product.model,product.quality,product.color].filter(Boolean).join(" / ")||"规格未维护"}</small><small className="mt-1 block text-slate-500">{summarizeProductSpecifications(product.specifications,product.category?.product_family||"OTHER")||"无已核实的品类专有规格"}</small></div><span className="shrink-0 text-sm font-semibold text-emerald-700">{product.suggested_price_usd>0?`建议 USD ${Number(product.suggested_price_usd).toFixed(2)}`:product.sale_reference_usd?`销售参考 USD ${Number(product.sale_reference_usd).toFixed(2)}`:"建议价待补齐成本"}</span></div><small className="mt-2 block text-slate-500">完整成本 {product.total_cost_cny===null?"采购、包装或其他成本未确认":`CNY ${Number(product.total_cost_cny).toFixed(2)}`} · MOQ {Number(product.minimum_order_quantity)} {product.unit}</small></button>)}</div>:null}</section>:null}
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[1050px] text-left text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    {[
                      "序号",
                      "产品 / SKU",
                      "品牌",
                      "型号",
                      "质量",
                      "描述（客户）",
                      "数量",
                      "销售单价",
                      "金额",
                      "快捷操作",
                    ].map((x) => (
                      <th key={x} className="px-2 py-3 font-medium">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!form.items.length ? <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">暂无产品明细，请点击上方“添加产品”或从商品库添加。</td></tr> : null}
                  {form.items.map((item, index) => (
                    <tr key={index} className="border-t">
                      <td className="px-2 py-2 text-center">{index + 1}</td>
                      {(
                        [
                          "item_name",
                          "brand",
                          "model",
                          "quality",
                          "description",
                        ] as const
                      ).map((key) => (
                        <td key={key} className="px-2 py-2">
                          <div><input
                            disabled={readonly}
                            value={String(item[key] || "")}
                            onChange={(e) =>
                              updateItem(index, key, e.target.value)
                            }
                            className="h-9 w-full min-w-24 rounded border px-2"
                          />{key==="item_name"&&item.product_sku_snapshot?<small className="mt-1 block text-blue-600">{item.product_sku_snapshot}{item.supplier_code_snapshot?` · 单品货号 ${item.supplier_code_snapshot}`:""}</small>:null}{key==="quality"&&item.product_color_snapshot?<small className="mt-1 block text-slate-500">颜色：{item.product_color_snapshot}</small>:null}</div>
                        </td>
                      ))}
                      {(["quantity", "unit_price"] as const).map((key) => (
                        <td key={key} className="px-2 py-2">
                          <ValidatedNumberInput disabled={readonly} value={item[key]}
                            integer={key === "quantity"} blankZero={key === "unit_price"}
                            onValueChange={(value) => updateItem(index, key, value)}
                            onBlur={key === "quantity" ? () => { void refreshItemPricing(index, item); } : undefined}
                            className="h-9 w-24 rounded border px-2 text-right" />
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-2 py-2 font-medium">
                        {(
                          Number(item.quantity || 0) *
                          Number(item.unit_price || 0)
                        ).toFixed(2)}
                        {item.suggested_unit_price!==null&&item.suggested_unit_price!==undefined?<small className="mt-1 block font-normal text-slate-500">建议单价 {Number(item.suggested_unit_price).toFixed(2)}</small>:null}
                      </td>
                      <td className="px-2 py-2">
                        {!readonly ? (
                          <div className="flex gap-1">
                            <button
                              title="在下方新增一行"
                              aria-label="新增产品行"
                              onClick={() => insertItem(index)}
                              className="rounded p-1.5 text-blue-600 hover:bg-blue-50"
                            >
                              <Plus size={16} />
                            </button>
                            <button
                              title="复制当前行"
                              aria-label="复制产品行"
                              onClick={() => duplicateItem(index)}
                              className="rounded p-1.5 text-violet-600 hover:bg-violet-50"
                            >
                              <Copy size={15} />
                            </button>
                            <button
                              title="删除当前行"
                              aria-label="删除产品行"
                              onClick={() => removeItem(index)}
                              className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
                            >
                              <Minus size={16} />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_360px]">
              <Field label="报价内部备注（不导出给客户）">
                <textarea
                  disabled={readonly}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border p-3 text-sm"
                />
              </Field>
              <aside className="rounded-xl bg-slate-50 p-5 text-sm">
                <div className="flex justify-between py-2">
                  <span>产品小计</span>
                  <b>
                    {form.currency} {totals.subtotal.toFixed(2)}
                  </b>
                </div>
                <div className="flex justify-between border-t py-2">
                  <span>运费</span>
                  <b>
                    {form.currency} {Number(form.shipping_cost || 0).toFixed(2)}
                  </b>
                </div>
                <div className="flex justify-between border-t py-3 text-lg">
                  <span>报价总额</span>
                  <b className="text-blue-700">
                    {form.currency} {totals.total.toFixed(2)}
                  </b>
                </div>
                <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
                  报价单仅保存客户可见的销售信息。客户确认后，系统创建订单快照和待完善备货单，采购成本不会出现在客户文件中。
                </div>
              </aside>
            </div>
            {editing ? (
              <section className="mt-4 rounded-xl border bg-slate-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">报价附件</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      支持报价依据、客户确认截图、PDF、Excel和Word，单个文件不超过15MB；报价发送后可补充证据，但既有附件不可删除。
                    </p>
                  </div>
                  {detail?.can_attach ? (
                    <>
                      <input
                        ref={attachmentRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,.pdf,.xlsx,.xls,.docx,.doc"
                        className="hidden"
                        onChange={(event) =>
                          void uploadAttachment(event.target.files?.[0])
                        }
                      />
                      <button
                        disabled={busy}
                        onClick={() => attachmentRef.current?.click()}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-sm text-blue-700"
                      >
                        <Paperclip size={16} />
                        上传附件
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detail?.attachments?.map((item) => (
                    <div
                      key={item.id}
                      className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm"
                    >
                      <Paperclip size={14} className="shrink-0 text-blue-600" />
                      <span className="max-w-64 truncate text-blue-700" title={item.filename}>{item.filename}</span>
                      <small className="text-slate-400">
                        {item.size_bytes
                          ? `${(item.size_bytes / 1024).toFixed(0)}KB`
                          : ""}
                      </small>
                      <AttachmentPreview attachment={item} />
                      {detail.can_edit ? (
                        <button
                          onClick={() =>
                            setPendingConfirm({
                              kind: "attachment",
                              id: item.id,
                            })
                          }
                          aria-label={`删除附件 ${item.filename}`}
                          className="text-rose-500"
                        >
                          <XCircle size={15} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {!detail?.attachments?.length ? (
                    <p className="text-sm text-slate-400">暂无附件</p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
          {!readonly ? (
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
              <p className="text-xs leading-5 text-slate-500">
                记录已发送：仅登记状态，系统不会自动发送。
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  disabled={busy}
                  onClick={() => void save("DRAFT")}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm"
                >
                  <Save size={16} />
                  保存草稿
                </button>
                <button
                  disabled={busy}
                  onClick={() => void save("GENERATED")}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm text-white"
                >
                  <FileDown size={16} />
                  保存并生成报价
                </button>
                <button
                  disabled={busy}
                  onClick={() => setPendingConfirm({ kind: "sent" })}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm text-white"
                >
                  <Send size={16} />
                  记录已发送
                </button>
              </div>
            </footer>
          ) : (
            <footer className="border-t bg-slate-50 p-4 text-sm text-slate-500">
              当前为只读查看，不能修改其他销售员的报价。
            </footer>
          )}
        </section>
        <AppDialog
          open={confirmOpen}
          title="记录客户确认并创建订单"
          description="订单号由销售员填写，系统校验唯一性并同时生成待完善备货单。"
          onClose={() => setConfirmOpen(false)}
          width="max-w-lg"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void confirmQuote();
            }}
          >
            <div className="space-y-4">
                <Field label="订单编号（必填）">
                  <input
                    autoFocus
                    required
                    value={confirmation.order_number}
                    onChange={(e) =>
                      setConfirmation({
                        ...confirmation,
                        order_number: e.target.value,
                      })
                    }
                    placeholder="例如 DT20260901-001"
                    className="h-10 w-full rounded-lg border px-3 text-sm"
                  />
                </Field>
                <Field label="客户确认渠道">
                  <select
                    value={confirmation.method}
                    onChange={(e) =>
                      setConfirmation({
                        ...confirmation,
                        method: e.target.value,
                      })
                    }
                    className="h-10 w-full rounded-lg border px-3 text-sm"
                  >
                    <option value="WhatsApp">whatsapp</option>
                    <option>邮件</option>
                    <option>电话</option>
                    <option>面谈</option>
                    <option>其他</option>
                  </select>
                </Field>
                <Field label="确认说明">
                  <textarea
                    value={confirmation.note}
                    onChange={(e) =>
                      setConfirmation({ ...confirmation, note: e.target.value })
                    }
                    rows={3}
                    placeholder="可记录客户确认内容或附件说明"
                    className="w-full rounded-lg border p-3 text-sm"
                  />
                </Field>
            </div>
            <DialogActions
              busy={busy}
              onCancel={() => setConfirmOpen(false)}
              confirmLabel="确认并创建订单"
            />
          </form>
        </AppDialog>
        <AppDialog
          open={cancelOpen}
          title="取消报价"
          description="取消原因会写入报价历史和操作日志。"
          onClose={() => setCancelOpen(false)}
          width="max-w-md"
        >
          <label className="text-sm font-medium text-slate-700">
            真实取消原因
            <textarea
              autoFocus
              required
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm"
              placeholder="请说明客户拒绝、报价失效或其他真实原因"
            />
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (cancelReason.trim()) {
                void action(`/api/quotes/${quoteId}/cancel`, {
                  reason: cancelReason.trim(),
                });
                setCancelOpen(false);
              }
            }}
          >
            <DialogActions
              busy={busy}
              onCancel={() => setCancelOpen(false)}
              confirmLabel="确认取消"
              tone="danger"
            />
          </form>
        </AppDialog>
        <ConfirmDialog
          open={Boolean(pendingConfirm)}
          title={
            pendingConfirm?.kind === "attachment"
              ? "删除报价附件？"
              : pendingConfirm?.kind === "draft"
                ? "删除报价草稿？"
                : pendingConfirm?.kind === "revise"
                  ? "创建新版本？"
                  : pendingConfirm?.kind === "clear"
                    ? "清空全部产品明细？"
                    : "确认已实际发送给客户？"
          }
          description={
            pendingConfirm?.kind === "attachment"
              ? "附件删除后不可恢复。"
              : pendingConfirm?.kind === "draft"
                ? "仅草稿可删除，操作不可恢复。客户和费用记录不受影响。"
                : pendingConfirm?.kind === "revise"
                  ? "系统会复制当前报价为新草稿，原报价保留并标记为已被新版本替代。"
                  : pendingConfirm?.kind === "clear"
                    ? "当前页面中的全部产品明细将被清空，并保留一条空白行；只有再次保存后才会覆盖已保存内容。"
                    : "请仅在您已通过 WhatsApp、邮件或其他外部渠道把报价发给客户后确认。系统不会代您发送文件。"
          }
          confirmLabel={
            pendingConfirm?.kind === "revise"
              ? "创建新版本"
              : pendingConfirm?.kind === "clear"
                ? "确认清空"
                : pendingConfirm?.kind === "sent"
                  ? "确认并记录"
                  : "确认删除"
          }
          danger={
            pendingConfirm?.kind === "attachment" ||
            pendingConfirm?.kind === "draft" ||
            pendingConfirm?.kind === "clear"
          }
          busy={busy}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            if (pendingConfirm?.kind === "attachment" && pendingConfirm.id)
              void deleteAttachment(pendingConfirm.id);
            else if (pendingConfirm?.kind === "draft") void deleteDraft();
            else if (pendingConfirm?.kind === "revise") void revise();
            else if (pendingConfirm?.kind === "clear") clearItems();
            else if (pendingConfirm?.kind === "sent") {
              setPendingConfirm(null);
              void save("SENT");
            }
          }}
        />
      </div>
    </main>
  );
}
