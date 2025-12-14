export const appsScriptUrl = process.env.APPS_SCRIPT_URL;

type AppsScriptPayload = Record<string, unknown>;

type AppsScriptError = { error?: unknown; message?: unknown };

type ChatRoom = {
  id?: string;
  roomId?: string;
  taskId?: string;
  userPhone?: string;
  providerPhone?: string;
  expiresAt?: string;
};

type Task = {
  id?: string;
  userPhone: string;
  category?: string;
  area?: string;
  details?: string;
  [key: string]: unknown;
};

type Review = {
  id?: string;
  rating?: number;
  comment?: string;
  [key: string]: unknown;
};

type Message = {
  roomId?: string;
  sender?: string;
  text?: string;
  timestamp?: string;
  [key: string]: unknown;
};

type TeamMember = {
  name?: string;
  phone: string;
  role?: string;
  permissions?: string[];
  active?: boolean;
  timestamp?: string;
};

type CategoriesResponse = {
  categories?: unknown;
};

type AdminStats = Record<string, unknown>;
type TaskWithStats = Record<string, unknown>;

function ensureAppsScriptUrl(): string {
  if (!appsScriptUrl) {
    throw new Error("APPS_SCRIPT_URL is not set");
  }
  return appsScriptUrl;
}

function formatError(action: string, status: number, data: unknown): Error {
  let details = "";
  if (data && typeof data === "object") {
    const errorPayload = data as AppsScriptError;
    const message = errorPayload.error ?? errorPayload.message;
    if (typeof message === "string") {
      details = message;
    } else if (typeof errorPayload.error === "object") {
      details = JSON.stringify(errorPayload.error);
    }
  }
  const suffix = details ? `: ${details}` : "";
  return new Error(`Apps Script error (${action}) [${status}]${suffix}`);
}

async function postToAppsScript<T>(
  action: string,
  payload: AppsScriptPayload = {}
): Promise<T> {
  const url = ensureAppsScriptUrl();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Apps Script (${action}) returned non-JSON response`);
  }

  if (!response.ok) {
    throw formatError(action, response.status, data);
  }

  return data as T;
}

export async function saveOTP(phone: string, otp: string) {
  return postToAppsScript("save_otp", { phone, otp });
}

export async function findProvidersByCategoryAndArea(
  category: string,
  area: string
): Promise<
  { providerId?: string; phone?: string; [key: string]: unknown }[]
> {
  return postToAppsScript("find_providers", { category, area });
}

export async function saveUserRequest(data: {
  name?: string;
  phone?: string;
  category: string;
  area: string;
  description?: string;
  details?: string;
  createdAt?: string;
}) {
  return postToAppsScript("save_user_request", data);
}

export async function savePendingCategory(payload: {
  category: string;
  area?: string;
  details?: string;
}) {
  return postToAppsScript("save_pending_category", payload);
}

export async function getAllCategories(): Promise<string[]> {
  const data = await postToAppsScript<CategoriesResponse | unknown[]>(
    "get_all_categories"
  );
  const categories: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(data.categories)
      ? data.categories
      : [];
  return categories.filter((item): item is string => typeof item === "string");
}

export async function saveTaskRow(payload: {
  taskId: string;
  userPhone: string;
  category: string;
  when: string;
  area: string;
}) {
  return postToAppsScript("save_task_row", payload);
}

export async function getAdminByPhone(phone: string) {
  return postToAppsScript("get_admin_by_phone", { phone });
}

export async function createChatRoom(payload: {
  taskId: string;
  userPhone: string;
  providerPhone: string;
}): Promise<{ roomId: string }> {
  return postToAppsScript("create_chat_room", payload);
}

export async function getChatRoom(roomId: string): Promise<ChatRoom | null> {
  return postToAppsScript("get_chat_room", { roomId });
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  return postToAppsScript("get_task_by_id", { taskId });
}

export async function getAllReviews(): Promise<Review[]> {
  return postToAppsScript("get_all_reviews");
}

export async function updateTeamMember(params: {
  phone: string;
  role: string;
  permissions: string[];
  active: boolean;
}) {
  return postToAppsScript("update_team_member", params);
}

export async function getAllChatRooms(): Promise<ChatRoom[]> {
  return postToAppsScript("get_all_chat_rooms");
}

export async function getAllTeamMembers(): Promise<TeamMember[]> {
  return postToAppsScript("get_all_team_members");
}

export async function getAllTasksWithStats(): Promise<TaskWithStats[]> {
  return postToAppsScript("get_all_tasks_with_stats");
}

export async function deleteTeamMember(phone: string) {
  return postToAppsScript("delete_team_member", { phone });
}

export async function getAdminStats(): Promise<AdminStats> {
  return postToAppsScript("get_admin_stats");
}

export async function addTeamMember(params: {
  name: string;
  phone: string;
  role: string;
  permissions: string[];
}) {
  return postToAppsScript("add_team_member", params);
}

export async function verifyOTP(phone: string, otp: string): Promise<boolean> {
  return postToAppsScript("verify_otp", { phone, otp });
}

export async function phoneExistsInProviders(
  phone: string
): Promise<boolean> {
  return postToAppsScript("phone_exists_in_providers", { phone });
}

export async function phoneExistsInReceivers(
  phone: string
): Promise<boolean> {
  return postToAppsScript("phone_exists_in_receivers", { phone });
}

export async function getReview(
  roomId: string,
  reviewerPhone: string
): Promise<Review | null> {
  return postToAppsScript("get_review", { roomId, reviewerPhone });
}

export async function saveReview(payload: {
  roomId: string;
  reviewerPhone: string;
  reviewerRole: string;
  rating: number;
  reviewText?: string;
}): Promise<{ duplicate?: boolean }> {
  return postToAppsScript("save_review", payload);
}

export async function saveTaskProviderRow(payload: {
  taskId: string;
  providerId: string;
  providerPhone: string;
}) {
  return postToAppsScript("save_task_provider_row", payload);
}

export async function getMessages(roomId: string): Promise<Message[]> {
  return postToAppsScript("get_messages", { roomId });
}

export async function addMessage(message: Message) {
  return postToAppsScript("add_message", message);
}

export async function saveProviderRegistration(payload: {
  name: string;
  phone: string;
  category: string;
  area: string;
}) {
  return postToAppsScript("save_provider_registration", payload);
}

export async function saveReceiverRegistration(payload: {
  name: string;
  phone: string;
  area: string;
}) {
  return postToAppsScript("save_receiver_registration", payload);
}
