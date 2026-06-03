/**
 * Kaun Karega — canonical KKTEST personas (single source of truth).
 *
 * EVERY test pack, seeder, and reset routine imports identities from here.
 * Nothing in this file touches the database; it only declares WHO the
 * fixed test actors are. The seeder ([seedPersonas.ts]) resolves the
 * abstract `regionIntent` against the live JOD region catalog at runtime,
 * so renaming a region in production never breaks these definitions.
 *
 * Hard invariants (enforced by [guard.ts]):
 *   - Every provider/admin id starts with ID_PREFIX ("KKTEST_").
 *   - Every persona phone is inside PHONE_BLOCK (9999990000–9999990999).
 * The seeder/reset framework will REFUSE to write a row that violates
 * either rule, so KKTEST tooling can never mutate a real provider/user.
 */

export const ID_PREFIX = "KKTEST_";

/** Reserved phone block. No real user/provider is ever issued a number here. */
export const PHONE_BLOCK = { min: 9_999_990_000, max: 9_999_990_999 } as const;

/** Default city for all KKTEST personas. */
export const KKTEST_CITY_CODE = "JOD";

/**
 * Isolation category. Unique to KKTEST so matching specs that register
 * KKTEST providers under it can never collide with a real provider. The
 * plan-matrix spec already uses this pattern with its own unique category.
 */
export const KKTEST_ISOLATION_CATEGORY = "KKTEST_SERVICE";

/** Atomic, real categories used by user-journey specs (no umbrella tags). */
export const KKTEST_ATOMIC_CATEGORIES = [
  "Electrician",
  "Plumber",
  "DJ",
  "Pandit",
  "Caterer",
] as const;

/**
 * A raw area string that must NEVER resolve to a canonical region. Used by
 * the unknown-area fallback persona/specs.
 */
export const KKTEST_UNKNOWN_AREA = "KKTEST Nowhere Gali (unmapped)";

export type PlanCode = "free" | "regions_5" | "all_jodhpur";

/** How many regions the seeder should attach, resolved against the catalog. */
export type RegionIntent =
  | "first1" // canonical known region only (free cap)
  | "first5" // first five regions (regions_5 cap)
  | "all" // every active JOD region (all_jodhpur)
  | "altRegion"; // a single region distinct from the canonical known one

/** current_period_end seeding state for provider_plans. */
export type PeriodState = "none" | "future" | "past";

export interface KkTestUser {
  /** Stable lookup key used by specs. */
  key: string;
  /** Logical id (not a DB row — users are phone-keyed on tasks). */
  id: string;
  phone: string;
  label: string;
  /** Posting scope this user represents. */
  scope: "region" | "all_jodhpur" | "unknown_area";
  /** Region intent for the user's home area (resolved at runtime). */
  regionIntent: RegionIntent | "none";
  notes: string;
}

export interface KkTestProvider {
  key: string;
  id: string;
  phone: string;
  fullName: string;
  planCode: PlanCode;
  maxRegions: number;
  regionIntent: RegionIntent;
  periodState: PeriodState;
  verified: "yes" | "no";
  status: "active" | "pending" | "blocked";
  scheduledPlanCode?: PlanCode;
  scheduledMaxRegions?: number;
  notes: string;
}

export interface KkTestAdmin {
  key: string;
  id: string;
  phone: string;
  name: string;
  role: string;
  permissions: string[];
}

// ─── Users (phone-keyed posters; no provider row) ────────────────────────────
export const KKTEST_USERS: readonly KkTestUser[] = [
  {
    key: "USER_CORE",
    id: "KKTEST_USER_CORE",
    phone: "9999990001",
    label: "KKTEST User Core",
    scope: "region",
    regionIntent: "first1",
    notes: "Happy-path poster in the canonical known region (JOD-01).",
  },
  {
    key: "USER_ALT",
    id: "KKTEST_USER_ALT",
    phone: "9999990002",
    label: "KKTEST User Alt",
    scope: "region",
    regionIntent: "altRegion",
    notes: "Posts in a different region — wrong-region isolation checks.",
  },
  {
    key: "USER_UNKNOWN",
    id: "KKTEST_USER_UNKNOWN",
    phone: "9999990003",
    label: "KKTEST User Unknown",
    scope: "unknown_area",
    regionIntent: "none",
    notes: "Posts with an unmapped area string — fallback path.",
  },
  {
    key: "USER_ALLCITY",
    id: "KKTEST_USER_ALLCITY",
    phone: "9999990004",
    label: "KKTEST User AllCity",
    scope: "all_jodhpur",
    regionIntent: "none",
    notes: "Posts an All-Jodhpur (city-wide) request.",
  },
] as const;

// ─── Providers (real DB rows seeded across all plan tiers) ───────────────────
export const KKTEST_PROVIDERS: readonly KkTestProvider[] = [
  {
    key: "PROV_FREE",
    id: "KKTEST_PROV_FREE",
    phone: "9999990101",
    fullName: "KKTEST Provider Free",
    planCode: "free",
    maxRegions: 1,
    regionIntent: "first1",
    periodState: "none",
    verified: "yes",
    status: "active",
    notes: "Free tier — exactly 1 active region, lowest listing priority.",
  },
  {
    key: "PROV_R5",
    id: "KKTEST_PROV_R5",
    phone: "9999990102",
    fullName: "KKTEST Provider R5",
    planCode: "regions_5",
    maxRegions: 5,
    regionIntent: "first5",
    periodState: "future",
    verified: "yes",
    status: "active",
    notes: "₹31 plan — up to 5 active regions, mid listing priority.",
  },
  {
    key: "PROV_AJ",
    id: "KKTEST_PROV_AJ",
    phone: "9999990103",
    fullName: "KKTEST Provider AllJodhpur",
    planCode: "all_jodhpur",
    maxRegions: 99,
    regionIntent: "all",
    periodState: "future",
    verified: "yes",
    status: "active",
    notes: "₹101 plan — city-wide, top listing priority.",
  },
  {
    key: "PROV_AJ_EXPIRED",
    id: "KKTEST_PROV_AJ_EXPIRED",
    phone: "9999990104",
    fullName: "KKTEST Provider AllJodhpur Expired",
    planCode: "all_jodhpur",
    maxRegions: 99,
    regionIntent: "all",
    periodState: "past",
    verified: "yes",
    status: "active",
    notes:
      "Expired all_jodhpur — deliberate expiry drift. Must NEVER match city-wide.",
  },
  {
    key: "PROV_PENDING",
    id: "KKTEST_PROV_PENDING",
    phone: "9999990105",
    fullName: "KKTEST Provider Pending",
    planCode: "free",
    maxRegions: 1,
    regionIntent: "first1",
    periodState: "none",
    verified: "no",
    status: "pending",
    notes: "Pending admin approval — must be excluded from matching.",
  },
  {
    key: "PROV_BLOCKED",
    id: "KKTEST_PROV_BLOCKED",
    phone: "9999990106",
    fullName: "KKTEST Provider Blocked",
    planCode: "regions_5",
    maxRegions: 5,
    regionIntent: "first1",
    periodState: "future",
    verified: "yes",
    status: "blocked",
    notes: "Blocked provider — must be excluded from matching/listing.",
  },
  {
    key: "PROV_SCHEDULED",
    id: "KKTEST_PROV_SCHEDULED",
    phone: "9999990107",
    fullName: "KKTEST Provider Scheduled",
    planCode: "all_jodhpur",
    maxRegions: 99,
    regionIntent: "all",
    periodState: "future",
    verified: "yes",
    status: "active",
    scheduledPlanCode: "regions_5",
    scheduledMaxRegions: 5,
    notes: "Active all_jodhpur with a scheduled downgrade to regions_5.",
  },
] as const;

// ─── Admin ───────────────────────────────────────────────────────────────────
export const KKTEST_ADMIN: KkTestAdmin = {
  key: "ADMIN",
  id: "KKTEST_ADMIN",
  phone: "9999990201",
  name: "KKTEST Admin",
  role: "admin",
  permissions: ["manage_roles", "view_tasks", "view_chats"],
};

/** All persona phones — used by the guard and reset scoping. */
export const ALL_KKTEST_PHONES: readonly string[] = [
  ...KKTEST_USERS.map((u) => u.phone),
  ...KKTEST_PROVIDERS.map((p) => p.phone),
  KKTEST_ADMIN.phone,
];

/** All provider ids — used by reset scoping across provider child tables. */
export const ALL_KKTEST_PROVIDER_IDS: readonly string[] = KKTEST_PROVIDERS.map(
  (p) => p.id
);
