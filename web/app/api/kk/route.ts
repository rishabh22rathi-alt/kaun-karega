import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const APPS_SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;

function parseArrayLike(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeProxyBody(rawBody: unknown): Record<string, unknown> {
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? ({ ...rawBody } as Record<string, unknown>)
      : {};

  body.categories = parseArrayLike(body.categories);
  body.areas = parseArrayLike(body.areas);
  if ("pendingNewCategories" in body) {
    body.pendingNewCategories = parseArrayLike(body.pendingNewCategories);
  }
  return body;
}

function buildTargetUrl(request: NextRequest): URL {
  if (!APPS_SCRIPT_URL) {
    throw new Error("NEXT_PUBLIC_APPS_SCRIPT_URL is not configured");
  }
  const target = new URL(APPS_SCRIPT_URL);
  request.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });
  return target;
}

function withNoCache(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const targetUrl = buildTargetUrl(request);
    const upstream = await fetch(targetUrl.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain, */*",
      },
    });

    const text = await upstream.text();
    const response = new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
    return withNoCache(response);
  } catch (error: any) {
    return withNoCache(
      NextResponse.json(
        {
          ok: false,
          error: "KK_PROXY_GET_FAILED",
          message: error?.message || "Failed to proxy GET request",
        },
        { status: 500 }
      )
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const targetUrl = buildTargetUrl(request);
    const rawBody = await request.json();
    const body = normalizeProxyBody(rawBody);
    const upstream = await fetch(targetUrl.toString(), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    const response = new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
    return withNoCache(response);
  } catch (error: any) {
    return withNoCache(
      NextResponse.json(
        {
          ok: false,
          error: "KK_PROXY_POST_FAILED",
          message: error?.message || "Failed to proxy POST request",
        },
        { status: 500 }
      )
    );
  }
}
