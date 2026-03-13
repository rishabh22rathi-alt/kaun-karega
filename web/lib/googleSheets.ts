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

/* -----------------------------
   🔐 OTP SAVE (FIXED)
   - One OTP per phone
   - Overwrites existing row
----------------------------- */
export async function saveOTP(
  phone: string,
  otp: string,
  requestId: string,
  istTimestamp?: string
) {
  console.log("[saveOTP] start");

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  );

  if (privateKey?.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  } else if (privateKey?.startsWith("'") && privateKey.endsWith("'")) {
    privateKey = privateKey.slice(1, -1);
  }

  if (!sheetId) {
    throw new Error("Missing env: GOOGLE_SHEET_ID");
  }
  if (!clientEmail) {
    throw new Error("Missing env: GOOGLE_SERVICE_ACCOUNT_EMAIL");
  }
  if (!privateKey) {
    throw new Error("Missing env: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  }

  const sheetName = "OTP";
  console.log("[saveOTP] using sheet", { sheetId, sheetName });

  const accessToken = await getSheetsAccessToken(clientEmail, privateKey);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const sheetMeta = await fetchSheetsJson<{
    sheets?: { properties?: { title?: string } }[];
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
    headers
  );

  const hasOtpSheet = (sheetMeta.sheets ?? []).some(
    (sheet) => sheet.properties?.title === sheetName
  );

  if (!hasOtpSheet) {
    await fetchSheetsJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
      headers,
      "POST",
      {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      }
    );
  }

  const headerRange = `${sheetName}!A1:F1`;
  const headerResponse = await fetchSheetsJson<{
    values?: string[][];
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
      headerRange
    )}`,
    headers
  );

  const expectedHeader = [
    "Phone",
    "OTP",
    "RequestId",
    "Date",
    "Time",
    "Verified",
  ];
  const existingHeader = headerResponse.values?.[0] ?? [];
  const headerMatches =
    expectedHeader.length === existingHeader.length &&
    expectedHeader.every((value, idx) => value === existingHeader[idx]);

  if (!headerMatches) {
    await fetchSheetsJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
        headerRange
      )}?valueInputOption=RAW`,
      headers,
      "PUT",
      { values: [expectedHeader] }
    );
  }

  const timestamp =
    istTimestamp ??
    new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const [date, time] = timestamp.split(", ");

  await fetchSheetsJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
      `${sheetName}!A:F`
    )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    headers,
    "POST",
    {
      values: [[phone, otp, requestId, date ?? "", time ?? "", "NO"]],
    }
  );

  console.log("[saveOTP] row appended");
}

export async function hasOTPRequestId(requestId: string): Promise<boolean> {
  if (!requestId) return false;

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  );

  if (privateKey?.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  } else if (privateKey?.startsWith("'") && privateKey.endsWith("'")) {
    privateKey = privateKey.slice(1, -1);
  }

  if (!sheetId) throw new Error("Missing env: GOOGLE_SHEET_ID");
  if (!clientEmail) {
    throw new Error("Missing env: GOOGLE_SERVICE_ACCOUNT_EMAIL");
  }
  if (!privateKey) {
    throw new Error("Missing env: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  }

  const accessToken = await getSheetsAccessToken(clientEmail, privateKey);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const valuesResponse = await fetchSheetsJson<{
    values?: string[][];
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
      "OTP!A:F"
    )}`,
    headers
  );

  const values = valuesResponse.values ?? [];
  if (values.length < 2) return false;

  const headerRow = values[0] ?? [];
  const headerKeys = headerRow.map((header) =>
    header
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
  );

  const requestIdIdx = headerKeys.indexOf("requestid");
  if (requestIdIdx < 0) return false;

  for (let i = 1; i < values.length; i += 1) {
    const rowRequestId = (values[i]?.[requestIdIdx] ?? "")
      .toString()
      .trim();
    if (rowRequestId === requestId) {
      return true;
    }
  }

  return false;
}

function base64UrlEncode(input: string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getSheetsAccessToken(
  clientEmail: string,
  privateKey: string
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsignedJwt = `${base64UrlEncode(
    JSON.stringify(header)
  )}.${base64UrlEncode(JSON.stringify(claimSet))}`;

  const { createSign } = await import("crypto");
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(privateKey);
  const jwt = `${unsignedJwt}.${signature
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    throw new Error(`Google auth error: ${tokenText}`);
  }

  const tokenJson = JSON.parse(tokenText) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error("Google auth error: missing access_token");
  }

  return tokenJson.access_token;
}

async function fetchSheetsJson<T>(
  url: string,
  headers: Record<string, string>,
  method = "GET",
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets API error (${res.status}): ${text}`);
  }

  return text ? (JSON.parse(text) as T) : ({} as T);
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

export async function upsertUserLogin(phone: string, now = new Date().toISOString()) {
  const existing = await findSheetRow("Users", { phone });
  if (existing?.rowNumber) {
    await updateSheetRow("Users", existing.rowNumber, { last_login_at: now });
    return;
  }
  await appendSheetRow("Users", {
    phone,
    first_login_at: now,
    last_login_at: now,
  });
}
