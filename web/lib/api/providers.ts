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
  try {
    const res = await fetch("/api/admin/providers", { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as Provider[]) : [];
  } catch (err) {
    console.error("getAllProviders error", err);
    return [];
  }
}

export async function getProviderById(id: string): Promise<Provider | null> {
  try {
    const res = await fetch(`/api/admin/providers/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.ok === false) return null;
    return data as Provider;
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
  try {
    const res = await fetch("/api/admin/providers/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { success: false };
    return (await res.json()) as { success: boolean };
  } catch (err) {
    console.error("updateProvider error", err);
    return { success: false };
  }
}

export async function blockProvider(id: string): Promise<BlockResponse | null> {
  try {
    const res = await fetch("/api/admin/providers/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) return null;
    return (await res.json()) as BlockResponse;
  } catch (err) {
    console.error("blockProvider error", err);
    return null;
  }
}

export async function unblockProvider(id: string): Promise<BlockResponse | null> {
  try {
    const res = await fetch("/api/admin/providers/unblock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) return null;
    return (await res.json()) as BlockResponse;
  } catch (err) {
    console.error("unblockProvider error", err);
    return null;
  }
}
