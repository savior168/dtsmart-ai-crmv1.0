import { Paperclip } from "lucide-react";
import Image from "next/image";

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

export function PiRequirementAttachments({ attachments, lineNumber, className = "" }: {
  attachments: PiRequirementAttachment[];
  lineNumber: number | null;
  className?: string;
}) {
  const matching = attachments.filter((item) => !item.archived && item.display_line_number === lineNumber);
  if (!matching.length) return null;
  return <div className={`flex flex-wrap gap-2 ${className}`} aria-label={lineNumber === null ? "整单理货附件" : `第 ${lineNumber} 项理货附件`}>
    {matching.map((item) => <a key={item.id} href={`/api/attachments/${item.id}?preview=1`}
      target="_blank" rel="noopener noreferrer" title={`${item.filename} · 点击查看原图`}
      className="group inline-flex w-24 flex-col overflow-hidden rounded-md border border-blue-200 bg-white text-xs text-blue-700 shadow-sm hover:border-blue-400 hover:shadow print:break-inside-avoid">
      <Image src={`/api/attachments/${item.id}?preview=1`} alt={item.filename} width={96} height={64} unoptimized loading="eager"
        className="h-16 w-full bg-slate-50 object-contain" />
      <span className="flex min-h-6 items-center gap-1 px-1.5 py-1"><Paperclip size={12} className="shrink-0"/><span className="truncate" title={item.filename}>{item.filename}</span></span>
    </a>)}
  </div>;
}

export function ArchivedPiRequirementAttachments({ attachments }: { attachments: PiRequirementAttachment[] }) {
  const archived = attachments.filter((item) => item.archived);
  if (!archived.length) return null;
  return <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
    <b>历史产品理货图片（原产品项已变更或删除）</b>
    <div className="mt-2 flex flex-wrap gap-2">{archived.map((item) => <div key={item.id} className="max-w-36">
      <p className="mb-1">原第 {item.pi_line_number_snapshot} 项 · {item.pi_product_label_snapshot || "产品信息未记录"}</p><a
        href={`/api/attachments/${item.id}?preview=1`} target="_blank" rel="noopener noreferrer"
        className="inline-flex flex-col overflow-hidden rounded-md border border-amber-300 bg-white font-medium text-blue-700 underline print:break-inside-avoid"><Image src={`/api/attachments/${item.id}?preview=1`} alt={item.filename} width={120} height={80} unoptimized loading="eager" className="h-20 w-[120px] bg-white object-contain"/><span className="max-w-[120px] truncate px-1.5 py-1">{item.filename}</span></a>
    </div>)}</div>
  </div>;
}
