export function normalizeVerifiedValue(value: unknown): "yes" | "no" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "yes" || normalized === "true" || normalized === "1") {
    return "yes";
  }

  return "no";
}

export function isVerifiedValue(value: unknown): boolean {
  return normalizeVerifiedValue(value) === "yes";
}

export function getVerifiedLabel(value: unknown): "Phone Verified" | "Not Verified" {
  return isVerifiedValue(value) ? "Phone Verified" : "Not Verified";
}

function parseProviderVerificationTimestamp(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return NaN;

  const direct = new Date(raw).getTime();
  if (!Number.isNaN(direct)) return direct;

  const normalized = raw.replace(",", "");
  const normalizedDirect = new Date(normalized).getTime();
  if (!Number.isNaN(normalizedDirect)) return normalizedDirect;

  const match = normalized.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i
  );
  if (!match) return NaN;

  const day = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const year = Number(match[3]);
  let hours = Number(match[4] ?? 0);
  const minutes = Number(match[5] ?? 0);
  const seconds = Number(match[6] ?? 0);
  const meridiem = String(match[7] ?? "").trim().toLowerCase();

  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  return new Date(year, monthIndex, day, hours, minutes, seconds).getTime();
}

// Returns true if the provider's OTP verification is still within the 30-day window.
// Transition rule: if OtpVerifiedAt is blank, treat as valid (legacy provider not yet re-verified).
// Once OtpVerifiedAt is written by a new OTP login, the 30-day expiry is enforced from that point.
export function isOtpStillValid(otpVerified: unknown, otpVerifiedAt: unknown): boolean {
  const v = String(otpVerified ?? "").trim().toLowerCase();
  if (v !== "yes" && v !== "true" && v !== "1") return false;

  const at = String(otpVerifiedAt ?? "").trim();
  if (!at) return true; // transition: legacy provider, no OtpVerifiedAt written yet

  const parsedTime = parseProviderVerificationTimestamp(at);
  if (Number.isNaN(parsedTime)) return false;

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return Date.now() - parsedTime <= thirtyDaysMs;
}

type ProviderVerificationShape = {
  Verified?: unknown;
  OtpVerified?: unknown;
  OtpVerifiedAt?: unknown;
  PendingApproval?: unknown;
  DuplicateNameReviewStatus?: unknown;
  verified?: unknown;
  otpVerified?: unknown;
  otpVerifiedAt?: unknown;
  pendingApproval?: unknown;
  duplicateNameReviewStatus?: unknown;
};

// Full verified badge rule:
//   registered_with_us   = Verified === "yes"
//   otp_still_valid      = OtpVerified === "yes" AND (OtpVerifiedAt blank OR within 30 days)
//   not_pending          = PendingApproval !== "yes"
//   not_duplicate_review = DuplicateNameReviewStatus !== "pending"
export function isProviderVerified(provider: ProviderVerificationShape): boolean {
  const verified = provider.Verified ?? provider.verified;
  const otpVerified = provider.OtpVerified ?? provider.otpVerified;
  const otpVerifiedAt = provider.OtpVerifiedAt ?? provider.otpVerifiedAt;
  const pendingApproval = provider.PendingApproval ?? provider.pendingApproval;
  const duplicateReviewStatus =
    provider.DuplicateNameReviewStatus ?? provider.duplicateNameReviewStatus;

  if (normalizeVerifiedValue(verified) !== "yes") return false;
  if (!isOtpStillValid(otpVerified, otpVerifiedAt)) return false;
  if (String(pendingApproval ?? "").trim().toLowerCase() === "yes") return false;
  if (String(duplicateReviewStatus ?? "").trim().toLowerCase() === "pending") return false;
  return true;
}

export function isProviderVerifiedBadge(provider: ProviderVerificationShape): boolean {
  return isProviderVerified(provider);
}
