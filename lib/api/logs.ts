import { ADMIN_KEY, appsScriptGet } from "./client";

export type ProviderLog = {
  id: string;
  provider: string;
  action: string;
  lastResponse: string;
  taskHistory: number;
  status: string;
};

export async function getAllLogs(): Promise<ProviderLog[]> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptGet<ProviderLog[]>("logs/getAll", {}, { admin: true });
  } catch (err) {
    console.error("getAllLogs error", err);
    return [];
  }
}
