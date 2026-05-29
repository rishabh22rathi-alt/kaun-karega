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
  /** Server-validated set of active canonicals when the provider mentioned
   *  multiple unrelated active categories. Always a closed-set subset; capped
   *  at WORK_INTAKE_MAX_POSSIBLE_CATEGORIES. Only present when the response
   *  asks the UI to disambiguate. */
  possibleCategories?: WorkIntakeMainCategory[];
  /** True when the UI must surface a single-category choice (≥2 active
   *  matches). When true, `mainCategory` is null and `workTags` is empty —
   *  the page should not preselect anything until the provider picks. */
  needsSingleCategoryChoice?: boolean;
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
  /** Multi-category hint: when the provider mentioned several active services,
   *  the model lists each candidate canonical here (advisory). The server is
   *  authoritative — it filters to active members and caps the list. */
  possibleCategories?: string[];
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
// Maximum length the server will accept for an AI-proposed (non-existing)
// category name on yellow. The prompt asks for 1–3 Title-Case words; any
// response over this length is treated as a misbehaving model echoing the
// provider's sentence and is dropped to null. Defines both the route's clamp
// and the prompt's contract — keep them in sync.
export const WORK_INTAKE_PROPOSED_CATEGORY_MAX_LEN = 30;
// Maximum word count for an AI-proposed (non-existing) category name. Pairs
// with the length cap above. ">3 words" is the second sentence signal — short
// names like "Packers & Movers" or "Pet Grooming" stay under both bounds.
export const WORK_INTAKE_PROPOSED_CATEGORY_MAX_WORDS = 3;
// Multi-category choice cap. The choose-category UX has to fit in the panel
// without scrolling and a provider can only register one canonical anyway —
// surface up to 4 strong matches, drop the rest.
export const WORK_INTAKE_MAX_POSSIBLE_CATEGORIES = 4;
