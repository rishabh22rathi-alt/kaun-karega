import { normalizePhone } from "@/lib/utils/phone";

type VerifyPayload = {
  phone?: string;
};

export async function POST(req: Request) {
  try {
    const { phone }: VerifyPayload = await req.json();
    const normalizedPhone = normalizePhone(phone ?? "");

    if (!normalizedPhone) {
      return Response.json({ ok: false, error: "Invalid phone" }, { status: 400 });
    }

    const proxyUrl = new URL("/api/kk", req.url);
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        action: "admin_verify",
        phone: normalizedPhone,
      }),
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      data?: {
        admin?: {
          name?: string;
          phone?: string;
          role?: string;
          permissions?: string[];
        };
      } | null;
      admin?: {
        name?: string;
        phone?: string;
        role?: string;
        permissions?: string[];
      };
      error?: string;
    };
    const admin = data.data?.admin || data.admin;

    if (!response.ok || !data.ok || !admin) {
      return Response.json(
        { ok: false, error: data.error || "Access denied" },
        { status: 403 }
      );
    }

    return Response.json({ ok: true, data: { admin }, admin, error: null });
  } catch (error) {
    console.error("Admin verify error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
