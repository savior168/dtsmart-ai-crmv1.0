import { Paperclip } from "lucide-react";

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
  return <div className={`flex flex-wrap gap-1.5 ${className}`} aria-label={lineNumber === null ? "整单理货附件" : `第 ${lineNumber} 项理货附件`}>
    {matching.map((item) => <a key={item.id} href={`/api/attachments/${item.id}?preview=1`}
      target="_blank" rel="noopener noreferrer" title={`${item.filename} · ${new Date(item.created_at).toLocaleString("zh-CN")}`}
      className="inline-flex max-w-56 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100">
      <Paperclip size={13} className="shrink-0"/><span className="truncate">{item.filename}</span>
    </a>)}
  </div>;
}

export function ArchivedPiRequirementAttachments({ attachments }: { attachments: PiRequirementAttachment[] }) {
  const archived = attachments.filter((item) => item.archived);
  if (!archived.length) return null;
  return <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
    <b>历史产品理货图片（原产品项已变更或删除）</b>
    <div className="mt-2 space-y-1">{archived.map((item) => <p key={item.id}>
      原第 {item.pi_line_number_snapshot} 项 · {item.pi_product_label_snapshot || "产品信息未记录"} · <a
        href={`/api/attachments/${item.id}?preview=1`} target="_blank" rel="noopener noreferrer"
        className="font-medium text-blue-700 underline">{item.filename}</a>
    </p>)}</div>
  </div>;
}
