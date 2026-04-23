import { adminSupabase } from "./supabase/admin";

// Normalize a provider's full name for collision detection.
// Lowercases, strips combining diacritics, and collapses punctuation/whitespace
// so that "Ram Kumar", "RAM  KUMAR!" and "r.a.m kumar" all normalize identically.
export function normalizeProviderName(value: string): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type DuplicateNameMatch = {
  provider_id: string;
  full_name: string;
  phone: string;
};

// Returns existing providers whose normalized full_name collides with `rawName`
// but whose phone differs from `excludePhone10`. Non-throwing; returns [] on
// any DB error so the caller can default to "no duplicates" and proceed.
export async function findDuplicateNameProviders(
  rawName: string,
  excludePhone10: string
): Promise<DuplicateNameMatch[]> {
  const normalized = normalizeProviderName(rawName);
  if (!normalized) return [];

  const { data, error } = await adminSupabase
    .from("providers")
    .select("provider_id, full_name, phone")
    .limit(500);

  if (error || !Array.isArray(data)) return [];

  const exclude10 = String(excludePhone10 || "").replace(/\D/g, "").slice(-10);

  return data
    .filter((row) => {
      const rowName = normalizeProviderName(String(row.full_name || ""));
      if (!rowName || rowName !== normalized) return false;
      const rowPhone10 = String(row.phone || "").replace(/\D/g, "").slice(-10);
      return rowPhone10 !== exclude10;
    })
    .map((row) => ({
      provider_id: String(row.provider_id || ""),
      full_name: String(row.full_name || ""),
      phone: String(row.phone || ""),
    }))
    .filter((m) => m.provider_id);
}
