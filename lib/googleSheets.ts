import crypto from "crypto";
import { ts } from "./utils/time";
import { normalizePhone } from "./utils/phone";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const OTP_RANGE = "OTP!A:C";
const USERS_RANGE = "Users!A:G";
const PROVIDERS_RANGE = "MASTER_Providers!A:G";
const RECEIVERS_RANGE = "MASTER_Receivers!A:E";
const TASKS_RANGE = "Tasks!A:F";
const TASK_PROVIDERS_RANGE = "TaskProviders!A:D";
const CHAT_ROOMS_RANGE = "ChatRooms!A:G";
const MESSAGES_RANGE = "Messages!A:D";
const REVIEWS_RANGE = "Reviews!A:F";
const USER_REQUESTS_RANGE = "Tasks!A:F";

const PENDING_NEW_CATEGORIES_RANGE = "Pending_New_Categories!A:D";
const TEAM_ROLES_RANGE = "TeamRoles!A:E";
const COMMUNITY_RANGE = "Community!A:F";
const COMMUNITY_HELPERS_RANGE = "CommunityHelpers!A:C";

const teamRolesSheetId = process.env.TEAM_ROLES_SHEET_ID;

const sheetId = process.env.GOOGLE_SHEET_ID;
const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const rawPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

type CachedToken = { accessToken: string; expiresAt: number } | null;
let cachedToken: CachedToken = null;

function base64url(input: Buffer | string) {
  const data = typeof input === "string" ? Buffer.from(input) : input;
  return data
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getPrivateKey() {
  if (!rawPrivateKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set");
  }
  return rawPrivateKey.replace(/\\n/g, "\n");
}

async function getAccessToken() {
  if (!clientEmail) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL is not set");
  }

  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.accessToken;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const unsignedJwt = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload)
  )}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  const signature = signer.sign(getPrivateKey(), "base64");
  const jwt = `${unsignedJwt}.${base64url(Buffer.from(signature, "base64"))}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch Google access token: ${text}`);
  }

  const token = await response.json();
  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : 3600;

  cachedToken = {
    accessToken: token.access_token,
    expiresAt: now + expiresIn,
  };

  return cachedToken.accessToken;
}

async function sheetsFetch<T>(path: string, init: RequestInit): Promise<T> {
  if (!sheetId) {
    throw new Error("GOOGLE_SHEET_ID is not set");
  }

  const token = await getAccessToken();
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets API error (${path}): ${text}`);
  }

  return (await response.json()) as T;
}

async function appendRow(range: string, values: (string | number)[]) {
  await sheetsFetch<{ updates: unknown }>(
    `values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      body: JSON.stringify({ values: [values] }),
    }
  );
}

async function getRange(range: string) {
  const data = await sheetsFetch<{ values?: string[][] }>(
    `values/${encodeURIComponent(range)}`
  );
  return data.values || [];
}

async function getRangeFromSheet(sheet: string, range: string) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheet}/values/${encodeURIComponent(
      range
    )}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets API error (${range}): ${text}`);
  }

  const data = (await response.json()) as { values?: string[][] };
  return data.values || [];
}

async function appendRowToSpreadsheet(
  spreadsheetId: string,
  range: string,
  values: (string | number)[]
) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      range
    )}:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [values] }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets append error (${range}): ${text}`);
  }
}

async function updateRowInSpreadsheet(
  spreadsheetId: string,
  range: string,
  values: (string | number)[]
) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      range
    )}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [values] }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets update error (${range}): ${text}`);
  }
}

async function getSheetIdByTitle(spreadsheetId: string, title: string) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets metadata error: ${text}`);
  }

  const data = (await response.json()) as {
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
  };

  const match = data.sheets?.find((sheet) => sheet.properties?.title === title);
  if (!match || typeof match.properties?.sheetId !== "number") {
    throw new Error(`Sheet ${title} not found`);
  }
  return match.properties.sheetId;
}

export async function saveOTP(phone: string, otp: string) {
  await appendRow(OTP_RANGE, [phone, otp, ts()]);
}

export async function saveUserRequest(params: {
  category: string;
  area: string;
  time?: string;
  details?: string;
  createdAt?: string;
}) {
  const taskId = crypto.randomUUID();
  const timestamp = params.createdAt || new Date().toISOString();
  await appendRow(USER_REQUESTS_RANGE, [
    taskId,
    "",
    params.category,
    params.area,
    params.details || "",
    timestamp,
  ]);
}


export async function savePendingCategory(params: {
  category: string;
  area: string;
  details: string;
}) {
  const timestamp = new Date().toISOString();
  await appendRow(PENDING_NEW_CATEGORIES_RANGE, [
    timestamp,
    params.category,
    params.area,
    params.details,
  ]);
}

export async function verifyOTP(phone: string, otp: string) {
  const rows = await getRange(OTP_RANGE);
  return rows.some(([p, o]) => p === phone && o === otp);
}

export async function phoneExistsInProviders(phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;

  const rows = await getRange(PROVIDERS_RANGE);
  return rows.some((row) => normalizePhone(row[1] || "") === normalized);
}

export async function phoneExistsInReceivers(phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;

  const rows = await getRange(RECEIVERS_RANGE);
  return rows.some((row) => normalizePhone(row[1] || "") === normalized);
}

type RegisterUserInput = {
  name: string;
  phone: string;
  role: string;
  categories: string[];
  areas: string[];
};

export async function registerUser({
  name,
  phone,
  role,
  categories,
  areas,
}: RegisterUserInput) {
  await appendRow(USERS_RANGE, [
    name,
    phone,
    role,
    categories.join(", "),
    areas.join(", "),
    "YES",
    ts(),
  ]);
}

export async function saveProviderRegistration(params: {
  name: string;
  phone: string;
  category: string;
  area: string;
}) {
  const normalizedPhone = normalizePhone(params.phone);
  if (!normalizedPhone) {
    throw new Error("Invalid provider phone");
  }

  await appendRow(PROVIDERS_RANGE, [
    params.name,
    normalizedPhone,
    "provider",
    params.category,
    params.area,
    "ACTIVE",
    ts(),
  ]);
}

export async function saveReceiverRegistration(params: {
  name: string;
  phone: string;
  area?: string;
}) {
  const normalizedPhone = normalizePhone(params.phone);
  if (!normalizedPhone) {
    throw new Error("Invalid receiver phone");
  }

  await appendRow(RECEIVERS_RANGE, [
    params.name,
    normalizedPhone,
    params.area || "",
    ts(),
  ]);
}

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function capitalizeWords(str: string) {
  return str
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

type ProviderMatch = { providerId: string; phone: string; name: string };

export async function findProvidersByCategoryAndArea(
  category: string,
  area: string
): Promise<ProviderMatch[]> {
  const rows = await getRange(PROVIDERS_RANGE);
  const matches: ProviderMatch[] = [];

  const cat = capitalizeWords(category);
  const ar = capitalizeWords(area);
  const targetCategory = cat.toLowerCase();
  const targetArea = ar.toLowerCase();

  rows.forEach((row) => {
    const [name, phone, role, categories, areas] = row;
    if (!name || !phone || !role) return;
    if (role.toLowerCase() !== "provider") return;

    const categoryList = parseList(categories || "").map((c) => c.toLowerCase());
    const areaList = parseList(areas || "").map((a) => a.toLowerCase());

    if (
      categoryList.includes(targetCategory) &&
      areaList.includes(targetArea)
    ) {
      matches.push({ providerId: phone, phone, name });
    }
  });

  return matches;
}

export async function saveTaskRow({
  taskId,
  userPhone,
  category,
  when,
  area,
}: {
  taskId: string;
  userPhone: string;
  category: string;
  when: string;
  area: string;
}) {
  await appendRow(TASKS_RANGE, [taskId, userPhone, category, when, area, ts()]);
}

export async function saveTaskProviderRow({
  taskId,
  providerId,
  providerPhone,
}: {
  taskId: string;
  providerId: string;
  providerPhone: string;
}) {
  await appendRow(TASK_PROVIDERS_RANGE, [taskId, providerId, providerPhone, ts()]);
}

export async function createChatRoom(params: {
  taskId: string;
  userPhone: string;
  providerPhone: string;
}): Promise<{ roomId: string; expiresAt: string }> {
  const { taskId, userPhone, providerPhone } = params;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const roomId = `${taskId}-${providerPhone}`;

  await appendRow(CHAT_ROOMS_RANGE, [
    roomId,
    taskId,
    userPhone,
    providerPhone,
    "ACTIVE",
    now.toISOString(),
    expiresAt,
  ]);

  return { roomId, expiresAt };
}

export async function getTaskById(taskId: string): Promise<{
  taskId: string;
  userPhone: string;
  category: string;
  when: string;
  area: string;
} | null> {
  const rows = await getRange(TASKS_RANGE);
  for (const row of rows) {
    const [id, userPhone, category, when, area] = row;
    if (id === taskId) {
      return { taskId: id, userPhone, category, when, area };
    }
  }
  return null;
}

export async function getChatRoom(roomId: string): Promise<{
  roomId: string;
  taskId: string;
  userPhone: string;
  providerPhone: string;
  status: string;
  createdAt: string;
  expiresAt: string;
} | null> {
  const rows = await getRange(CHAT_ROOMS_RANGE);
  for (const row of rows) {
    const [id, taskId, userPhone, providerPhone, status, createdAt, expiresAt] = row;
    if (id === roomId) {
      return {
        roomId: id,
        taskId,
        userPhone,
        providerPhone,
        status: status || "",
        createdAt,
        expiresAt,
      };
    }
  }
  return null;
}

export async function addMessage(params: {
  roomId: string;
  sender: string;
  message: string;
}) {
  const { roomId, sender, message } = params;
  await appendRow(MESSAGES_RANGE, [roomId, sender, message, ts()]);
}

export async function getMessages(roomId: string) {
  const rows = await getRange(MESSAGES_RANGE);
  const filtered = rows
    .filter((row) => row[0] === roomId)
    .map(([id, sender, message, timestamp]) => ({
      roomId: id,
      sender,
      message,
      timestamp,
    }));

  return filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export async function getReview(roomId: string, reviewerPhone: string) {
  const rows = await getRange(REVIEWS_RANGE);
  for (const row of rows) {
    const [rRoomId, rPhone, rRole, rating, reviewText, timestamp] = row;
    if (rRoomId === roomId && rPhone === reviewerPhone) {
      return {
        roomId: rRoomId,
        reviewerPhone: rPhone,
        reviewerRole: rRole,
        rating,
        reviewText,
        timestamp,
      };
    }
  }
  return null;
}

export async function saveReview(params: {
  roomId: string;
  reviewerPhone: string;
  reviewerRole: string;
  rating: number;
  reviewText: string;
}): Promise<{ duplicate: boolean }> {
  const existing = await getReview(params.roomId, params.reviewerPhone);
  if (existing) {
    return { duplicate: true };
  }

  await appendRow(REVIEWS_RANGE, [
    params.roomId,
    params.reviewerPhone,
    params.reviewerRole,
    params.rating,
    params.reviewText,
    ts(),
  ]);

  return { duplicate: false };
}

export async function getAdminByPhone(phone: string) {
  if (!teamRolesSheetId) {
    throw new Error("TEAM_ROLES_SHEET_ID is not set");
  }

  const rows = await getRangeFromSheet(teamRolesSheetId, TEAM_ROLES_RANGE);
  for (const row of rows) {
    const [name, phoneCell, role, permissions] = row;
    if (phoneCell === phone) {
      return {
        name,
        phone: phoneCell,
        role,
        permissions: parseList(permissions || ""),
      };
    }
  }
  return null;
}

// Admin stats helpers
export async function getTotalTasks() {
  const rows = await getRange(TASKS_RANGE);
  return rows.length;
}

export async function getTotalProviderResponses() {
  const rows = await getRange(TASK_PROVIDERS_RANGE);
  return rows.length;
}

export async function getActiveChats() {
  const rows = await getRange(CHAT_ROOMS_RANGE);
  return rows.filter((row) => (row[4] || "").toUpperCase() === "ACTIVE").length;
}

export async function getClosedChats() {
  const rows = await getRange(CHAT_ROOMS_RANGE);
  return rows.filter((row) => (row[4] || "").toUpperCase() === "CLOSED").length;
}

export async function getTotalReviews() {
  const rows = await getRange(REVIEWS_RANGE);
  return rows.length;
}

export async function getAdminStats() {
  const [totalTasks, providerResponses, activeChats, closedChats, totalReviews] =
    await Promise.all([
      getTotalTasks(),
      getTotalProviderResponses(),
      getActiveChats(),
      getClosedChats(),
      getTotalReviews(),
    ]);

  return {
    totalTasks,
    providerResponses,
    activeChats,
    closedChats,
    totalReviews,
  };
}

// Admin list helpers
export type AdminTaskRow = {
  taskId: string;
  userPhone: string;
  category: string;
  when: string;
  area: string;
  createdAt: string;
  providerResponses: number;
};

export async function getAllTasksWithStats(): Promise<AdminTaskRow[]> {
  const [tasks, taskProviders] = await Promise.all([
    getRange(TASKS_RANGE),
    getRange(TASK_PROVIDERS_RANGE),
  ]);

  const responseCount = taskProviders.reduce<Record<string, number>>(
    (acc, row) => {
      const taskId = row[0];
      if (taskId) {
        acc[taskId] = (acc[taskId] || 0) + 1;
      }
      return acc;
    },
    {}
  );

  return tasks.map((row) => {
    const [taskId, userPhone, category, when, area, createdAt] = row;
    return {
      taskId,
      userPhone,
      category,
      when,
      area,
      createdAt,
      providerResponses: responseCount[taskId] || 0,
    };
  });
}

export type AdminChatRoomRow = {
  roomId: string;
  taskId: string;
  userPhone: string;
  providerPhone: string;
  status: string;
  createdAt: string;
  expiresAt: string;
};

export async function getAllChatRooms(): Promise<AdminChatRoomRow[]> {
  const rows = await getRange(CHAT_ROOMS_RANGE);
  return rows.map((row) => {
    const [roomId, taskId, userPhone, providerPhone, status, createdAt, expiresAt] = row;
    return {
      roomId,
      taskId,
      userPhone,
      providerPhone,
      status,
      createdAt,
      expiresAt,
    };
  });
}

export type AdminReviewRow = {
  roomId: string;
  reviewerPhone: string;
  reviewerRole: string;
  rating: number;
  reviewText: string;
  timestamp: string;
};

export async function getAllReviews(): Promise<AdminReviewRow[]> {
  const rows = await getRange(REVIEWS_RANGE);
  return rows.map((row) => {
    const [roomId, reviewerPhone, reviewerRole, rating, reviewText, timestamp] = row;
    return {
      roomId,
      reviewerPhone,
      reviewerRole,
      rating: Number(rating) || 0,
      reviewText: reviewText || "",
      timestamp,
    };
  });
}

export type AdminCommunityRow = {
  communityId: string;
  userPhone: string;
  needType: string;
  area: string;
  createdAt: string;
  status: string;
  helpersCount: number;
};

export async function getAllCommunityRequests(): Promise<AdminCommunityRow[]> {
  const [communityRows, helperRows] = await Promise.all([
    getRange(COMMUNITY_RANGE),
    getRange(COMMUNITY_HELPERS_RANGE),
  ]);

  const helperCount = helperRows.reduce<Record<string, number>>((acc, row) => {
    const communityId = row[0];
    if (communityId) {
      acc[communityId] = (acc[communityId] || 0) + 1;
    }
    return acc;
  }, {});

  return communityRows.map((row) => {
    const [communityId, userPhone, needType, area, createdAt, status] = row;
    return {
      communityId,
      userPhone,
      needType,
      area,
      createdAt,
      status,
      helpersCount: helperCount[communityId] || 0,
    };
  });
}

export async function getCommunityHelpers(communityId: string) {
  const helpers = await getRange(COMMUNITY_HELPERS_RANGE);
  return helpers
    .filter((row) => row[0] === communityId)
    .map(([id, helperPhone, timestamp]) => ({
      communityId: id,
      helperPhone,
      timestamp,
    }))
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
}

export async function getCommunityById(
  communityId: string
): Promise<{
  communityId: string;
  userPhone: string;
  needType: string;
  area: string;
  createdAt: string;
  status: string;
} | null> {
  const rows = await getRange(COMMUNITY_RANGE);
  for (const row of rows) {
    const [id, userPhone, needType, area, createdAt, status] = row;
    if (id === communityId) {
      return { communityId: id, userPhone, needType, area, createdAt, status };
    }
  }
  return null;
}

export async function resolveCommunityRequest(communityId: string): Promise<void> {
  if (!sheetId) {
    throw new Error("GOOGLE_SHEET_ID is not set");
  }

  const token = await getAccessToken();
  // First read to find row index
  const rows = await getRange(COMMUNITY_RANGE);
  let rowIndex = -1;
  rows.forEach((row, idx) => {
    if (row[0] === communityId) {
      rowIndex = idx;
    }
  });

  if (rowIndex === -1) {
    throw new Error("Community request not found");
  }

  // Sheets is 1-based and includes header; assuming first row is header.
  const targetRow = rowIndex + 1;
  const updateRange = `Community!F${targetRow}:F${targetRow}`;

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
      updateRange
    )}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        values: [["RESOLVED"]],
      }),
    }
  );
}

export async function getAllTeamMembers() {
  if (!teamRolesSheetId) {
    throw new Error("TEAM_ROLES_SHEET_ID is not set");
  }
  const rows = await getRangeFromSheet(teamRolesSheetId, "TeamRoles!A:F");
  return rows.map((row) => {
    const [name, phone, role, perms, active, timestamp] = row;
    return {
      name,
      phone,
      role,
      permissions: parseList(perms || ""),
      active: String(active || "").toLowerCase() === "true",
      timestamp,
    };
  });
}

export async function addTeamMember(params: {
  name: string;
  phone: string;
  role: string;
  permissions: string[];
}) {
  if (!teamRolesSheetId) {
    throw new Error("TEAM_ROLES_SHEET_ID is not set");
  }

  const existing = await getAllTeamMembers();
  if (existing.some((m) => m.phone === params.phone)) {
    throw new Error("Duplicate phone");
  }

  await appendRowToSpreadsheet(teamRolesSheetId, "TeamRoles!A:F", [
    params.name,
    params.phone,
    params.role,
    params.permissions.join(", "),
    "TRUE",
    ts(),
  ]);
}

export async function updateTeamMember(params: {
  phone: string;
  role: string;
  permissions: string[];
  active: boolean;
}) {
  if (!teamRolesSheetId) {
    throw new Error("TEAM_ROLES_SHEET_ID is not set");
  }

  const rows = await getRangeFromSheet(teamRolesSheetId, "TeamRoles!A:F");
  let rowIndex = -1;
  let name = "";
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][1] === params.phone) {
      rowIndex = i;
      name = rows[i][0];
      break;
    }
  }
  if (rowIndex === -1) {
    throw new Error("Team member not found");
  }

  const targetRow = rowIndex + 1;
  await updateRowInSpreadsheet(teamRolesSheetId, `TeamRoles!A${targetRow}:F${targetRow}`, [
    name,
    params.phone,
    params.role,
    params.permissions.join(", "),
    params.active ? "TRUE" : "FALSE",
    ts(),
  ]);
}

export async function deleteTeamMember(phone: string) {
  if (!teamRolesSheetId) {
    throw new Error("TEAM_ROLES_SHEET_ID is not set");
  }

  const rows = await getRangeFromSheet(teamRolesSheetId, "TeamRoles!A:F");
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][1] === phone) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error("Team member not found");
  }

  const sheetNumericId = await getSheetIdByTitle(teamRolesSheetId, "TeamRoles");
  const token = await getAccessToken();

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${teamRolesSheetId}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: sheetNumericId,
                dimension: "ROWS",
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to delete team member: ${text}`);
  }
}
