/**
 * Single source of truth for the user disclaimer + provider pledge:
 * version constants, max-age, full legal-text bodies, and a freshness
 * helper that works on both DB rows and localStorage records.
 *
 * Used by:
 *   - /api/user/disclaimer (GET + POST)         → server, version + freshness
 *   - /api/submit-request                       → server, freshness gate
 *   - /api/kk provider_register branch          → server, pledge version
 *   - homepage modal (Phase 2)                  → client, freshness + text
 *   - /disclaimer page (Phase 2)                → client, text
 *   - provider register page (Phase 2)          → client, pledge text
 *
 * The constants are NOT a database enum. Server-side allowlists in the
 * accept routes hard-code the accepted set so a future v2 ships as a
 * single coordinated edit here + in those allowlists.
 */

export const DISCLAIMER_VERSION = "v1" as const;
export const PROVIDER_PLEDGE_VERSION = "v1" as const;

// 15 days in milliseconds. After this much time elapses since
// `disclaimer_accepted_at`, the user is re-prompted. Same window applies
// to the localStorage-cached acceptance and the server-side gate so the
// two sources of truth never disagree on what counts as "fresh".
export const DISCLAIMER_MAX_AGE_MS = 15 * 24 * 60 * 60 * 1000;

// Browser-only localStorage key. Phase 1 does not write this (no UI),
// but the constant lives here so Phase 2 can import it without
// duplicating string literals.
export const DISCLAIMER_LOCALSTORAGE_KEY = "kk_disclaimer_accepted";

// ──────────────────────────────────────────────────────────────────────
// Legal text — verbatim copy. Both the modal (Phase 2) and the
// /disclaimer page (Phase 2) MUST render from these constants so the
// two surfaces never drift.
// ──────────────────────────────────────────────────────────────────────

export const DISCLAIMER_TEXT = `Kaun Karega is a platform that helps users connect with independent local service providers.

Provider details, service information, pricing, experience, availability, and contact information are shared by providers themselves or collected from public business listings.

Kaun Karega does not directly provide these services and does not independently guarantee the quality, safety, accuracy, legality, or authenticity of any provider or listing.

Before confirming any work, users are requested to independently verify the provider's identity, pricing, work quality, and suitability.

Any payment, agreement, warranty, service issue, damage, delay, or dispute is directly between the user and the service provider.

Please avoid advance payment unless you are fully satisfied after proper verification.

Kaun Karega may assist in handling reports or complaints, but the actual service relationship remains between users and independent providers.`;

export const PROVIDER_PLEDGE_TEXT = `By joining Kaun Karega as a service provider, you confirm that the information shared by you is genuine and accurate to the best of your knowledge.

You understand that you are independently providing services to customers and are fully responsible for your work quality, pricing, behaviour, communication, tools, staff, safety practices, permissions, and commitments.

Any payment matter, service dispute, damage, delay, misconduct, accident, legal issue, or customer complaint related to your work will remain your responsibility.

Kaun Karega is a platform that helps users discover and connect with service providers. We do not employ providers, supervise their work directly, or guarantee any provider's services.

You also agree not to misuse the platform, mislead users, share false information, or engage in fraudulent activity.

Violation of platform rules may result in account suspension or permanent removal from Kaun Karega.`;

// ──────────────────────────────────────────────────────────────────────
// Freshness helper — universal across DB rows and localStorage records.
// ──────────────────────────────────────────────────────────────────────

/**
 * Permissive shape so this helper works on:
 *   - DB row     ({version, acceptedAt}) returned by /api/user/disclaimer GET
 *   - DB row raw ({disclaimer_version, disclaimer_accepted_at}) read directly
 *     by the submit-request gate without an intermediate mapping
 *   - localStorage record ({version, acceptedAt})
 *
 * Anything missing or malformed → not fresh. Fail-closed by design.
 */
export type DisclaimerCandidate =
  | {
      version?: string | null;
      acceptedAt?: string | number | Date | null;
    }
  | {
      disclaimer_version?: string | null;
      disclaimer_accepted_at?: string | number | Date | null;
    }
  | null
  | undefined;

/**
 * Returns true iff the candidate carries:
 *   1. version equal to DISCLAIMER_VERSION (string equality, no coercion)
 *   2. acceptedAt parseable to a finite past timestamp not older than
 *      DISCLAIMER_MAX_AGE_MS at the moment of the call
 *
 * The `now` parameter exists so server-side timestamps can be evaluated
 * against a single moment within one request (avoids race where two
 * helper calls within the same request straddle a millisecond boundary).
 */
export function isDisclaimerFresh(
  candidate: DisclaimerCandidate,
  now: number = Date.now()
): boolean {
  if (!candidate) return false;
  const obj = candidate as Record<string, unknown>;

  const version =
    typeof obj.version === "string"
      ? obj.version
      : typeof obj.disclaimer_version === "string"
        ? obj.disclaimer_version
        : null;
  if (version !== DISCLAIMER_VERSION) return false;

  const acceptedRaw =
    obj.acceptedAt !== undefined
      ? obj.acceptedAt
      : obj.disclaimer_accepted_at;

  let acceptedMs: number;
  if (typeof acceptedRaw === "number") {
    acceptedMs = acceptedRaw;
  } else if (acceptedRaw instanceof Date) {
    acceptedMs = acceptedRaw.getTime();
  } else if (typeof acceptedRaw === "string") {
    acceptedMs = Date.parse(acceptedRaw);
  } else {
    return false;
  }
  if (!Number.isFinite(acceptedMs)) return false;

  // Reject future-dated acceptances (clock skew on the writer): treat
  // them as "not fresh" so the user gets a re-prompt rather than a
  // perpetual pass.
  if (acceptedMs > now) return false;

  return now - acceptedMs < DISCLAIMER_MAX_AGE_MS;
}

// ──────────────────────────────────────────────────────────────────────
// Provider Responsibility Pledge — acceptance helper.
//
// Distinct from the user disclaimer in two important ways:
//   1. NO expiry window. Pledge is a one-time signing event captured at
//      registration (or first chat for legacy/imported providers). Once
//      accepted, future chats fast-pass.
//   2. NO localStorage. Pledge state is server-only — read on demand
//      from the providers row. The frontend never caches it.
//
// "Accepted" means: pledge_version equals PROVIDER_PLEDGE_VERSION AND
// pledge_accepted_at is a parseable timestamp. Both NULL or either one
// missing → not accepted.
// ──────────────────────────────────────────────────────────────────────

export type PledgeCandidate =
  | {
      version?: string | null;
      acceptedAt?: string | number | Date | null;
    }
  | {
      pledge_version?: string | null;
      pledge_accepted_at?: string | number | Date | null;
    }
  | null
  | undefined;

export function isPledgeAccepted(candidate: PledgeCandidate): boolean {
  if (!candidate) return false;
  const obj = candidate as Record<string, unknown>;

  const version =
    typeof obj.version === "string"
      ? obj.version
      : typeof obj.pledge_version === "string"
        ? obj.pledge_version
        : null;
  if (version !== PROVIDER_PLEDGE_VERSION) return false;

  const acceptedRaw =
    obj.acceptedAt !== undefined ? obj.acceptedAt : obj.pledge_accepted_at;

  let acceptedMs: number;
  if (typeof acceptedRaw === "number") {
    acceptedMs = acceptedRaw;
  } else if (acceptedRaw instanceof Date) {
    acceptedMs = acceptedRaw.getTime();
  } else if (typeof acceptedRaw === "string") {
    acceptedMs = Date.parse(acceptedRaw);
  } else {
    return false;
  }
  return Number.isFinite(acceptedMs);
}

// ──────────────────────────────────────────────────────────────────────
// Browser-only localStorage helpers. Safe to import on the server (they
// no-op when window is undefined) but not invoked there.
// ──────────────────────────────────────────────────────────────────────

export type LocalDisclaimerRecord = {
  version: string;
  acceptedAt: string;
};

/**
 * Reads the cached acceptance from localStorage. Returns null if the
 * value is absent, malformed JSON, or doesn't match the expected shape.
 * Never throws.
 */
export function readLocalDisclaimer(): LocalDisclaimerRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DISCLAIMER_LOCALSTORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDisclaimerRecord>;
    if (
      !parsed ||
      typeof parsed.version !== "string" ||
      typeof parsed.acceptedAt !== "string"
    ) {
      return null;
    }
    return { version: parsed.version, acceptedAt: parsed.acceptedAt };
  } catch {
    return null;
  }
}

/**
 * Writes the acceptance into localStorage. acceptedAt defaults to now
 * (ISO 8601). Never throws — quota / disabled-storage errors are
 * swallowed because the server is the source of truth, the localStorage
 * cache is just an optimization to avoid a round-trip on next mount.
 */
export function writeLocalDisclaimer(
  version: string = DISCLAIMER_VERSION,
  acceptedAt: string = new Date().toISOString()
): void {
  if (typeof window === "undefined") return;
  try {
    const record: LocalDisclaimerRecord = { version, acceptedAt };
    window.localStorage.setItem(
      DISCLAIMER_LOCALSTORAGE_KEY,
      JSON.stringify(record)
    );
  } catch {
    // Storage unavailable / quota exceeded — silently ignore. Server
    // remains the authoritative answer; on next mount the GET refreshes.
  }
}
