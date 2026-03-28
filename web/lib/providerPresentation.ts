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

// Returns true if the provider's OTP verification is still within the 30-day window.
// Transition rule: if OtpVerifiedAt is blank, treat as valid (legacy provider not yet re-verified).
// Once OtpVerifiedAt is written by a new OTP login, the 30-day expiry is enforced from that point.
export function isOtpStillValid(otpVerified: unknown, otpVerifiedAt: unknown): boolean {
  const v = String(otpVerified ?? "").trim().toLowerCase();
  if (v !== "yes" && v !== "true" && v !== "1") return false;

  const at = String(otpVerifiedAt ?? "").trim();
  if (!at) return true; // transition: legacy provider, no OtpVerifiedAt written yet

  const parsed = new Date(at);
  if (isNaN(parsed.getTime())) return false;

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return Date.now() - parsed.getTime() <= thirtyDaysMs;
}

// Full verified badge rule:
//   registered_with_us = Verified === "yes"
//   otp_still_valid    = OtpVerified === "yes" AND (OtpVerifiedAt blank OR within 30 days)
//   not_pending        = PendingApproval !== "yes"
export function isProviderVerifiedBadge(provider: {
  Verified?: unknown;
  OtpVerified?: unknown;
  OtpVerifiedAt?: unknown;
  PendingApproval?: unknown;
}): boolean {
  if (normalizeVerifiedValue(provider.Verified) !== "yes") return false;
  if (!isOtpStillValid(provider.OtpVerified, provider.OtpVerifiedAt)) return false;
  if (String(provider.PendingApproval ?? "").trim().toLowerCase() === "yes") return false;
  return true;
}
