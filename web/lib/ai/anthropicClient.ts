// Thin Anthropic SDK wrapper for the work-intake resolve flow (Phase 2A).
// Server-only. Returns null when no API key is configured so callers can fall
// back to manual instead of throwing.

import Anthropic from "@anthropic-ai/sdk";

let cachedClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

// Cheap/fast model for closed-set classification + a safety label. Override via
// env without code change if eval warrants a stronger model.
export const WORK_INTAKE_MODEL =
  process.env.PROVIDER_WORK_INTAKE_MODEL || "claude-haiku-4-5";

// Hard per-request timeout (ms). The SDK aborts the request at this bound.
export const WORK_INTAKE_TIMEOUT_MS = 7000;

// Small output — the response is a single structured tool call.
export const WORK_INTAKE_MAX_TOKENS = 400;
