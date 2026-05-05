// Disabled. This module used to call Google Apps Script via APPS_SCRIPT_URL
// for legacy admin and provider flows. The active backend is Supabase + the
// native Next.js API routes under /api/admin/*, /api/provider/*, etc.
//
// The helpers below are kept as exports so historical importers (lib/api/
// analytics, logs, provider, reviews, tasks) continue to type-check; they all
// already wrap calls in try/catch and degrade to empty defaults on throw.
// Anything new should call Supabase directly, not these stubs.

export const ADMIN_KEY = "";

const DISABLED_ERROR =
  "Apps Script client is disabled. Migrate this caller to a Supabase-backed API route.";

export function buildAppsScriptUrl(
  _path: string,
  _params?: Record<string, unknown>
): string {
  throw new Error(DISABLED_ERROR);
}

export async function appsScriptGet<T>(
  _path: string,
  _params?: Record<string, unknown>,
  _opts?: { admin?: boolean }
): Promise<T> {
  throw new Error(DISABLED_ERROR);
}

export async function appsScriptPost<T>(
  _path: string,
  _body?: Record<string, unknown>,
  _opts?: { admin?: boolean }
): Promise<T> {
  throw new Error(DISABLED_ERROR);
}
