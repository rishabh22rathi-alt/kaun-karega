import { expect, type Locator, type TestInfo } from "@playwright/test";

export type InteractiveAuditTarget = {
  id: string;
  kind: "button" | "link" | "input" | "tab" | "menu" | "card" | "icon";
  locator: Locator;
  action?: () => Promise<void>;
  detail?: string;
};

export type InteractiveAuditResult = {
  id: string;
  kind: InteractiveAuditTarget["kind"];
  classification: "works" | "disabled" | "conditional" | "broken";
  detail: string;
};

function toMarkdown(results: InteractiveAuditResult[]): string {
  const lines = [
    "# UI Audit Results",
    "",
    "| Target | Kind | Classification | Detail |",
    "| --- | --- | --- | --- |",
  ];

  for (const result of results) {
    lines.push(
      `| ${result.id} | ${result.kind} | ${result.classification} | ${result.detail.replace(/\|/g, "\\|")} |`
    );
  }

  return lines.join("\n");
}

export async function auditInteractiveTargets(
  testInfo: TestInfo,
  targets: InteractiveAuditTarget[]
): Promise<InteractiveAuditResult[]> {
  const results: InteractiveAuditResult[] = [];

  for (const target of targets) {
    const locator = target.locator.first();
    const visible = await locator.isVisible().catch(() => false);

    if (!visible) {
      results.push({
        id: target.id,
        kind: target.kind,
        classification: "conditional",
        detail: target.detail || "Not visible in this scenario.",
      });
      continue;
    }

    const disabled = await locator.isDisabled().catch(() => false);
    if (disabled) {
      results.push({
        id: target.id,
        kind: target.kind,
        classification: "disabled",
        detail: target.detail || "Visible but intentionally disabled.",
      });
      continue;
    }

    if (!target.action) {
      results.push({
        id: target.id,
        kind: target.kind,
        classification: "works",
        detail: target.detail || "Visible and interactive without a custom action.",
      });
      continue;
    }

    try {
      await target.action();
      results.push({
        id: target.id,
        kind: target.kind,
        classification: "works",
        detail: target.detail || "Action completed successfully.",
      });
    } catch (error) {
      results.push({
        id: target.id,
        kind: target.kind,
        classification: "broken",
        detail:
          error instanceof Error
            ? error.message
            : target.detail || "Target action threw unexpectedly.",
      });
    }
  }

  await testInfo.attach("ui-audit-results", {
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(results, null, 2)),
  });
  await testInfo.attach("ui-audit-results-markdown", {
    contentType: "text/markdown",
    body: Buffer.from(toMarkdown(results)),
  });

  return results;
}

export function expectNoBrokenInteractiveTargets(
  results: InteractiveAuditResult[],
  label: string
): void {
  const broken = results.filter((result) => result.classification === "broken");
  expect(
    broken,
    `${label} should not contain broken interactive controls.\n${JSON.stringify(broken, null, 2)}`
  ).toEqual([]);
}
