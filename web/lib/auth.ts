/**
 * Auth session module.
 *
 * Threat model:
 *   - The signed cookie `kk_auth_session` is the SERVER source of trust.
 *     It is HttpOnly, Secure (in prod), SameSite=strict, set only by server
 *     route handlers via Set-Cookie, and signed with HMAC-SHA256 keyed on
 *     `process.env.AUTH_SESSION_SECRET`.
 *   - The companion cookie `kk_session_user` is a CLIENT UI hint only. It
 *     contains the same payload but is NOT signed and NOT trusted by the
 *     server. The server NEVER reads it for auth decisions. Its sole purpose
 *     is to let client components (Sidebar, header, etc.) display the
 *     phone / "logged in" state without an extra round-trip.
 *
 * API shape:
 *   - `getAuthSession()` (no args, browser only)            → sync, reads UI hint.
 *   - `getAuthSession({ cookie })` (server)                  → async, verifies HMAC.
 *   - `createSignedSessionCookieValue(session)` (server)     → async string|null.
 *   - `verifySignedSessionCookieValue(value)` (server)       → async session|null.
 *   - `setAuthSessionCookie(response, session)` (server)     → async void.
 *   - `clearAuthSessionCookie(response)` (server)            → void.
 *   - `clearAuthSession()` (browser)                         → async; calls
 *     POST /api/auth/logout so the server can clear HttpOnly cookies.
 *   - `isLoggedIn()` (browser)                               → sync UI hint.
 *
 * Why Web Crypto: works in Node, Edge runtime, and the browser, so the
 * same module bundles correctly on every surface (route handlers,
 * middleware, client components).
 */

export type AuthSession = {
  phone: string;
  verified: true;
  createdAt: number;
};

const COOKIE_AUTH = "kk_auth_session";
const COOKIE_USER_HINT = "kk_session_user";
const KK_ADMIN_COOKIE = "kk_admin";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;
const FUTURE_SKEW_TOLERANCE_MS = 5_000;

// ─── Encoding helpers (isomorphic) ───────────────────────────────────────────

function utf8Encode(value: string): ArrayBuffer {
  // Copy into a fresh ArrayBuffer so the result satisfies BufferSource under
  // strict TS settings (TextEncoder.encode returns Uint8Array<ArrayBufferLike>
  // which TS 5 won't widen to ArrayBuffer because of the SharedArrayBuffer
  // fork).
  const encoded = new TextEncoder().encode(value);
  const out = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(out).set(encoded);
  return out;
}

function utf8Decode(bytes: BufferSource): string {
  return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(input: ArrayBuffer | Uint8Array): string {
  const view =
    input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = "";
  for (let i = 0; i < view.byteLength; i += 1) {
    bin += String.fromCharCode(view[i]);
  }
  // btoa is available in browser, Node 16+, and Edge.
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(value: string): ArrayBuffer {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const bin = atob(padded);
  // Allocate a fresh ArrayBuffer so the result is `BufferSource`-assignable
  // under strict TS lib settings.
  const buffer = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i += 1) view[i] = bin.charCodeAt(i);
  return buffer;
}

// ─── HMAC-SHA256 via Web Crypto (sync-impossible by design) ──────────────────

function getSubtle(): SubtleCrypto | null {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) return null;
  return c.subtle;
}

function getSecret(): string | null {
  if (typeof process === "undefined" || !process.env) return null;
  const raw = process.env.AUTH_SESSION_SECRET;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 16) return null;
  return trimmed;
}

async function importHmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey | null> {
  const subtle = getSubtle();
  if (!subtle) return null;
  try {
    return await subtle.importKey(
      "raw",
      utf8Encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      [usage]
    );
  } catch {
    return null;
  }
}

async function hmacSign(secret: string, payload: string): Promise<string | null> {
  const subtle = getSubtle();
  if (!subtle) return null;
  const key = await importHmacKey(secret, "sign");
  if (!key) return null;
  try {
    const sig = await subtle.sign("HMAC", key, utf8Encode(payload));
    return bytesToBase64Url(new Uint8Array(sig));
  } catch {
    return null;
  }
}

async function hmacVerify(
  secret: string,
  payload: string,
  signatureBase64Url: string
): Promise<boolean> {
  const subtle = getSubtle();
  if (!subtle) return false;
  const key = await importHmacKey(secret, "verify");
  if (!key) return false;
  let sigBytes: ArrayBuffer;
  try {
    sigBytes = base64UrlToBytes(signatureBase64Url);
  } catch {
    return false;
  }
  try {
    return await subtle.verify("HMAC", key, sigBytes, utf8Encode(payload));
  } catch {
    return false;
  }
}

// ─── Cookie helpers ──────────────────────────────────────────────────────────

function readCookie(name: string, source: string): string | null {
  if (!source) return null;
  const cookies = source.split(/;\s*/);
  for (const entry of cookies) {
    const idx = entry.indexOf("=");
    if (idx < 0) continue;
    const key = entry.slice(0, idx);
    if (key === name) return entry.slice(idx + 1);
  }
  return null;
}

function buildSession(phone: string, now = Date.now()): AuthSession {
  return { phone, verified: true, createdAt: now };
}

// ─── Public API: signing + verification (server) ─────────────────────────────

/**
 * Create a signed cookie string for the given session.
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256 signature)>`.
 * Returns null when AUTH_SESSION_SECRET is missing/short or Web Crypto is
 * unavailable — callers MUST treat null as a hard failure and not set a
 * cookie. This fails closed: a deploy without the secret cannot create
 * sessions, which is what we want.
 */
export async function createSignedSessionCookieValue(
  session: AuthSession
): Promise<string | null> {
  const secret = getSecret();
  if (!secret) {
    console.warn(
      "[auth] AUTH_SESSION_SECRET missing or shorter than 16 chars — refusing to sign session"
    );
    return null;
  }
  const payload = bytesToBase64Url(utf8Encode(JSON.stringify(session)));
  const sig = await hmacSign(secret, payload);
  if (!sig) return null;
  return `${payload}.${sig}`;
}

/**
 * Verify a signed cookie string and return the session if valid.
 * Returns null on missing secret, missing/malformed value, bad signature,
 * future-dated payload, or expired payload (>30d).
 */
export async function verifySignedSessionCookieValue(
  value: string
): Promise<AuthSession | null> {
  if (!value) return null;
  const secret = getSecret();
  if (!secret) return null;

  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const providedSig = value.slice(dot + 1);
  if (!payload || !providedSig) return null;

  const valid = await hmacVerify(secret, payload, providedSig);
  if (!valid) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(base64UrlToBytes(payload)));
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { phone?: unknown }).phone !== "string" ||
    (parsed as { verified?: unknown }).verified !== true ||
    typeof (parsed as { createdAt?: unknown }).createdAt !== "number"
  ) {
    return null;
  }
  const session = parsed as AuthSession;
  const now = Date.now();
  if (session.createdAt > now + FUTURE_SKEW_TOLERANCE_MS) return null;
  if (now - session.createdAt > SESSION_MAX_AGE_MS) return null;

  return {
    phone: session.phone,
    verified: true,
    createdAt: session.createdAt,
  };
}

// ─── Public API: getAuthSession (overloaded) ─────────────────────────────────

/**
 * Browser overload — sync — reads the unsigned UI-hint companion cookie.
 * NEVER trusted server-side. Returns null if the cookie is absent or
 * malformed.
 */
export function getAuthSession(): AuthSession | null;
/**
 * Server overload — async — verifies the signed `kk_auth_session` cookie
 * pulled from the request's Cookie header.
 */
export function getAuthSession(options: {
  cookie: string;
}): Promise<AuthSession | null>;
export function getAuthSession(options?: {
  cookie?: string;
}): AuthSession | null | Promise<AuthSession | null> {
  // Server-mode invocation: cookie header is provided. Verify HMAC.
  if (options && typeof options.cookie === "string") {
    return (async () => {
      const raw = readCookie(COOKIE_AUTH, options.cookie ?? "");
      if (!raw) return null;
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        // Cookie wasn't URL-encoded — try the raw value.
      }
      return verifySignedSessionCookieValue(decoded);
    })();
  }

  // Browser-mode invocation: read the UI-hint cookie. NOT trusted.
  if (typeof document === "undefined") return null;
  const raw = readCookie(COOKIE_USER_HINT, document.cookie);
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded) as Partial<AuthSession>;
    if (
      typeof parsed.phone !== "string" ||
      parsed.verified !== true ||
      typeof parsed.createdAt !== "number"
    ) {
      return null;
    }
    return {
      phone: parsed.phone,
      verified: true,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

// ─── Public API: server-side cookie writers ──────────────────────────────────

// Loose shape so we accept NextResponse, Response-like wrappers, and any
// object exposing a `cookies.set(name, value, options)` method without
// pulling in next/server's typed cookie API as a hard dependency.
type CookieAttributes = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict" | "lax" | "none";
  path: string;
  maxAge: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CookieSettable = { cookies: { set: (...args: any[]) => unknown } };

function authCookieAttributes(httpOnly: boolean): CookieAttributes {
  const isProd = typeof process !== "undefined" && process.env?.NODE_ENV === "production";
  return {
    httpOnly,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Set both the signed `kk_auth_session` (HttpOnly, trusted) and the
 * `kk_session_user` UI-hint (NOT HttpOnly, NOT trusted) cookies on a
 * NextResponse-shaped object.
 *
 * Returns true on success, false if signing failed (e.g. missing secret) —
 * in that case neither cookie is set, so a misconfigured deploy fails
 * closed without exposing a forgeable session.
 */
export async function setAuthSessionCookie(
  response: CookieSettable,
  session: AuthSession
): Promise<boolean> {
  const signed = await createSignedSessionCookieValue(session);
  if (!signed) return false;
  const cookies = response.cookies as unknown as {
    set: (name: string, value: string, options: CookieAttributes) => void;
  };
  cookies.set(COOKIE_AUTH, signed, authCookieAttributes(true));
  cookies.set(
    COOKIE_USER_HINT,
    encodeURIComponent(JSON.stringify(session)),
    authCookieAttributes(false)
  );
  return true;
}

/**
 * Expire both auth cookies and the kk_admin UI cookie.
 */
export function clearAuthSessionCookie(response: CookieSettable): void {
  const cookies = response.cookies as unknown as {
    set: (name: string, value: string, options: CookieAttributes) => void;
  };
  const expire = (name: string, httpOnly: boolean) => {
    const attrs = authCookieAttributes(httpOnly);
    cookies.set(name, "", { ...attrs, maxAge: 0 });
  };
  expire(COOKIE_AUTH, true);
  expire(COOKIE_USER_HINT, false);
  expire(KK_ADMIN_COOKIE, false);
}

// ─── Public API: browser helpers ─────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Browser logout. The signed cookie is HttpOnly, so JS cannot expire it
 * directly — we must call the server. Returns the fetch promise so callers
 * can await/redirect after.
 */
export async function clearAuthSession(): Promise<void> {
  if (!isBrowser()) return;
  // Best-effort: clear local UI hint immediately so Sidebar/header reflect
  // logout even if the network call is slow.
  document.cookie = `${COOKIE_USER_HINT}=; Max-Age=0; Path=/; SameSite=Strict`;
  document.cookie = `${KK_ADMIN_COOKIE}=; Max-Age=0; Path=/; SameSite=Strict`;
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // Network failure is acceptable here — the UI already shows logged-out
    // state and the server cookie will expire on its own maxAge.
  }
}

/**
 * Browser `isLoggedIn` check based on the UI-hint cookie. UI-only — never
 * use this for any auth decision.
 */
export function isLoggedIn(): boolean {
  return getAuthSession() !== null;
}
