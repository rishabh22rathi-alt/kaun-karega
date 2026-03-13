import { deleteTeamMember } from "@/lib/googleSheets";
import { normalizePhone } from "@/lib/utils/phone";

type DeletePayload = {
  phone?: string;
};

export async function POST(req: Request) {
  try {
    const { phone }: DeletePayload = await req.json();
    if (!phone) {
      return Response.json(
        { ok: false, error: "Missing phone" },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return Response.json({ ok: false, error: "Invalid phone" }, { status: 400 });
    }

    await deleteTeamMember(normalizedPhone);
    return Response.json({ ok: true });
  } catch (error: any) {
    console.error("Admin team delete error:", error);
    const message = error?.message || "Internal error";
    const status = message === "Team member not found" ? 404 : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}
