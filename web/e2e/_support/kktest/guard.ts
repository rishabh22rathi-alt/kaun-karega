/**
 * Strict row-scope guard for the KKTEST framework.
 *
 * The seeder and reset routines MUST route every destructive write through
 * these helpers. They throw the instant a target id/phone falls outside the
 * KKTEST allowlist, so a coding mistake can never delete or mutate a real
 * provider/user row. There is no "force" override here — by design.
 */

import { ID_PREFIX, PHONE_BLOCK } from "./personas";

export function isKkTestId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(ID_PREFIX);
}

export function isKkTestPhone(phone: unknown): boolean {
  const raw = String(phone ?? "").replace(/\D/g, "");
  if (!raw) return false;
  // Accept with or without a leading country code (e.g. 91 / +91).
  const local = raw.length > 10 ? raw.slice(-10) : raw;
  const n = Number(local);
  return Number.isInteger(n) && n >= PHONE_BLOCK.min && n <= PHONE_BLOCK.max;
}

/** Throws unless EVERY id is a KKTEST id. Returns the same list for chaining. */
export function assertKkTestIds(ids: readonly string[]): readonly string[] {
  const bad = ids.filter((id) => !isKkTestId(id));
  if (bad.length > 0) {
    throw new Error(
      `KKTEST guard: refusing to operate on non-KKTEST id(s): ${bad.join(", ")}`
    );
  }
  return ids;
}

/** Throws unless EVERY phone is inside the reserved block. */
export function assertKkTestPhones(phones: readonly string[]): readonly string[] {
  const bad = phones.filter((p) => !isKkTestPhone(p));
  if (bad.length > 0) {
    throw new Error(
      `KKTEST guard: refusing to operate on out-of-block phone(s): ${bad.join(
        ", "
      )}`
    );
  }
  return phones;
}

/**
 * Throws unless a SQL `LIKE` pattern is scoped to the KKTEST prefix. Used when
 * deleting by id pattern (e.g. task_id LIKE 'KKTEST_%').
 */
export function assertKkTestLikePattern(pattern: string): string {
  if (!pattern.startsWith(ID_PREFIX)) {
    throw new Error(
      `KKTEST guard: LIKE pattern "${pattern}" is not scoped to ${ID_PREFIX}`
    );
  }
  return pattern;
}
