import { appsScriptGet } from "./client";

export type UserTask = {
  taskId: string;
  category: string;
  area: string;
  details: string;
  urgency?: string;
  createdAt: string;
  providersNotified: number;
  firstSentAt: string;
  status: "submitted" | "notified" | "responded" | "";
};

export async function getUserTasks(phone: string): Promise<UserTask[]> {
  if (!phone) return [];
  try {
    const data = await appsScriptGet<{ tasks?: UserTask[] }>("tasks/getUserTasks", {
      phone,
    });
    return data.tasks || [];
  } catch (err) {
    console.error("getUserTasks error", err);
    return [];
  }
}
