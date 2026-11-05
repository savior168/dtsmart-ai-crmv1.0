type Item = { id: string; line_number: number; item_name: string; brand: string | null; model: string | null; quality: string | null };
type Attachment = { sales_order_item_id: string | null; pi_line_number_snapshot: number | null; pi_product_label_snapshot: string | null };

export function piRequirementProductLabel(item: Pick<Item, "item_name" | "brand" | "model" | "quality">) {
  return [item.item_name, item.brand, item.model, item.quality]
    .map((value) => String(value || "").trim()).join(" · ");
}

export function resolvePiRequirementAttachments<T extends Attachment>(attachments: T[], items: Item[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const byLine = new Map(items.map((item) => [item.line_number, item]));
  return attachments.map((attachment) => {
    if (attachment.pi_line_number_snapshot === null) return {
      ...attachment, display_line_number: null, archived: false,
    };
    const current = attachment.sales_order_item_id
      ? byId.get(attachment.sales_order_item_id)
      : byLine.get(attachment.pi_line_number_snapshot);
    const matches = current && attachment.pi_product_label_snapshot
      && piRequirementProductLabel(current) === attachment.pi_product_label_snapshot;
    return { ...attachment, display_line_number: matches ? current.line_number : null,
      archived: !matches };
  });
}
