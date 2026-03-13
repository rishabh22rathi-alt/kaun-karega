import { updateTeamMember } from "@/lib/googleSheets";
import { normalizePhone } from "@/lib/utils/phone";

type UpdatePayload = {
  phone?: string;
  role?: string;
  permissions?: string[];
  active?: boolean;
};

export async function POST(req: Request) {
  try {
    const { phone, role, permissions, active }: UpdatePayload = await req.json();

    if (!phone || !role || !Array.isArray(permissions) || typeof active !== "boolean") {
      return Response.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return Response.json({ ok: false, error: "Invalid phone" }, { status: 400 });
    }

    await updateTeamMember({
      phone: normalizedPhone,
      role,
      permissions,
      active,
    });

    return Response.json({ ok: true });
  } catch (error: any) {
    console.error("Admin team update error:", error);
    const message = error?.message || "Internal error";
    const status = message === "Team member not found" ? 404 : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}
