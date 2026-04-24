import { expect, type Page, type TestInfo } from "@playwright/test";

type MatchPattern = RegExp | string;

type ConsoleEntry = {
  type: string;
  text: string;
  location: string;
};

type PageErrorEntry = {
  message: string;
  stack: string;
};

type RequestFailureEntry = {
  method: string;
  url: string;
  errorText: string;
};

type HttpErrorEntry = {
  method: string;
  url: string;
  status: number;
  resourceType: string;
};

function toRegExp(pattern: MatchPattern): RegExp {
  return typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;
}

function matchesAny(value: string, patterns: MatchPattern[]): boolean {
  return patterns.some((pattern) => toRegExp(pattern).test(value));
}

function formatEntries(entries: unknown[]): string {
  if (entries.length === 0) return "none";
  return JSON.stringify(entries, null, 2);
}

export class AuditDiagnostics {
  private readonly consoleEntries: ConsoleEntry[] = [];
  private readonly pageErrors: PageErrorEntry[] = [];
  private readonly requestFailures: RequestFailureEntry[] = [];
  private readonly httpErrors: HttpErrorEntry[] = [];
  private readonly allowedConsolePatterns: MatchPattern[] = [
    /Invalid source map\. Only conformant source maps can be used/i,
  ];
  private readonly allowedPageErrorPatterns: MatchPattern[] = [];
  private readonly allowedRequestFailurePatterns: MatchPattern[] = [
    /GET .*_rsc=.*net::ERR_ABORTED/i,
    /GET .*__nextjs_font\/.*\.woff2.*net::ERR_ABORTED/i,
  ];
  private readonly allowedHttpErrorPatterns: MatchPattern[] = [];

  constructor(page: Page) {
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location();
      this.consoleEntries.push({
        type: message.type(),
        text: message.text(),
        location: `${location.url || "unknown"}:${location.lineNumber ?? 0}`,
      });
    });

    page.on("pageerror", (error) => {
      this.pageErrors.push({
        message: error.message,
        stack: error.stack || "",
      });
    });

    page.on("requestfailed", (request) => {
      this.requestFailures.push({
        method: request.method(),
        url: request.url(),
        errorText: request.failure()?.errorText || "request failed",
      });
    });

    page.on("response", (response) => {
      const resourceType = response.request().resourceType();
      if (!["document", "script", "fetch", "xhr"].includes(resourceType)) {
        return;
      }
      if (response.status() < 400) return;
      this.httpErrors.push({
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
        resourceType,
      });
    });
  }

  allowConsoleError(pattern: MatchPattern): void {
    this.allowedConsolePatterns.push(pattern);
  }

  allowPageError(pattern: MatchPattern): void {
    this.allowedPageErrorPatterns.push(pattern);
  }

  allowRequestFailure(pattern: MatchPattern): void {
    this.allowedRequestFailurePatterns.push(pattern);
  }

  allowHttpError(pattern: MatchPattern): void {
    this.allowedHttpErrorPatterns.push(pattern);
  }

  async attach(testInfo: TestInfo): Promise<void> {
    const payload = {
      consoleEntries: this.consoleEntries,
      pageErrors: this.pageErrors,
      requestFailures: this.requestFailures,
      httpErrors: this.httpErrors,
    };

    await testInfo.attach("audit-diagnostics", {
      body: JSON.stringify(payload, null, 2),
      contentType: "application/json",
    });
  }

  assertClean(label = "Unexpected client-side errors"): void {
    const consoleErrors = this.consoleEntries.filter(
      (entry) => !matchesAny(entry.text, this.allowedConsolePatterns)
    );
    const pageErrors = this.pageErrors.filter(
      (entry) => !matchesAny(entry.message, this.allowedPageErrorPatterns)
    );
    const requestFailures = this.requestFailures.filter(
      (entry) =>
        !matchesAny(`${entry.method} ${entry.url} ${entry.errorText}`, this.allowedRequestFailurePatterns)
    );
    const httpErrors = this.httpErrors.filter(
      (entry) =>
        !matchesAny(`${entry.method} ${entry.url} ${entry.status}`, this.allowedHttpErrorPatterns)
    );

    expect(consoleErrors, `${label}: console errors\n${formatEntries(consoleErrors)}`).toEqual([]);
    expect(pageErrors, `${label}: page errors\n${formatEntries(pageErrors)}`).toEqual([]);
    expect(
      requestFailures,
      `${label}: request failures\n${formatEntries(requestFailures)}`
    ).toEqual([]);
    expect(httpErrors, `${label}: HTTP errors\n${formatEntries(httpErrors)}`).toEqual([]);
  }
}
