export const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_KEY || "";

function resolveBaseUrl() {
  const baseUrl = (process.env.APPS_SCRIPT_URL || "").trim();

  if (!baseUrl || baseUrl.includes("XXXX")) {
    throw new Error("APPS_SCRIPT_URL is not configured.");
  }

  return baseUrl.replace(/\/$/, "");
}

type QueryValue = string | number | boolean | undefined | null;

export function buildAppsScriptUrl(
  path: string,
  params?: Record<string, QueryValue>
) {
  const url = new URL(resolveBaseUrl());
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
