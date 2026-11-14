type FailedScreeningItem = {
  status: string;
  analysis_status: string;
  result_id: string | null;
  attempt_count: number;
  error_code: string | null;
  error_context: unknown;
};

export function canAutoRetryAcquisitionItem(item: FailedScreeningItem) {
  if (item.status !== "FAILED" || item.analysis_status !== "FAILED" || item.result_id) return false;
  if (!Number.isInteger(item.attempt_count) || item.attempt_count < 1 || item.attempt_count >= 3) return false;
  const context = item.error_context && typeof item.error_context === "object"
    ? item.error_context as { retryable?: unknown } : null;
  // Existing 22P05 failures can resume after NUL sanitization was fixed.
  return item.error_code === "22P05" || context?.retryable === true;
}
