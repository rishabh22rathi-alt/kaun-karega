import type { Page } from "@playwright/test";

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
  return encodeURIComponent(
    JSON.stringify({
      phone,
      verified: true,
      createdAt: Date.now(),
    })
  );
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
