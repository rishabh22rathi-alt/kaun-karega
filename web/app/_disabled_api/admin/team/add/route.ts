import { addTeamMember } from "@/lib/googleSheets";
import { normalizePhone } from "@/lib/utils/phone";

type AddPayload = {
  name?: string;
  phone?: string;
  role?: string;
  permissions?: string[];
};

export async function POST(req: Request) {
  try {
    const { name, phone, role, permissions }: AddPayload = await req.json();

    if (!name || !phone || !role || !Array.isArray(permissions)) {
      return Response.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return Response.json({ ok: false, error: "Invalid phone" }, { status: 400 });
    }

    await addTeamMember({
      name,
      phone: normalizedPhone,
      role,
      permissions,
    });

    return Response.json({ ok: true });
  } catch (error: any) {
    console.error("Admin team add error:", error);
    const message = error?.message || "Internal error";
    const status = message === "Duplicate phone" ? 400 : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}
