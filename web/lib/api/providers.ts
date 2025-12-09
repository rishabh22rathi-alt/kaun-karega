import { ADMIN_KEY, appsScriptGet, appsScriptPost } from "./client";

export type ProviderStatus = "Active" | "Pending" | "Blocked" | string;

export type Provider = {
  id: string;
  name: string;
  phone: string;
  categories: string[];
  areas: string[];
  status: ProviderStatus;
  totalTasks: number;
  totalResponses: number;
};

type BlockResponse = { status: ProviderStatus };

export async function getAllProviders(): Promise<Provider[]> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptGet<Provider[]>(
      "providers/getAll",
      {},
      { admin: true }
    );
  } catch (err) {
    console.error("getAllProviders error", err);
    return [];
  }
}

export async function getProviderById(id: string): Promise<Provider | null> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptGet<Provider>(
      "providers/getById",
      { id },
      { admin: true }
    );
  } catch (err) {
    console.error("getProviderById error", err);
    return null;
  }
}

export type UpdateProviderInput = {
  id: string;
  name: string;
  phone: string;
  categories: string[];
  areas: string[];
};

export async function updateProvider(input: UpdateProviderInput): Promise<{ success: boolean }> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptPost<{ success: boolean }>(
      "providers/update",
      { ...input },
      { admin: true }
    );
  } catch (err) {
    console.error("updateProvider error", err);
    return { success: false };
  }
}

export async function blockProvider(id: string): Promise<BlockResponse | null> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptPost<BlockResponse>(
      "providers/block",
      { id },
      { admin: true }
    );
  } catch (err) {
    console.error("blockProvider error", err);
    return null;
  }
}

export async function unblockProvider(id: string): Promise<BlockResponse | null> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptPost<BlockResponse>(
      "providers/unblock",
      { id },
      { admin: true }
    );
  } catch (err) {
    console.error("unblockProvider error", err);
    return null;
  }
}
