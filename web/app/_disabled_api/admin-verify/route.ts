import { getAdminByPhone } from "@/lib/googleSheets";
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

    const admin = await getAdminByPhone(normalizedPhone);

    if (!admin) {
      return Response.json({ ok: false, error: "Access denied" }, { status: 403 });
    }

    return Response.json({ ok: true, admin });
  } catch (error) {
    console.error("Admin verify error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
