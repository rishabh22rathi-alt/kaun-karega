// Shared types + tunables for the Provider Work Intake resolve flow (Phase 2A).
// Server-only; nothing here writes to any table.

export type WorkIntakeSafety = "green" | "yellow" | "red";

export type WorkIntakeReason =
  | "OK"
  | "AI_DISABLED"
  | "AI_UNAVAILABLE"
  | "BLOCKED_UNSAFE"
  | "LOW_CONFIDENCE"
  | "NO_INPUT";

export type WorkIntakeMainCategory = {
  /** Server-verified active canonical, or the AI-proposed new name. */
  canonical: string;
  /** SERVER-decided membership in the active categories set. */
  isExisting: boolean;
  /** 0..1, clamped server-side. */
  confidence: number;
};

export type WorkIntakeWorkTag = {
  label: string;
  /** Whether this tag matches an active alias under the chosen canonical. */
  isExistingAlias: boolean;
  /** The chosen main category this tag sits under, or null when none. */
  canonical: string | null;
};

// Full successful resolve payload.
export type WorkIntakeResolveResponse = {
  ok: true;
  safety: WorkIntakeSafety;
  blocked: boolean;
  fallbackToManual: boolean;
  reason: WorkIntakeReason;
  mainCategory: WorkIntakeMainCategory | null;
  workTags: WorkIntakeWorkTag[];
  requiresAdminReview: boolean;
  echo: { text: string };
};

// Non-actionable / error envelope. Kept intentionally small and uniform so the
// client can always fall back to the manual category typeahead.
export type WorkIntakeFallbackResponse = {
  ok: false;
  fallbackToManual: boolean;
  reason: WorkIntakeReason;
  error?: string;
};

// Provider-agnostic shape the model (or the test hook) must produce, BEFORE the
// server applies its authoritative deny-list / closed-set / confidence rules.
export type WorkIntakeAiRaw = {
  /** AI's chosen or proposed canonical, or null when it can't pick one. */
  mainCategory: string | null;
  /** AI's own belief that this is a new/unknown category (advisory only). */
  isNew: boolean;
  confidence: number;
  safety: WorkIntakeSafety;
  workTags: string[];
};

// Tunables.
export const WORK_INTAKE_MAX_TEXT = 500;
export const WORK_INTAKE_CONFIDENCE_FLOOR = 0.55;
export const WORK_INTAKE_MAX_TAGS = 6;
export const WORK_INTAKE_MAX_TAG_LEN = 40;
// Cap aliases per canonical when shown to the model so the system prompt stays
// compact and prompt-cacheable. Picked at the high end of the "low double-digit"
// range — covers the longest real categories (e.g. doctor / hobby classes) with
// the most disambiguating aliases.
export const WORK_INTAKE_MAX_ALIASES_PER_CATEGORY = 15;
