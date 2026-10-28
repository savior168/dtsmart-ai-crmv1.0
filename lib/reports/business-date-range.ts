/** Dates selected in the UI are calendar days in the DTS business timezone. */
export function businessRange(from: string, to: string) {
  const exclusiveEnd = new Date(`${to}T00:00:00+08:00`);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
  return { from: new Date(`${from}T00:00:00+08:00`).toISOString(), to: exclusiveEnd.toISOString() };
}
