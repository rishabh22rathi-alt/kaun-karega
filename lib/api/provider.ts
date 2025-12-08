import { appsScriptGet } from "./client";

export type ProviderDashboard = {
  provider: {
    providerId: string;
    name: string;
    phone: string;
    categories: string[];
    areas: string[];
    status: string;
  };
  stats: {
    tasksReceived: number;
    tasksAccepted: number;
    responseRate: number;
  };
  tasksReceived: {
    taskId: string;
    category: string;
    area: string;
    sentAt: string;
    accepted: boolean;
  }[];
  tasksAccepted: {
    taskId: string;
    category: string;
    area: string;
    acceptedAt: string;
  }[];
  reviews: {
    reviewId: string;
    rating: number;
    comment: string;
    userPhone: string;
    createdAt: string;
  }[];
};

export async function getProviderDashboard(
  providerId: string
): Promise<ProviderDashboard | null> {
  if (!providerId) return null;
  try {
    return await appsScriptGet<ProviderDashboard>("provider/getDashboard", {
      providerId,
    });
  } catch (err) {
    console.error("getProviderDashboard error", err);
    return null;
  }
}
