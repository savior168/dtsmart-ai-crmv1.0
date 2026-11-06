"use client";

import { Paperclip, ZoomIn } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";

export type PiRequirementAttachment = {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  pi_line_number_snapshot: number | null;
  pi_product_label_snapshot: string | null;
  sales_order_item_id: string | null;
  display_line_number: number | null;
  archived: boolean;
};

function RequirementAttachmentImage({ item, archived = false }: { item: PiRequirementAttachment; archived?: boolean }) {
  const [open, setOpen] = useState(false);
  const src = `/api/attachments/${item.id}?preview=1`;
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label={`放大预览理货图片：${item.filename}`}
      title={`${item.filename} · 点击放大预览`}
      className={`group inline-flex flex-col overflow-hidden rounded-md border bg-white text-left text-xs text-blue-700 shadow-sm transition hover:shadow print:pointer-events-none ${archived ? "border-amber-300" : "border-blue-200 hover:border-blue-400"}`}>
      <span className={`${archived ? "h-20 w-[120px]" : "h-16 w-24"} grid place-items-center bg-slate-50`}>
        <Image src={src} alt={item.filename} width={archived ? 120 : 96} height={archived ? 80 : 64} unoptimized loading="eager"
          className="h-full w-full object-contain" />
      </span>
      <span className={`flex min-h-6 items-center gap-1 px-1.5 py-1 ${archived ? "max-w-[120px]" : "w-24"}`}>
        <Paperclip size={12} className="shrink-0"/><span className="truncate" title={item.filename}>{item.filename}</span>
        <ZoomIn size={12} className="ml-auto shrink-0 text-slate-400 group-hover:text-blue-600"/>
      </span>
    </button>
    <AppDialog open={open} title={item.filename} description={archived ? "历史产品项的理货图片" : "理货要求图片预览"}
      onClose={() => setOpen(false)} width="max-w-5xl">
      <div className="grid min-h-48 place-items-center rounded-lg bg-slate-50 p-2 sm:p-4">
        <Image src={src} alt={item.filename} width={1600} height={1200} unoptimized loading="eager"
          className="h-auto max-h-[76vh] w-auto max-w-full object-contain" />
      </div>
    </AppDialog>
  </>;
}

export function PiRequirementAttachments({ attachments, lineNumber, className = "" }: {
  attachments: PiRequirementAttachment[];
  lineNumber: number | null;
  className?: string;
}) {
  const matching = attachments.filter((item) => !item.archived && item.display_line_number === lineNumber);
  if (!matching.length) return null;
  return <div className={`flex flex-wrap gap-2 ${className}`} aria-label={lineNumber === null ? "整单理货附件" : `第 ${lineNumber} 项理货附件`}>
    {matching.map((item) => <RequirementAttachmentImage key={item.id} item={item}/>)}
  </div>;
}

export function ArchivedPiRequirementAttachments({ attachments }: { attachments: PiRequirementAttachment[] }) {
  const archived = attachments.filter((item) => item.archived);
  if (!archived.length) return null;
  return <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
    <b>历史产品理货图片（原产品项已变更或删除）</b>
    <div className="mt-2 flex flex-wrap gap-2">{archived.map((item) => <div key={item.id} className="max-w-36">
      <p className="mb-1">原第 {item.pi_line_number_snapshot} 项 · {item.pi_product_label_snapshot || "产品信息未记录"}</p><RequirementAttachmentImage item={item} archived/>
    </div>)}</div>
  </div>;
}
