export function remainingAcquisitionTaskLimit(limitUsd: number | null, legacySpendUsd: number) {
  if (limitUsd === null) return null;
  if (!Number.isFinite(limitUsd) || !Number.isFinite(legacySpendUsd) || limitUsd < 0 || legacySpendUsd < 0) {
    throw new Error("INVALID_ACQUISITION_TASK_COST_LIMIT");
  }
  // Numeric task limits use six decimal places; round down so floating-point
  // representation cannot permit a charge beyond the configured ceiling.
  return Math.max(0, Math.floor((limitUsd - legacySpendUsd) * 1_000_000) / 1_000_000);
}
