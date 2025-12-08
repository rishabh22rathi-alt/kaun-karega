import { resolveCommunityRequest } from "@/lib/googleSheets";

type Params = { params: { communityId: string } };

export async function POST(_: Request, { params }: Params) {
  try {
    await resolveCommunityRequest(params.communityId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Admin community resolve error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
