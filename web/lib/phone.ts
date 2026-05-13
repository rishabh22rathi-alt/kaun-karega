/**
 * Canonical phone-number helpers for chat / provider / user identity checks.
 *
 * Why this file exists:
 *   Several chat-side and provider-side modules used to carry their own
 *   private `normalizePhone10` function — identical in logic but
 *   independently maintained. The provider cross-access security audit
 *   asked for one shared helper so any future tightening (e.g. accepting
 *   13-digit international numbers, rejecting fewer than 10 digits) is a
 *   single-file change.
 *
 *   Security-critical comparisons must use `phonesEqualLast10`. The plain
 *   `normalizePhone10` is for display / persistence and is permissive: it
 *   returns the trailing 10 digits regardless of input length. The strict
 *   comparator below refuses to match when either side cannot be reduced
 *   to exactly 10 digits — so an accidental empty session phone or an
 *   empty thread phone never authorizes access.
 */

/**
 * Strip every non-digit and return the trailing 10 digits.
 *
 * Behaviour notes:
 *   - `null` / `undefined` / empty → `""`
 *   - "9999999901" → "9999999901"
 *   - "+91 9999999901" → "9999999901"
 *   - "919999999901" → "9999999901"
 *   - "12345" → "12345"  (returns the available digits; callers that
 *                          need strict 10-digit validity must check
 *                          `value.length === 10` or use
 *                          `isValidIndian10`).
 *
 * Behaviour is INTENTIONALLY identical to the per-file helpers it
 * supersedes so existing call sites can adopt it without semantic
 * change. New comparison code should prefer `phonesEqualLast10`.
 */
export function normalizePhone10(value: unknown): string {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(-10);
}

/**
 * Strict Indian 10-digit validity check. Returns `true` only when the
 * input reduces to exactly 10 digits.
 */
export function isValidIndian10(value: unknown): boolean {
  return normalizePhone10(value).length === 10;
}

/**
 * Security comparator — never returns `true` for empty inputs.
 *
 * Both sides are reduced to their trailing 10 digits AND each side
 * must be exactly 10 digits before the equality is honoured. This
 * blocks the "empty session phone matches empty thread phone" leak
 * vector even if a future caller forgets to pre-validate.
 *
 * Use this in every authorisation comparison that pairs:
 *   - chat_threads.user_phone with session.phone
 *   - chat_threads.provider_phone with session.phone
 *   - need_chat_threads.poster_phone with session.phone
 *   - need_chat_threads.responder_phone with session.phone
 *   - chat_messages.sender_phone (when used for ownership)
 */
export function phonesEqualLast10(a: unknown, b: unknown): boolean {
  const left = normalizePhone10(a);
  const right = normalizePhone10(b);
  if (left.length !== 10 || right.length !== 10) return false;
  return left === right;
}
