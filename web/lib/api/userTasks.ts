export type UserTask = {
  taskId: string;
  displayId?: string;
  category: string;
  area: string;
  details: string;
  urgency?: string;
  createdAt: string;
  providersNotified: number;
  firstSentAt: string;
  status: "submitted" | "notified" | "responded" | "no_providers_matched" | "";
};

type MyRequestsApiResponse = {
  ok?: boolean;
  error?: string;
  requests?: Array<Record<string, unknown>>;
};

export async function getUserTasks(phone: string): Promise<UserTask[]> {
  if (!phone) return [];
  try {
    const response = await fetch("/api/my-requests", {
      cache: "no-store",
    });
    const data = (await response.json()) as MyRequestsApiResponse;

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "Failed to load user tasks");
    }

    const requests = Array.isArray(data.requests) ? data.requests : [];
    return requests.map((item) => ({
      taskId: String(item.TaskID ?? item.taskId ?? "").trim(),
      displayId: String(item.DisplayID ?? item.displayId ?? "").trim() || undefined,
      category: String(item.Category ?? item.category ?? "").trim(),
      area: String(item.Area ?? item.area ?? "").trim(),
      details: String(item.Details ?? item.details ?? "").trim(),
      urgency: String(item.Urgency ?? item.urgency ?? "").trim() || undefined,
      createdAt: String(item.CreatedAt ?? item.createdAt ?? "").trim(),
      providersNotified: Number(
        item.ProvidersNotified ??
          item.providersNotified ??
          item.TotalProvidersNotified ??
          0
      ),
      firstSentAt: String(item.FirstSentAt ?? item.firstSentAt ?? "").trim(),
      status: String(item.Status ?? item.status ?? "").trim().toLowerCase() as UserTask["status"],
    }));
  } catch (err) {
    console.error("getUserTasks error", err);
    return [];
  }
}
