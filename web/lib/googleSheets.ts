// Disabled. This module wrote raw rows to Google Sheets via Apps Script.
// All flows that used it have been migrated to Supabase. Exports are kept
// as throwing stubs so any leftover importer fails loudly instead of
// silently re-introducing an APPS_SCRIPT_URL dependency.

export const appsScriptUrl: string | undefined = undefined;

const DISABLED_ERROR =
  "googleSheets helper is disabled. Use the Supabase-backed API route instead.";

export async function getSheetValues(
  _tabName: string,
  _range?: string
): Promise<{ headers: string[]; values: string[][] }> {
  throw new Error(DISABLED_ERROR);
}

export async function findSheetRow(
  _tabName: string,
  _query: Record<string, unknown>
): Promise<null> {
  throw new Error(DISABLED_ERROR);
}

export async function appendSheetRow(
  _tabName: string,
  _data: Record<string, unknown>
): Promise<void> {
  throw new Error(DISABLED_ERROR);
}

export async function updateSheetRow(
  _tabName: string,
  _rowNumber: number,
  _data: Record<string, unknown>
): Promise<void> {
  throw new Error(DISABLED_ERROR);
}

export async function getAllCategories(): Promise<string[]> {
  throw new Error(DISABLED_ERROR);
}

export async function findProvidersByCategoryAndArea(
  _category: string,
  _area: string
): Promise<string[][]> {
  throw new Error(DISABLED_ERROR);
}

export async function savePendingCategory(_data: unknown): Promise<void> {
  throw new Error(DISABLED_ERROR);
}

export async function saveUserRequest(_data: unknown): Promise<void> {
  throw new Error(DISABLED_ERROR);
}
