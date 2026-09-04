"use client";

import { Download, Eye, FileText } from "lucide-react";
import { useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";

type Attachment = { id: string; filename: string; mime_type?: string | null };

function previewKind(mimeType?: string | null) {
  if ((mimeType || "").startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return "file";
}

/** The source route independently authorizes every request; this component only
 * presents a compact preview/download affordance to viewers already given data. */
export function AttachmentPreview({ attachment, label = "预览" }: { attachment: Attachment; label?: string }) {
  const [open, setOpen] = useState(false);
  const kind = previewKind(attachment.mime_type);
  const url = `/api/attachments/${attachment.id}`;
  return <>
    <div className="inline-flex max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs shadow-sm">
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-blue-700 hover:bg-blue-50" title={`预览附件：${attachment.filename}`}><Eye size={14}/>{label}</button>
      <a href={url} className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-blue-700" title={`下载附件：${attachment.filename}`} aria-label={`下载附件：${attachment.filename}`}><Download size={14}/></a>
    </div>
    {open ? <AppDialog title={attachment.filename} description="附件预览仅向具备该业务数据查看权限的用户开放。" onClose={() => setOpen(false)} width={kind === "pdf" ? "max-w-5xl" : "max-w-3xl"}>
      {kind === "image" ? <img src={`${url}?preview=1`} alt={attachment.filename} className="mx-auto max-h-[68vh] w-auto max-w-full rounded-lg object-contain" /> : null}
      {kind === "pdf" ? <iframe src={`${url}?preview=1`} title={attachment.filename} className="h-[68vh] w-full rounded-lg border border-slate-200" /> : null}
      {kind === "file" ? <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center"><div><FileText className="mx-auto text-blue-600" size={30}/><p className="mt-3 text-sm font-medium text-slate-700">此文件类型请下载后查看</p><p className="mt-1 text-xs text-slate-500">支持安全下载，不在浏览器内执行 Office 文件。</p><a href={url} className="mx-auto mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white"><Download size={15}/>下载附件</a></div></div> : null}
    </AppDialog> : null}
  </>;
}
