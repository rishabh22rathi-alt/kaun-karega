type AuthSession = {
  phone: string;
  verified: true;
  createdAt: number;
};

const STORAGE_KEY = "kk_auth_session";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

type CookieOptions = {
  maxAge?: number;
  path?: string;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  httpOnly?: boolean;
};

type CookieSetter = (name: string, value: string, options: CookieOptions) => void;
type CookieSource = { cookie?: string };

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function buildSession(phone: string, now = Date.now()): AuthSession {
  return {
    phone,
    verified: true,
    createdAt: now,
  };
}

function serializeSession(session: AuthSession): string {
  return encodeURIComponent(JSON.stringify(session));
}

function readCookie(name: string, source: string): string | null {
  const cookies = source ? source.split("; ") : [];
  for (const entry of cookies) {
    const [key, ...rest] = entry.split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return null;
}

function writeCookie(name: string, value: string, options: CookieOptions): void {
  if (!isBrowser()) return;
  const parts = [`${name}=${value}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    parts.push("Secure");
  }
  document.cookie = parts.join("; ");
}

function clearCookie(name: string): void {
  writeCookie(name, "", { maxAge: 0, path: "/" });
}

export function getAuthSession(options?: CookieSource): AuthSession | null {
  const cookieSource = options?.cookie ?? (isBrowser() ? document.cookie : "");
  if (!cookieSource) return null;

  try {
    const raw = readCookie(STORAGE_KEY, cookieSource);
    if (!raw) return null;

    const session = JSON.parse(decodeURIComponent(raw)) as AuthSession;
    if (
      !session ||
      typeof session.phone !== "string" ||
      session.verified !== true ||
      typeof session.createdAt !== "number"
    ) {
      clearCookie(STORAGE_KEY);
      return null;
    }

    return session;
  } catch {
    clearCookie(STORAGE_KEY);
    return null;
  }
}

export function setAuthSession(
  phone: string,
  _token?: string,
  options?: { setCookie?: CookieSetter; now?: number }
): void {
  const session = buildSession(phone, options?.now);
  const value = serializeSession(session);
  const cookieOptions: CookieOptions = {
    maxAge: THIRTY_DAYS_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: isBrowser()
      ? window.location.protocol === "https:"
      : process.env.NODE_ENV === "production",
  };

  if (options?.setCookie) {
    options.setCookie(STORAGE_KEY, value, cookieOptions);
    return;
  }

  writeCookie(STORAGE_KEY, value, cookieOptions);
}

export function clearAuthSession(): void {
  if (!isBrowser()) return;
  clearCookie(STORAGE_KEY);
  clearCookie("kk_admin");
}

export function isLoggedIn(): boolean {
  return getAuthSession() !== null;
}
