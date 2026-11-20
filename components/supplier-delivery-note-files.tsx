"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Download, FileImage, LoaderCircle, Plus, X } from "lucide-react";

export type SupplierDeliveryNoteFile = { id: string; filename: string; mime_type: string | null; size_bytes: number | null; created_at?: string };
export type SupplierDeliveryNoteView = {
  id: string;
  supplier_id?: string;
  supplier_code: string;
  note_number: string;
  number_pending?: boolean;
  updated_at?: string;
  document_date: string;
  attachments: SupplierDeliveryNoteFile[];
  superseded_attachments?: SupplierDeliveryNoteFile[];
};

export function SupplierDeliveryNoteFiles({ note, relatedNotes = [], canUpload = false, onUploaded, compact = false }: {
  note: SupplierDeliveryNoteView;
  relatedNotes?: SupplierDeliveryNoteView[];
  canUpload?: boolean;
  onUploaded?: () => void;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<SupplierDeliveryNoteFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [numberDraft, setNumberDraft] = useState("");
  const [reuseCandidate, setReuseCandidate] = useState<{ note_number: string; document_date: string; allocation_count: number; attachment_count: number } | null>(null);
  const [numberCorrection, setNumberCorrection] = useState<{ number: string; reason: string } | null>(null);
  const [photoReplacement, setPhotoReplacement] = useState<{ id: string; reason: string } | null>(null);
  const replacementInput = useRef<HTMLInputElement>(null);
  const reusableNotes = note.number_pending ? relatedNotes.filter((candidate) =>
    candidate.id !== note.id && !candidate.number_pending && candidate.supplier_id === note.supplier_id
    && candidate.document_date === note.document_date) : [];

  async function correctNumber() {
    if (!numberCorrection || !note.updated_at || busy) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/supplier-delivery-notes/${note.id}/number`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note_number: numberCorrection.number, reason: numberCorrection.reason,
        expected_updated_at: note.updated_at }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(result.error || "更正失败，请刷新后重试"); return; }
    setNumberCorrection(null); onUploaded?.();
  }

  async function replacePhoto(file: File | undefined) {
    if (!file || !photoReplacement || !note.updated_at || busy) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)
      || file.size <= 0 || file.size > 5 * 1024 * 1024
      || photoReplacement.reason.trim().length < 2) {
      setError("请选择不超过5MB的JPG、PNG或WebP照片，并填写更换原因"); return;
    }
    setBusy(true); setError("");
    const body = new FormData();
    body.append("files", file);
    body.append("replace_attachment_id", photoReplacement.id);
    body.append("replace_reason", photoReplacement.reason.trim());
    body.append("expected_updated_at", note.updated_at);
    const response = await fetch(`/api/supplier-delivery-notes/${note.id}/attachments`, {
      method: "POST", body,
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(result.error || "更换失败，请刷新后重试"); return; }
    setPhotoReplacement(null);
    if (replacementInput.current) replacementInput.current.value = "";
    onUploaded?.();
  }

  async function completeNumber(confirmReuse = false) {
    const value = numberDraft.trim();
    if (!value || busy || !note.number_pending || !note.updated_at) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/supplier-delivery-notes/${note.id}/number`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note_number: value, expected_updated_at: note.updated_at, confirm_reuse: confirmReuse }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setReuseCandidate(null); setError(result.error || "补录失败，请刷新后重试"); return; }
    if (result.data?.status === "confirm_reuse") {
      setReuseCandidate(result.data); return;
    }
    setReuseCandidate(null); setNumberDraft(""); onUploaded?.();
  }

  async function upload(files: FileList | null) {
    if (!files?.length || busy) return;
    const selected = [...files];
    if (note.attachments.length + selected.length > 10) {
      setError("每张送货单最多保存10张照片");
      return;
    }
    const validTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    const invalid = selected.find((file) => !validTypes.has(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024);
    if (invalid) {
      setError(`“${invalid.name}”格式不支持或超过5MB；请选择JPG、PNG或WebP图片`);
      return;
    }
    setBusy(true); setError("");
    const body = new FormData();
    selected.forEach((file) => body.append("files", file));
    const response = await fetch(`/api/supplier-delivery-notes/${note.id}/attachments`, { method: "POST", body }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) { setError(result.error || "上传失败，请稍后重试"); return; }
    if (input.current) input.current.value = "";
    onUploaded?.();
  }

  return <div className={`min-w-0 ${compact ? "" : "rounded-lg border bg-white p-3"}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      {!compact ? <div className="min-w-0"><b className="break-all">{note.supplier_code} · {note.note_number}</b><span className="ml-2 text-xs text-slate-500">{note.document_date}</span>{canUpload && !note.number_pending ? <button type="button" onClick={() => { setNumberCorrection({ number: note.note_number, reason: "" }); setError(""); }} className="ml-2 text-xs text-blue-700 hover:underline">更正单号</button> : null}</div> : null}
      {canUpload ? <>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="选择送货单照片" onChange={(event) => void upload(event.target.files)}/>
        <button type="button" disabled={busy || note.attachments.length >= 10} onClick={() => input.current?.click()} className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-xs font-medium text-blue-800 disabled:opacity-50">
          {busy ? <LoaderCircle size={14} className="animate-spin"/> : <Plus size={14}/>} {note.attachments.length ? "补充送货单照片" : "上传送货单照片"}
        </button>
      </> : null}
    </div>
    {numberCorrection ? <div className="mt-2 rounded border border-blue-200 bg-blue-50 p-2 text-xs"><p>更正后，此纸单关联的全部产品及对账记录将显示新号码；已付款金额不变。</p><div className="mt-2 flex flex-wrap gap-2"><input aria-label="更正后的送货单号" maxLength={100} value={numberCorrection.number} onChange={(event) => setNumberCorrection({ ...numberCorrection, number: event.target.value })} className="h-8 min-w-40 flex-1 rounded border px-2"/><input aria-label="送货单号更正原因" maxLength={500} placeholder="更正原因（必填）" value={numberCorrection.reason} onChange={(event) => setNumberCorrection({ ...numberCorrection, reason: event.target.value })} className="h-8 min-w-40 flex-1 rounded border px-2"/><button type="button" disabled={busy || !numberCorrection.number.trim() || numberCorrection.reason.trim().length < 2} onClick={() => void correctNumber()} className="rounded bg-blue-700 px-2 text-white disabled:opacity-40">确认更正</button><button type="button" onClick={() => setNumberCorrection(null)} className="rounded border px-2">取消</button></div></div> : null}
    {note.number_pending && canUpload ? <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
      <p>回货已登记，送货单号待补；补录前不可核对送货单金额或登记付款。</p>
      <div className="mt-2 flex flex-wrap gap-2"><input aria-label="补录送货单号" maxLength={100} value={numberDraft} onChange={(event) => { setNumberDraft(event.target.value); setReuseCandidate(null); }} className="h-8 min-w-40 flex-1 rounded border border-amber-300 bg-white px-2" placeholder="输入真实送货单号"/><button type="button" disabled={busy || !numberDraft.trim()} onClick={() => void completeNumber()} className="rounded bg-amber-800 px-3 text-white disabled:opacity-40">补录单号</button></div>
      {reusableNotes.length ? <div className="mt-2 flex flex-wrap items-center gap-1.5 text-amber-950"><span>若与已有纸单相同，可选单号核对后共用：</span>{reusableNotes.map((candidate) => <button key={candidate.id} type="button" disabled={busy} onClick={() => { setNumberDraft(candidate.note_number); setReuseCandidate(null); }} className="rounded border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-100 disabled:opacity-40">{candidate.note_number}</button>)}<span className="text-amber-800">同日同供应商不代表同一张纸单，请核对实物。</span></div> : null}
      {reuseCandidate ? <div className="mt-2 rounded border border-amber-300 bg-white p-2"><p>同供应商已有送货单 {reuseCandidate.note_number}（{reuseCandidate.document_date}）。确认这批产品确实使用同一张纸单后，可将 {reuseCandidate.allocation_count} 条回货关联及 {reuseCandidate.attachment_count} 张照片归到该单；列表将只显示一张纸单。</p><div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => void completeNumber(true)} className="rounded bg-amber-800 px-2 py-1 text-white disabled:opacity-40">确认共用该纸单</button><button type="button" onClick={() => setReuseCandidate(null)} className="rounded border px-2 py-1">取消</button></div></div> : null}
    </div> : null}
    {note.attachments.length ? <div className={`${compact ? "" : "mt-2"} flex min-w-0 flex-wrap gap-2`}>{note.attachments.map((file) => <div key={file.id} className="inline-flex min-w-0 max-w-full items-center rounded-md border bg-slate-50 text-xs"><button type="button" onClick={() => setPreview(file)} className="inline-flex min-w-0 items-center gap-2 px-2 py-1.5 hover:text-blue-700"><FileImage size={15} className="shrink-0 text-blue-600"/><span className="min-w-0 max-w-52 truncate" title={file.filename}>{file.filename}</span><span className="shrink-0 text-slate-400">预览</span></button>{canUpload ? <button type="button" onClick={() => { setPhotoReplacement({ id: file.id, reason: "" }); setError(""); }} className="border-l px-2 py-1.5 text-blue-700 hover:underline">更换</button> : null}</div>)}</div> : <p className="mt-2 text-xs text-amber-700">尚未上传送货单照片</p>}
    {photoReplacement ? <div className="mt-2 rounded border border-blue-200 bg-blue-50 p-2 text-xs"><p>替代照片上传后，原图保留在更正历史；原纸单金额需重新核对，已登记付款不变。</p><div className="mt-2 flex flex-wrap gap-2"><input aria-label="照片更换原因" maxLength={500} placeholder="更换原因（必填）" value={photoReplacement.reason} onChange={(event) => setPhotoReplacement({ ...photoReplacement, reason: event.target.value })} className="h-8 min-w-48 flex-1 rounded border px-2"/><input ref={replacementInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择替代照片" onChange={(event) => void replacePhoto(event.target.files?.[0])} disabled={busy || photoReplacement.reason.trim().length < 2} className="max-w-56 text-xs"/><button type="button" onClick={() => setPhotoReplacement(null)} className="rounded border px-2">取消</button></div></div> : null}
    {note.superseded_attachments?.length ? <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">查看旧照片（{note.superseded_attachments.length} 张，留档）</summary><div className="mt-1 flex flex-wrap gap-2">{note.superseded_attachments.map((file) => <button key={file.id} type="button" onClick={() => setPreview(file)} className="rounded border px-2 py-1 hover:text-blue-700">{file.filename} · 预览</button>)}</div></details> : null}
    {error ? <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p> : null}
    {preview ? <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
      <section role="dialog" aria-modal="true" aria-label={`送货单照片：${preview.filename}`} className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b p-3"><div className="min-w-0"><b className="block truncate">{preview.filename}</b><small className="text-slate-500">{note.supplier_code} · {note.note_number}</small></div><div className="flex gap-2"><a href={`/api/attachments/${preview.id}`} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm"><Download size={15}/>下载</a><button type="button" aria-label="关闭预览" onClick={() => setPreview(null)} className="grid size-9 place-items-center rounded-lg hover:bg-slate-100"><X size={18}/></button></div></header>
        <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-slate-100 p-3"><Image unoptimized width={1600} height={1200} src={`/api/attachments/${preview.id}?preview=1`} alt={`送货单 ${note.note_number}`} className="max-h-full max-w-full object-contain"/></div>
      </section>
    </div> : null}
  </div>;
}
