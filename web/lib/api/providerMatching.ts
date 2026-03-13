"use server";

export type ProviderMatchingInput = {
  category: string;
  area: string;
  taskId?: string;
  userPhone?: string;
  limit?: number;
};

export type ProviderMatchingResult = {
  ok: boolean;
  count: number;
  providers: any[];
  usedFallback: boolean;
};

const clean = (value: string) => (value || "").trim().replace(/\s+/g, " ");

function getAppsScriptUrl() {
  const scriptUrlRaw =
    process.env.APPS_SCRIPT_URL || process.env.NEXT_PUBLIC_APPS_SCRIPT_URL || "";
  return scriptUrlRaw.trim().replace(/\/$/, "");
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    ["key", "token", "apiKey", "access_token"].forEach((key) => {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "REDACTED");
      }
    });
    return url.toString();
  } catch {
    return raw;
  }
}

export async function fetchProviderMatches(
  input: ProviderMatchingInput
): Promise<ProviderMatchingResult> {
  const category = clean(input.category || "");
  const area = clean(input.area || "");
  const taskId = clean(input.taskId || "");
  const userPhone = clean(input.userPhone || "");
  const limit = Number.isFinite(Number(input.limit)) ? Number(input.limit) : 20;

  const scriptUrl = getAppsScriptUrl();
  if (!scriptUrl) {
    throw new Error("Apps Script URL is not configured.");
  }

  const payload = {
    action: "match_providers",
    category,
    service: category,
    area,
    taskId,
    userPhone,
    limit,
  };

  console.log("MATCH_HELPER_OUT", redactUrl(scriptUrl), payload);

  const upstream = await fetch(scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const text = await upstream.text();
  console.log("MATCH_HELPER_RESPONSE", text);

  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Apps Script returned non-JSON response.");
  }

  const providers = Array.isArray(json.providers) ? json.providers : [];
  return {
    ok: upstream.ok,
    count: typeof json.count === "number" ? json.count : providers.length,
    providers,
    usedFallback: Boolean(json.usedFallback),
  };
}
