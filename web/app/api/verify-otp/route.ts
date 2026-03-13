import { NextResponse } from "next/server";
import { setAuthSession } from "@/lib/auth";
import { upsertUserLogin } from "@/lib/googleSheets";

export const runtime = "nodejs";

const SHEET_NAME = "OTP";

export async function POST(request: Request) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch (error) {
      console.error("[VERIFY OTP] Invalid JSON body", error);
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const rawPhone =
      typeof body?.phoneNumber === "string"
        ? body.phoneNumber
        : typeof body?.phone === "string"
        ? body.phone
        : "";
    const otp =
      typeof body?.otp === "string" ? body.otp.trim() : "";
    const requestId =
      typeof body?.requestId === "string" ? body.requestId.trim() : "";

    const normalizedPhone = normalizeIndianPhone(rawPhone);
    if (!normalizedPhone) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid 10-digit Indian mobile number" },
        { status: 400 }
      );
    }

    if (!/^\d{4}$/.test(otp)) {
      return NextResponse.json(
        { ok: false, error: "Invalid OTP" },
        { status: 400 }
      );
    }

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

    const accessToken = await getSheetsAccessToken(
      clientEmail,
      privateKey
    );
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const valuesResponse = await fetchSheetsJson<{
      values?: string[][];
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
        `${SHEET_NAME}!A:F`
      )}`,
      headers
    );

    const values = valuesResponse.values ?? [];
    if (values.length < 2) {
      return NextResponse.json(
        { ok: false, error: "No OTP found for this phone number" },
        { status: 400 }
      );
    }

    const headerRow = values[0] ?? [];
    const headerKeys = headerRow.map((header) =>
      header
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
    );

    const phoneIdx = headerKeys.indexOf("phone");
    const otpIdx = headerKeys.indexOf("otp");
    const requestIdIdx = headerKeys.indexOf("requestid");
    const verifiedIdx = headerKeys.indexOf("verified");

    if (phoneIdx < 0 || otpIdx < 0 || verifiedIdx < 0) {
      throw new Error("OTP sheet headers are missing required columns");
    }

    const dataRows = values.slice(1);
    const findCandidate = (matchRequestId: boolean) => {
      for (let i = dataRows.length - 1; i >= 0; i -= 1) {
        const row = dataRows[i] ?? [];
        const rowPhone = (row[phoneIdx] ?? "").toString().trim();
        const rowOtp = (row[otpIdx] ?? "").toString().trim();
        const rowVerified = (row[verifiedIdx] ?? "")
          .toString()
          .trim()
          .toUpperCase();
        const rowRequestId =
          requestIdIdx >= 0
            ? (row[requestIdIdx] ?? "").toString().trim()
            : "";

        if (rowPhone !== normalizedPhone) continue;
        if (rowVerified !== "NO") continue;
        if (matchRequestId && requestId && rowRequestId !== requestId) {
          continue;
        }

        return {
          row,
          rowNumber: i + 2,
          rowOtp,
        };
      }
      return null;
    };

    const candidate =
      requestId && requestIdIdx >= 0
        ? findCandidate(true) ?? findCandidate(false)
        : findCandidate(false);

    if (!candidate) {
      return NextResponse.json(
        { ok: false, error: "No OTP found for this phone number" },
        { status: 400 }
      );
    }

    if (candidate.rowOtp !== otp) {
      return NextResponse.json(
        { ok: false, error: "Invalid OTP" },
        { status: 400 }
      );
    }

    const verifiedColumn = columnLetter(verifiedIdx);
    const updateRange = `${SHEET_NAME}!${verifiedColumn}${candidate.rowNumber}`;

    await fetchSheetsJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
        updateRange
      )}?valueInputOption=RAW`,
      headers,
      "PUT",
      { values: [["YES"]] }
    );

    const token = crypto.randomUUID();
    const response = NextResponse.json({
      ok: true,
      phone: normalizedPhone,
      token,
      message: "Verified",
    });

    setAuthSession(normalizedPhone, token, {
      setCookie: (name, value, options) =>
        response.cookies.set(name, value, options),
    });
    await upsertUserLogin(normalizedPhone);
    return response;
  } catch (error: any) {
    console.error("[VERIFY OTP ERROR]", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

function normalizeIndianPhone(value: string) {
  const digitsOnly = value.replace(/\D/g, "");
  if (digitsOnly.length === 10) {
    return `91${digitsOnly}`;
  }
  if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) {
    return digitsOnly;
  }
  return null;
}

function columnLetter(index: number) {
  let letter = "";
  let num = index + 1;
  while (num > 0) {
    const mod = (num - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    num = Math.floor((num - mod) / 26);
  }
  return letter;
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
