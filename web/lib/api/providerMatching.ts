"use server";

// Disabled. Provider matching now runs entirely against Supabase via the
// native /api/find-provider and /api/process-task-notifications routes.
// This file used to call Google Apps Script (`match_providers`) directly.
// Kept as a throwing stub so any leftover importer fails loudly instead of
// silently re-introducing an APPS_SCRIPT_URL dependency.

export type ProviderMatchingInput = {
  category: string;
  area: string;
  taskId?: string;
  userPhone?: string;
  limit?: number;
};

export type ProviderMatchingResult = {
  ok: boolean;
  count: number;
  providers: unknown[];
  usedFallback: boolean;
};

export async function fetchProviderMatches(
  _input: ProviderMatchingInput
): Promise<ProviderMatchingResult> {
  throw new Error(
    "fetchProviderMatches is disabled. Call /api/find-provider instead."
  );
}
