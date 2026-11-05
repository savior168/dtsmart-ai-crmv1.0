export function dashboardStockActivityText(input: {
  piNumber: string;
  customerName: string;
  statusLabel: string;
  orderedUnits: number;
  receivedUnits: number;
  preparedUnits: number;
  shippedUnits: number;
}) {
  const ordered = Math.max(0, Number(input.orderedUnits) || 0);
  const received = Math.max(0, Number(input.receivedUnits) || 0);
  const prepared = Math.max(0, Number(input.preparedUnits) || 0);
  const shipped = Math.max(0, Number(input.shippedUnits) || 0);
  const identity = `PI ${input.piNumber || "未编号"} · ${input.customerName || "未命名客户"}`;
  const counts = ordered > 0
    ? `，回货 ${received}/${ordered}、理货 ${prepared}/${ordered}、交货代 ${shipped}/${ordered} 件`
    : "";
  return `${identity}：备货最新状态为${input.statusLabel || "待更新"}${counts}`;
}
