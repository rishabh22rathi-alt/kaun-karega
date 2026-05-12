import type { Page } from "@playwright/test";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import {
  QA_ADMIN_NAME,
  QA_ADMIN_PHONE,
  QA_PROVIDER_PHONE,
  QA_USER_PHONE,
} from "./data";
import { appUrl } from "./runtime";

type AdminSessionData = {
  isAdmin: true;
  name: string;
  role: string;
  permissions: string[];
};

function encodeAuthSession(phone: string): string {
  const session = {
    phone,
    verified: true,
    createdAt: Date.now(),
  };
  const secret = getAuthSessionSecret();
  if (!secret) return encodeURIComponent(JSON.stringify(session));

  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return encodeURIComponent(`${payload}.${signature}`);
}

function getAuthSessionSecret(): string {
  if (process.env.AUTH_SESSION_SECRET) return process.env.AUTH_SESSION_SECRET;

  const envPath = path.resolve(__dirname, "../../.env.local");
  if (!fs.existsSync(envPath)) return "";

  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith("AUTH_SESSION_SECRET="));
  if (!line) return "";

  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

async function setAuthCookie(page: Page, phone: string): Promise<void> {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: encodeAuthSession(phone),
      url: appUrl("/"),
      sameSite: "Lax",
    },
  ]);
}

export async function bootstrapUserSession(
  page: Page,
  phone = QA_USER_PHONE
): Promise<void> {
  await setAuthCookie(page, phone);
}

export async function bootstrapProviderSession(
  page: Page,
  phone = QA_PROVIDER_PHONE
): Promise<void> {
  await setAuthCookie(page, phone);
}

export async function bootstrapAdminSession(
  page: Page,
  {
    phone = QA_ADMIN_PHONE,
    name = QA_ADMIN_NAME,
    role = "admin",
    permissions = ["manage_roles", "view_tasks", "view_chats"],
  }: Partial<AdminSessionData> & { phone?: string } = {}
): Promise<void> {
  await setAuthCookie(page, phone);
  await page.context().addCookies([
    {
      name: "kk_admin",
      value: "1",
      url: appUrl("/"),
      sameSite: "Lax",
    },
  ]);
  await page.addInitScript((sessionData: AdminSessionData) => {
    window.localStorage.setItem("kk_admin_session", JSON.stringify(sessionData));
  }, {
    isAdmin: true,
    name,
    role,
    permissions,
  } satisfies AdminSessionData);
}
