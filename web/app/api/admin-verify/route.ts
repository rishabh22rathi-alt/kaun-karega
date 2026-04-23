import { normalizePhone } from "@/lib/utils/phone";
import { verifyAdminByPhone } from "@/lib/admin/adminVerifier";

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

    // normalizePhone() returns "+91XXXXXXXXXX"; strip the leading "+" to match
    // the canonical 12-char format stored in kk_auth_session and the admins table.
    const canonicalPhone = normalizedPhone.startsWith("+")
      ? normalizedPhone.slice(1)
      : normalizedPhone;

    const result = await verifyAdminByPhone(canonicalPhone);

    if (!result.ok) {
      return Response.json({ ok: false, error: "Access denied" }, { status: 403 });
    }

    // Preserve exact response shape expected by any caller:
    // { ok: true, data: { admin: AdminSession }, admin: AdminSession, error: null }
    return Response.json({
      ok: true,
      data: { admin: result.admin },
      admin: result.admin,
      error: null,
    });
  } catch (error) {
    console.error("Admin verify error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
