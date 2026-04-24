import { test as base, expect } from "@playwright/test";

import { AuditDiagnostics } from "./diagnostics";

type AuditFixtures = {
  diag: AuditDiagnostics;
};

export const test = base.extend<AuditFixtures>({
  diag: async ({ page }, use, testInfo) => {
    const diag = new AuditDiagnostics(page);
    await use(diag);
    await diag.attach(testInfo);
  },
});

export { expect };
