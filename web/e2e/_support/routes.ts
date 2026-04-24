import type { Page, Request, Route } from "@playwright/test";

import { COMMON_AREAS, COMMON_CATEGORIES, QA_DISPLAY_ID, QA_TASK_ID } from "./data";

type JsonRouteResult = {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
};

type JsonRouteHandler = (context: {
  route: Route;
  request: Request;
  body: Record<string, unknown>;
}) => Promise<JsonRouteResult> | JsonRouteResult;

type KkRouteHandler = (context: {
  route: Route;
  request: Request;
  body: Record<string, unknown>;
  action: string;
}) => Promise<JsonRouteResult> | JsonRouteResult;

function parseJsonBody(request: Request): Record<string, unknown> {
  try {
    const raw = request.postData() || "{}";
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function fulfillJson(route: Route, result: JsonRouteResult): Promise<void> {
  await route.fulfill({
    status: result.status ?? 200,
    contentType: "application/json",
    headers: result.headers,
    body: JSON.stringify(result.body),
  });
}

export function jsonOk(body: Record<string, unknown> = {}, status = 200): JsonRouteResult {
  return {
    status,
    body: { ok: true, ...body },
  };
}

export function jsonError(
  error: string,
  status = 500,
  body: Record<string, unknown> = {}
): JsonRouteResult {
  return {
    status,
    body: { ok: false, error, ...body },
  };
}

export async function mockJson(
  page: Page,
  matcher: string | RegExp,
  result: JsonRouteResult | JsonRouteHandler
): Promise<void> {
  await page.route(matcher, async (route) => {
    const request = route.request();
    const body = parseJsonBody(request);
    const resolved =
      typeof result === "function" ? await result({ route, request, body }) : result;
    await fulfillJson(route, resolved);
  });
}

export async function mockKkActions(
  page: Page,
  actions: Record<string, JsonRouteResult | KkRouteHandler>,
  fallback: JsonRouteResult | KkRouteHandler = jsonError("Unhandled /api/kk action", 501)
): Promise<void> {
  await page.route("**/api/kk**", async (route) => {
    const request = route.request();
    const body = parseJsonBody(request);
    const actionFromQuery = new URL(request.url()).searchParams.get("action") || "";
    const action = String(body.action || actionFromQuery || "").trim();
    const handler = actions[action] ?? fallback;
    const resolved =
      typeof handler === "function"
        ? await handler({ route, request, body, action })
        : handler;
    await fulfillJson(route, resolved);
  });
}

export async function mockCommonCatalogRoutes(
  page: Page,
  {
    categories = COMMON_CATEGORIES,
    areas = COMMON_AREAS,
  }: {
    categories?: Array<{ name: string; active: string }>;
    areas?: string[];
  } = {}
): Promise<void> {
  await mockJson(page, "**/api/categories**", jsonOk({ categories }));
  await mockJson(page, "**/api/areas**", ({ request }) => {
    const query = (new URL(request.url()).searchParams.get("q") || "").toLowerCase();
    const filteredAreas = query
      ? areas.filter((area) => area.toLowerCase().includes(query))
      : areas;
    return jsonOk({ areas: filteredAreas });
  });
}

export async function mockSubmitRequestSuccess(
  page: Page,
  {
    taskId = QA_TASK_ID,
    displayId = QA_DISPLAY_ID,
  }: {
    taskId?: string;
    displayId?: string;
  } = {}
): Promise<void> {
  await mockJson(
    page,
    "**/api/submit-request**",
    jsonOk({ taskId, displayId })
  );
}
