"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Download, FileImage, LoaderCircle, Plus, X } from "lucide-react";

export type SupplierDeliveryNoteFile = { id: string; filename: string; mime_type: string | null; size_bytes: number | null; created_at?: string };
export type SupplierDeliveryNoteView = {
  id: string;
  supplier_code: string;
  note_number: string;
  document_date: string;
  attachments: SupplierDeliveryNoteFile[];
};

export function SupplierDeliveryNoteFiles({ note, canUpload = false, onUploaded, compact = false }: {
  note: SupplierDeliveryNoteView;
  canUpload?: boolean;
  onUploaded?: () => void;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<SupplierDeliveryNoteFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      <div className="min-w-0"><b className="break-all">{note.supplier_code} · {note.note_number}</b><span className="ml-2 text-xs text-slate-500">{note.document_date}</span></div>
      {canUpload ? <>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="选择送货单照片" onChange={(event) => void upload(event.target.files)}/>
        <button type="button" disabled={busy || note.attachments.length >= 10} onClick={() => input.current?.click()} className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-xs font-medium text-blue-800 disabled:opacity-50">
          {busy ? <LoaderCircle size={14} className="animate-spin"/> : <Plus size={14}/>} {note.attachments.length ? "补充照片" : "上传纸单照片"}
        </button>
      </> : null}
    </div>
    {note.attachments.length ? <div className="mt-2 flex flex-wrap gap-2">{note.attachments.map((file) => <button key={file.id} type="button" onClick={() => setPreview(file)} className="group flex items-center gap-2 rounded-md border bg-slate-50 px-2 py-1.5 text-left text-xs hover:border-blue-300 hover:bg-blue-50">
      <FileImage size={15} className="shrink-0 text-blue-600"/><span className="max-w-52 truncate" title={file.filename}>{file.filename}</span><span className="text-slate-400">预览</span>
    </button>)}</div> : <p className="mt-2 text-xs text-amber-700">尚未上传纸质送货单照片</p>}
    {error ? <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p> : null}
    {preview ? <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
      <section role="dialog" aria-modal="true" aria-label={`送货单照片：${preview.filename}`} className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b p-3"><div className="min-w-0"><b className="block truncate">{preview.filename}</b><small className="text-slate-500">{note.supplier_code} · {note.note_number}</small></div><div className="flex gap-2"><a href={`/api/attachments/${preview.id}`} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm"><Download size={15}/>下载</a><button type="button" aria-label="关闭预览" onClick={() => setPreview(null)} className="grid size-9 place-items-center rounded-lg hover:bg-slate-100"><X size={18}/></button></div></header>
        <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-slate-100 p-3"><Image unoptimized width={1600} height={1200} src={`/api/attachments/${preview.id}?preview=1`} alt={`送货单 ${note.note_number}`} className="max-h-full max-w-full object-contain"/></div>
      </section>
    </div> : null}
  </div>;
}
