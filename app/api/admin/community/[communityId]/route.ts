import { getCommunityById, getCommunityHelpers } from "@/lib/googleSheets";

type Params = {
  params: { communityId: string };
};

export async function GET(_: Request, { params }: Params) {
  try {
    const community = await getCommunityById(params.communityId);
    if (!community) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const helpers = await getCommunityHelpers(params.communityId);
    return Response.json({ ok: true, community, helpers });
  } catch (error) {
    console.error("Admin community detail error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
