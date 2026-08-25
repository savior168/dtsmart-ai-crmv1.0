export type NormalizedAiError = {
  error_code: string;
  error_message: string;
  details: string | null;
  hint: string | null;
  stage: string;
  channel: string | null;
  provider: string | null;
  http_status: number | null;
  request_id: string | null;
  retryable: boolean;
  attempt_number: number;
  duration_ms: number | null;
};

type ErrorContext = {
  stage: string;
  channel?: string | null;
  provider?: string | null;
  attemptNumber?: number;
  durationMs?: number | null;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function textValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function compactJson(value: unknown) {
  if (!value || typeof value !== "object") return "";
  try {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === "string" && item.length > 1000) return `${item.slice(0, 1000)}…`;
      return item;
    }).slice(0, 4000);
  } catch {
    return "";
  }
}

function httpStatus(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null;
}

function retryableFor(code: string, status: number | null, message: string) {
  if (/credit_balance_exhausted|insufficient_quota|billing_hard_limit|quota_exceeded/i.test(`${code} ${message}`)) return false;
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status || 0)) return true;
  if (/timeout|timed out|network|fetch failed|connection|rate.?limit|temporar|schema cache/i.test(`${code} ${message}`)) return true;
  if (/401|403|invalid.*key|not configured|permission denied|row-level security/i.test(`${code} ${message}`)) return false;
  return false;
}

export function normalizeError(error: unknown, context: ErrorContext): NormalizedAiError {
  const root = recordOf(error);
  const nested = recordOf(root.error);
  const cause = recordOf(root.cause);
  const response = recordOf(root.response);
  const status = httpStatus(root.status ?? root.statusCode ?? nested.status ?? response.status ?? cause.status);
  const rawMessage = textValue(
    error instanceof Error ? error.message : "",
    root.message,
    nested.message,
    cause.message,
    root.error_description,
    root.details,
    typeof error === "string" ? error : "",
  );
  const message = rawMessage && rawMessage !== "[object Object]"
    ? rawMessage
    : compactJson(error) || "未返回可识别的错误信息";
  const inferredCode = /OPENAI_/i.test(message) ? message.match(/OPENAI_[A-Z0-9_]+/i)?.[0]
    : /GOOGLE_/i.test(message) ? message.match(/GOOGLE_[A-Z0-9_]+/i)?.[0]
      : undefined;
  const code = textValue(root.code, nested.code, cause.code, inferredCode, status ? `HTTP_${status}` : "", "UNKNOWN_ERROR")
    .replace(/[^A-Z0-9_:-]+/gi, "_").toUpperCase().slice(0, 120);
  const requestId = textValue(
    root.request_id, root.requestId, nested.request_id, nested.requestId,
    response.request_id, response.requestId,
    recordOf(response.headers)["x-request-id"],
  ) || null;
  return {
    error_code: code,
    error_message: message.slice(0, 2000),
    details: textValue(root.details, nested.details, cause.details, compactJson(root.data)) || null,
    hint: textValue(root.hint, nested.hint, cause.hint) || null,
    stage: context.stage,
    channel: context.channel || null,
    provider: context.provider || null,
    http_status: status,
    request_id: requestId,
    retryable: retryableFor(code, status, message),
    attempt_number: Math.max(1, Number(context.attemptNumber || 1)),
    duration_ms: context.durationMs == null ? null : Math.max(0, Math.round(context.durationMs)),
  };
}

export function normalizedErrorMessage(error: unknown, context: ErrorContext) {
  const normalized = normalizeError(error, context);
  return `${normalized.error_code}：${normalized.error_message}`;
}
