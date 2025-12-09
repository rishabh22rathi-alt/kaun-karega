import { ADMIN_KEY, appsScriptGet } from "./client";

export type LeadStatEntry = { date: string; area: string; category: string; leadCount: number };
export type LeadStats = {
  daily: LeadStatEntry[];
  byArea: { area: string; totalLeads: number }[];
  byCategory: { category: string; totalLeads: number }[];
};

export type ProviderStat = {
  providerId: string;
  name: string;
  phone: string;
  tasksSent: number;
  tasksAccepted: number;
  responseRate: number;
};

export type AreaCategoryMatrixRow = {
  area: string;
  category: string;
  leads: number;
};

export async function getLeadStats(): Promise<LeadStats> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptGet<LeadStats>(
      "analytics/getLeadStats",
      {},
      { admin: true }
    );
  } catch (err) {
    return { daily: [], byArea: [], byCategory: [] };
  }
}

export async function getAreaCategoryMatrix(): Promise<AreaCategoryMatrixRow[]> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptGet<AreaCategoryMatrixRow[]>(
      "analytics/getAreaCategoryMatrix",
      {},
      { admin: true }
    );
  } catch (err) {
    return [];
  }
}

export async function getProviderStats(): Promise<ProviderStat[]> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptGet<ProviderStat[]>(
      "analytics/getProviderStats",
      {},
      { admin: true }
    );
  } catch (err) {
    return [];
  }
}
