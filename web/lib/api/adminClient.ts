type AdminFetchOptions<TBody = unknown> = Omit<RequestInit, "body"> & {
  body?: TBody;
};

const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_KEY || "";
const APPS_SCRIPT_BASE_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL || "";

function buildUrl(path: string, method: string) {
  var base = APPS_SCRIPT_BASE_URL.replace(/\/$/, "");
  var cleanPath = path.replace(/^\//, "");
  var url = base ? base + "/" + cleanPath : cleanPath;
  if (method === "GET" && ADMIN_KEY) {
    var separator = url.indexOf("?") === -1 ? "?" : "&";
    url += separator + "x-admin-key=" + encodeURIComponent(ADMIN_KEY);
  }
  return url;
}

/**
 * Fetch wrapper for Apps Script admin APIs that injects the admin key.
 * Adds both header and (for GET) query param to satisfy GAS parameter parsing.
 */
export async function adminApiFetch<TResponse = unknown, TBody = unknown>(
  path: string,
  options?: AdminFetchOptions<TBody>
): Promise<TResponse> {
  if (!ADMIN_KEY) {
    throw new Error("NEXT_PUBLIC_ADMIN_KEY is not set");
  }

  var method = (options && options.method) || (options && options.body ? "POST" : "GET");
  var url = buildUrl(path, method);
  var headers: Record<string, string> = {
    "x-admin-key": ADMIN_KEY,
    ...(options && options.headers ? (options.headers as Record<string, string>) : {}),
  };

  var body: BodyInit | undefined;
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    var rawBody = options && options.body;
    var parsedBody: Record<string, unknown> =
      typeof rawBody === "string"
        ? safelyParseJson(rawBody)
        : (rawBody as Record<string, unknown>) || {};
    parsedBody.adminKey = ADMIN_KEY;
    body = JSON.stringify(parsedBody);
  }

  const response = await fetch(url, {
    ...(options || {}),
    method,
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Admin API error ${response.status}: ${text}`);
  }

  return (await response.json()) as TResponse;
}

function safelyParseJson(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (err) {
    return {};
  }
}
