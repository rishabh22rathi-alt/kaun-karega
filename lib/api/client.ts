const DEFAULT_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwnCwMjFbL3xuKMRY2tHGIOJx-9vnxoneLPgtPnP1MRNXE_xlWDhu7mr5iH-e5HyEqk5w/exec";

const RAW_BASE_URL = (process.env.NEXT_PUBLIC_APPS_SCRIPT_URL || "").trim();

export const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_KEY || "";

function resolveBaseUrl() {
  if (RAW_BASE_URL && !RAW_BASE_URL.includes("XXXX")) {
    return RAW_BASE_URL.replace(/\/$/, "");
  }
  return DEFAULT_APPS_SCRIPT_URL;
}

export const APPS_SCRIPT_BASE_URL = resolveBaseUrl();

type QueryValue = string | number | boolean | undefined | null;

export function buildAppsScriptUrl(
  path: string,
  params?: Record<string, QueryValue>
) {
  const url = new URL(APPS_SCRIPT_BASE_URL);
  url.searchParams.set("path", path.replace(/^\//, ""));
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.toString();
}

export async function appsScriptGet<T>(
  path: string,
  params?: Record<string, QueryValue>,
  opts?: { admin?: boolean }
): Promise<T> {
  const finalParams = { ...(params || {}) };
  if (opts?.admin && ADMIN_KEY) {
    finalParams["x-admin-key"] = ADMIN_KEY;
  }
  const url = buildAppsScriptUrl(path, finalParams);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apps Script GET ${res.status}: ${text}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`Apps Script GET parse error: ${text}`);
  }
}

export async function appsScriptPost<T>(
  path: string,
  body?: Record<string, unknown>,
  opts?: { admin?: boolean }
): Promise<T> {
  const payload: Record<string, unknown> = { ...(body || {}) };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.admin && ADMIN_KEY) {
    payload.adminKey = ADMIN_KEY;
    headers["x-admin-key"] = ADMIN_KEY;
  }
  const res = await fetch(buildAppsScriptUrl(path), {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apps Script POST ${res.status}: ${text}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`Apps Script POST parse error: ${text}`);
  }
}
