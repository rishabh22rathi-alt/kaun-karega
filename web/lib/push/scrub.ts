// Defense-in-depth scrubber for anything that may end up in push_logs or
// stdout. FCM tokens are credentials: a leaked token allows anyone with the
// service account to push to that device. FCM error messages occasionally
// include the offending token verbatim, so we redact ANY long run of
// FCM-token-alphabet characters before persistence.
//
// Threshold rationale:
//   - FCM v1 tokens are typically 140-200+ characters.
//   - UUIDs are 36 chars (with hyphens) — well under the threshold.
//   - Normal English sentences and stack traces never produce 60-char
//     unbroken runs in the [A-Za-z0-9_:-] alphabet.
// 60 is a safe lower bound that catches real tokens without false positives
// on error codes ("messaging/registration-token-not-registered" is 47 chars).
const TOKEN_LIKE_RE = /[A-Za-z0-9_:-]{60,}/g;

export function scrubLongTokens(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.replace(TOKEN_LIKE_RE, "[REDACTED_TOKEN]");
}
