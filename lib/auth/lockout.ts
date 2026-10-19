/** A timed lock is independent of the account lifecycle (active/disabled/departed). */
export function isTimedLockActive(lockedUntil: string | null | undefined, now = Date.now()) {
  return Boolean(lockedUntil && Date.parse(lockedUntil) > now);
}

export function effectiveAccountStatus(status: string, lockedUntil: string | null | undefined, now = Date.now()) {
  return status === "ACTIVE" && isTimedLockActive(lockedUntil, now) ? "LOCKED" : status;
}

export function canSetTimedLock(status: string) {
  return status === "ACTIVE" || status === "LOCKED";
}

export function canUnlockAccount(status: string, lockedUntil: string | null | undefined, now = Date.now()) {
  return status === "LOCKED" || (status === "ACTIVE" && isTimedLockActive(lockedUntil, now));
}

export function canApplyLifecycleAction(status: string, action: string) {
  if (action === "APPROVE" || action === "REJECT") return status === "PENDING";
  if (action === "ACTIVATE") return status === "DISABLED" || status === "REJECTED";
  if (action === "DISABLE") return status === "ACTIVE" || status === "LOCKED";
  if (action === "DEPART") return status === "ACTIVE" || status === "LOCKED" || status === "DISABLED";
  return true;
}

export function nextFailedLogin(previousAttempts: number, lockedUntil: string | null, maxAttempts: number, lockMinutes: number, now = Date.now()) {
  const expired = Boolean(lockedUntil && Date.parse(lockedUntil) <= now);
  const attempts = (expired ? 0 : Math.max(0, previousAttempts)) + 1;
  return {
    attempts,
    lockedUntil: attempts >= maxAttempts ? new Date(now + lockMinutes * 60000).toISOString() : null,
  };
}
