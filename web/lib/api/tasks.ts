import { ADMIN_KEY, appsScriptGet, appsScriptPost } from "./client";

export type DistributeTaskInput = {
  taskId: string;
  category: string;
  area: string;
  details: string;
  urgency: string;
  createdAt: string;
  actionUrl?: string;
  phone?: string;
};

export type DistributeTaskResponse = {
  success: boolean;
  notifiedProviders?: number;
  error?: string;
};

export type NoResponseTask = {
  taskId: string;
  displayId?: string;
  category: string;
  area: string;
  status?: string;
  notifiedAt?: string;
  details: string;
  urgency: string;
  createdAt: string;
  firstSentAt: string;
  totalProvidersNotified: number;
};

export async function distributeTask(
  task: DistributeTaskInput
): Promise<DistributeTaskResponse> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptPost<DistributeTaskResponse>(
      "tasks/distribute",
      { ...task },
      { admin: true }
    );
  } catch (err) {
    console.error("distributeTask error", err);
    return { success: false, error: (err as Error).message };
  }
}

export async function getTasksWithoutResponse(): Promise<NoResponseTask[]> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    const data = await appsScriptGet<{ tasks?: NoResponseTask[] }>(
      "tasks/listNoResponse",
      {},
      { admin: true }
    );
    return data.tasks || [];
  } catch (err) {
    console.error("getTasksWithoutResponse error", err);
    return [];
  }
}

export async function resendTask(taskId: string) {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptPost("tasks/resend", { taskId }, { admin: true });
  } catch (err) {
    console.error("resendTask error", err);
    return { success: false, error: (err as Error).message };
  }
}

export async function getTasksWithoutResponseSince(hours: number): Promise<NoResponseTask[]> {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    const data = await appsScriptGet<{ tasks?: NoResponseTask[] }>(
      "tasks/listNoResponse",
      { minHours: String(hours) },
      { admin: true }
    );
    return data.tasks || [];
  } catch (err) {
    console.error("getTasksWithoutResponseSince error", err);
    return [];
  }
}

export async function markTaskResponded(taskId: string) {
  if (!ADMIN_KEY) {
    console.warn("NEXT_PUBLIC_ADMIN_KEY is not set");
  }
  try {
    return await appsScriptPost("tasks/markResponded", { taskId }, { admin: true });
  } catch (err) {
    console.error("markTaskResponded error", err);
    return { success: false, error: (err as Error).message };
  }
}
