import { normalizePhone } from "@/lib/utils/phone";

const APPS_SCRIPT_URL =
  process.env.APPS_SCRIPT_URL || process.env.NEXT_PUBLIC_APPS_SCRIPT_URL || "";

type VerifyPayload = {
  phone?: string;
};

async function postToAppsScript(payload: Record<string, unknown>) {
  if (!APPS_SCRIPT_URL) {
    throw new Error("Apps Script URL is not configured");
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(
      typeof data === "object" && data && "error" in data
        ? String((data as { error?: unknown }).error || "Apps Script request failed")
        : "Apps Script request failed"
    );
  }

  return data as {
    ok?: boolean;
    admin?: {
      name?: string;
      phone?: string;
      role?: string;
      permissions?: string[];
    };
    error?: string;
  };
}

export async function POST(req: Request) {
  try {
    const { phone }: VerifyPayload = await req.json();
    const normalizedPhone = normalizePhone(phone ?? "");

    if (!normalizedPhone) {
      return Response.json({ ok: false, error: "Invalid phone" }, { status: 400 });
    }

    const data = await postToAppsScript({
      action: "admin_verify",
      phone: normalizedPhone,
    });

    if (!data.ok || !data.admin) {
      return Response.json(
        { ok: false, error: data.error || "Access denied" },
        { status: 403 }
      );
    }

    return Response.json({ ok: true, admin: data.admin });
  } catch (error) {
    console.error("Admin verify error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
