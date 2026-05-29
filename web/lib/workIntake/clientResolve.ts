// Client-side resolver for Phase 2B. Wraps POST /api/provider/work-intake/resolve
// so the registration page never owns network, JSON-parse, or abort handling
// directly. All non-abort failure modes (network down, non-JSON body, parse
// error, unexpected shape) collapse to the same AI_UNAVAILABLE manual-fallback
// envelope the resolve API itself returns — the page treats every failure as
// "manual" with one branch.
//
// AbortError is intentionally re-thrown so the caller can distinguish "user
// edited the input" (ignore) from "AI is unreachable" (show manual fallback).

import type {
  WorkIntakeFallbackResponse,
  WorkIntakeResolveResponse,
} from "@/lib/workIntake/types";

export type WorkIntakeAnyResponse =
  | WorkIntakeResolveResponse
  | WorkIntakeFallbackResponse;

const FALLBACK: WorkIntakeFallbackResponse = {
  ok: false,
  fallbackToManual: true,
  reason: "AI_UNAVAILABLE",
};

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError";
}

/**
 * Call the resolve API. `cityCode` is included in the request body only when
 * present (matches the route's own `typeof body.cityCode === "string"` check).
 *
 * Returns the route's response envelope verbatim on success, or the FALLBACK
 * envelope on any failure other than caller-initiated abort. Aborts re-throw
 * so the caller can ignore them without rendering an error to the provider.
 */
export async function fetchResolve(
  text: string,
  cityCode?: string,
  options?: { signal?: AbortSignal }
): Promise<WorkIntakeAnyResponse> {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return { ok: false, fallbackToManual: true, reason: "NO_INPUT" };
  }

  const body: Record<string, unknown> = { text: trimmed };
  if (cityCode && /^[A-Z]{3}$/.test(cityCode)) {
    body.cityCode = cityCode;
  }

  let response: Response;
  try {
    response = await fetch("/api/provider/work-intake/resolve", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    return FALLBACK;
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return FALLBACK;
  }

  if (!parsed || typeof parsed !== "object") return FALLBACK;
  const candidate = parsed as { ok?: unknown };
  if (candidate.ok !== true && candidate.ok !== false) return FALLBACK;
  return parsed as WorkIntakeAnyResponse;
}
