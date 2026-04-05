export async function GET(request: Request) {
  try {
    const proxyUrl = new URL("/api/kk", request.url);
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ action: "admin_get_dashboard" }),
      cache: "no-store",
    });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    console.error("Admin stats error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
