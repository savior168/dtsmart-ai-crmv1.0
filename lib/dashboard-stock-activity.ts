export function dashboardStockActivityText(input: {
  orderNumber: string;
  customerName: string;
  actorName: string;
  actionDetail: string;
  statusLabel: string;
  orderedUnits: number;
  receivedUnits: number;
  preparedUnits: number;
  shippedUnits: number;
}) {
  const action = input.actionDetail || "更新备货信息";
  const statusLabel = input.statusLabel || "待更新";
  const status = action.includes(statusLabel) ? "" : ` · ${statusLabel}`;
  return `${input.actorName || "操作人未记录"} · ${action} · PI ${input.orderNumber || "订单号未记录"} · ${input.customerName || "未命名客户"}${status}`;
}
