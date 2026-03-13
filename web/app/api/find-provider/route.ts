import { fetchProviderMatches } from "@/lib/api/providerMatching";

const clean = (s: string) => (s || "").trim().replace(/\s+/g, " ");

async function handle(req: Request) {
  const url = new URL(req.url);
  const queryCategory = clean(url.searchParams.get("category") || "");
  const queryService = clean(url.searchParams.get("service") || "");
  const queryArea = clean(url.searchParams.get("area") || "");
  const queryTaskId = clean(url.searchParams.get("taskId") || "");
  const queryUserPhone = clean(url.searchParams.get("userPhone") || "");
  const queryLimit = clean(url.searchParams.get("limit") || "20");

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  const category = clean(
    (typeof body.category === "string" ? body.category : queryCategory) ||
      queryService
  );
  const area = clean(
    (typeof body.area === "string" ? body.area : queryArea) || ""
  );
  const taskId = clean(
    (typeof body.taskId === "string" ? body.taskId : queryTaskId) || ""
  );
  const userPhone = clean(
    (typeof body.userPhone === "string" ? body.userPhone : queryUserPhone) || ""
  );
  const limit = Number(
    clean((typeof body.limit === "string" ? body.limit : queryLimit) || "20")
  );

  const inBody = {
    category,
    area,
    taskId,
    userPhone,
    limit: Number.isFinite(limit) ? limit : 20,
  };
  console.log("MATCH_API_IN", body && Object.keys(body).length ? body : inBody);

  let matchResult;
  try {
    matchResult = await fetchProviderMatches({
      category,
      area,
      taskId,
      userPhone,
      limit: Number.isFinite(limit) ? limit : 20,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unable to fetch matched providers.",
        providers: [],
      },
      { status: 502 }
    );
  }
  return Response.json(
    {
      ok: matchResult.ok,
      count: matchResult.count,
      providers: matchResult.providers,
      usedFallback: matchResult.usedFallback,
    },
    { status: matchResult.ok ? 200 : 502 }
  );
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
