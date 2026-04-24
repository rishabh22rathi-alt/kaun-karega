export const DEFAULT_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

export function appUrl(path = "/"): string {
  return new URL(path, DEFAULT_BASE_URL).toString();
}

export function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return raw === "1" || raw.toLowerCase() === "true";
}
