export const appsScriptUrl = process.env.APPS_SCRIPT_URL;

type AppsScriptPayload = Record<string, unknown>;

function ensureAppsScriptUrl(): string {
  if (!appsScriptUrl) {
    throw new Error("APPS_SCRIPT_URL is not set");
  }
  return appsScriptUrl;
}

async function postToAppsScript<T>(
  action: string,
  payload: AppsScriptPayload = {}
): Promise<T> {
  const isPlainObject = (value: unknown) =>
    Object.prototype.toString.call(value) === "[object Object]";
  const normalizeValue = (key: string, value: unknown) => {
    if (value == null) return value;
    if (/phone|mobile/i.test(key)) {
      return value.toString();
    }
    return value;
  };

  const flatPayload: AppsScriptPayload = { action };
  Object.entries(payload).forEach(([key, value]) => {
    flatPayload[key] = normalizeValue(key, value);
    if (isPlainObject(value)) {
      Object.entries(value as Record<string, unknown>).forEach(
        ([nestedKey, nestedValue]) => {
          if (!(nestedKey in flatPayload)) {
            flatPayload[nestedKey] = normalizeValue(nestedKey, nestedValue);
          }
        }
      );
    }
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(ensureAppsScriptUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(flatPayload),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  const text = await res.text();
  let data: unknown = text;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const errorBody =
      typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`Apps Script error (${action}): ${errorBody}`);
  }

  return data as T;
}

type SheetRow = Record<string, string | number | undefined> & {
  rowNumber?: number;
  tabName?: string;
};

export async function getSheetValues(
  tabName: string,
  range?: string
): Promise<{ headers: string[]; values: string[][] }> {
  const data = await postToAppsScript<{ values: string[][] }>(
    "get_sheet_values",
    { tabName, range: range ?? `${tabName}!A:F` }
  );

  const values = data.values ?? [];
  const rawHeaders = values[0] ?? [];
  const headers = rawHeaders.map((header) => {
    const normalized = header.toString().trim().toLowerCase();
    if (normalized === "phone" || normalized === "mobile") {
      return "phone";
    }
    return normalized;
  });

  return { headers, values };
}

/* -----------------------------
   🔍 READ
----------------------------- */
export async function findSheetRow(
  tabName: string,
  query: Record<string, unknown>
): Promise<SheetRow | null> {
  const data = await postToAppsScript<{ values: string[][] }>(
    "get_sheet_values",
    { tabName, range: `${tabName}!A:F` }
  );

  const values = data.values ?? [];
  const rawHeaders = values[0] ?? [];
  const headers = rawHeaders.map((header) => {
    const normalized = header.toString().trim().toLowerCase();
    if (normalized === "phone" || normalized === "mobile") {
      return "phone";
    }
    return normalized;
  });

  for (let i = 1; i < values.length; i++) {
    const row: SheetRow = { tabName, rowNumber: i + 1 };
    headers.forEach((h, idx) => (row[h] = values[i][idx] ?? ""));
    const match = Object.entries(query).every(
      ([k, v]) => row[k] === String(v ?? "")
    );
    if (match) return row;
  }
  return null;
}

/* -----------------------------
   ➕ APPEND
----------------------------- */
export async function appendSheetRow(
  tabName: string,
  data: Record<string, unknown>
) {
  await postToAppsScript("append_sheet_row", { tabName, data });
}

/* -----------------------------
   ✏️ UPDATE (CRITICAL)
----------------------------- */
export async function updateSheetRow(
  tabName: string,
  rowNumber: number,
  data: Record<string, unknown>
) {
  await postToAppsScript("update_sheet_row", {
    tabName,
    rowNumber,
    data,
  });
}

export async function getAllCategories(): Promise<string[]> {
  const data = await postToAppsScript<unknown>("get_all_categories");

  if (Array.isArray(data)) {
    return data.filter((c): c is string => typeof c === "string");
  }

  if (data && typeof data === "object" && "categories" in data) {
    const categories = (data as { categories?: unknown }).categories;
    if (Array.isArray(categories)) {
      return categories.filter((c): c is string => typeof c === "string");
    }
  }

  return [];
}

type PendingCategoryPayload = {
  category: string;
  area: string;
  details?: string;
};

type UserRequestPayload = {
  category: string;
  area: string;
  details?: string;
  createdAt?: string;
};

export async function findProvidersByCategoryAndArea(
  category: string,
  area: string
) {
  const data = await getSheetValues("Master_Providers");
  const categoryNeedle = category.trim().toLowerCase();
  const areaNeedle = area.trim().toLowerCase();

  return data.values.filter((row) => {
    const rawCategories = (row[3] ?? "").toString().toLowerCase();
    const rawAreas = (row[4] ?? "").toString().toLowerCase();

    const categoryMatch = rawCategories
      .split(",")
      .map((entry) => entry.trim())
      .includes(categoryNeedle);
    const areaMatch = rawAreas
      .split(",")
      .map((entry) => entry.trim())
      .includes(areaNeedle);

    return categoryMatch && areaMatch;
  });
}

export async function savePendingCategory(data: any) {
  return await appendSheetRow("PendingCategories", data);
}

export async function saveUserRequest(data: any) {
  return await appendSheetRow("UserRequests", data);
}

