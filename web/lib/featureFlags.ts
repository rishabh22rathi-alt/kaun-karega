// Feature flags for the Provider Work Intake system (Phase 0).
//
// Convention mirrors the existing server-side `X_ENABLED === "true"` pattern
// (see lib/payments/server.ts). Both flags default OFF so this phase ships
// completely inert until a deploy explicitly opts in.

/**
 * CLIENT flag — controls whether the AI work-intake UI (the "What work do you
 * do?" block, "Bol ke samjhaaye" button, animated placeholder textbox) renders
 * on the provider register page.
 *
 * NEXT_PUBLIC_* vars are inlined at build time, so this evaluates to a constant
 * in the browser bundle. That means it is safe to call during render with no
 * hydration mismatch (server and client see the same baked-in value).
 *
 * When false, the provider register page renders exactly as before — the
 * existing manual category typeahead/selection is untouched.
 */
export function isProviderWorkIntakeEnabled(): boolean {
  return (
    String(process.env.NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ENABLED || "")
      .trim()
      .toLowerCase() === "true"
  );
}

/**
 * SERVER flag — placeholder/config ONLY for Phase 0.
 *
 * This gate is intentionally NOT wired to anything yet. No AI call exists in
 * this phase; the resolve API arrives in Phase 2. It is declared now so the
 * config surface is reserved and a later phase can branch on it without a
 * scramble. Do NOT use this to call any AI provider.
 *
 * It reads a non-public env var, so it is only meaningful server-side; in a
 * client bundle the var is undefined and this returns false.
 */
export function isProviderWorkIntakeAiEnabled(): boolean {
  return (
    String(process.env.PROVIDER_WORK_INTAKE_AI_ENABLED || "")
      .trim()
      .toLowerCase() === "true"
  );
}

/**
 * CLIENT flag — Phase 2B "Mera kaam samjho" confirmation trigger + panel.
 *
 * Precedence (intentional): this flag is FORCED OFF when the Phase 1 UI flag
 * (isProviderWorkIntakeEnabled) is OFF. The Phase 2B trigger lives inside the
 * Phase 1 panel and reuses its catQuery surface, so it cannot be meaningfully
 * shown without Phase 1's UI shell. Keeping the precedence here (not at every
 * call site) means a misconfigured deploy (confirm=on, phase1=off) silently
 * behaves as "Phase 1 off" rather than rendering a half-broken panel.
 *
 * NEXT_PUBLIC_* → inlined at build time, safe to call during render.
 */
export function isProviderWorkIntakeConfirmEnabled(): boolean {
  if (!isProviderWorkIntakeEnabled()) return false;
  return (
    String(process.env.NEXT_PUBLIC_PROVIDER_WORK_INTAKE_CONFIRM_ENABLED || "")
      .trim()
      .toLowerCase() === "true"
  );
}

/**
 * CLIENT flag — Voice-first "Apna kaam bol ke samjhaaye" assistant modal.
 *
 * Precedence (intentional): this flag is FORCED OFF when the Phase 1 UI flag
 * is OFF. The assistant button lives inside the Step 2 / Service Categories
 * surface which Phase 1 owns. When this flag is ON, it REPLACES the inline
 * Phase 2B trigger + confirmation panel — the assistant modal is the only
 * AI work-intake surface the provider sees. When OFF, the existing inline
 * Phase 2B UI continues to render under isProviderWorkIntakeConfirmEnabled
 * for QA bisection and rollback.
 *
 * NEXT_PUBLIC_* → inlined at build time, safe to call during render.
 */
export function isProviderWorkIntakeAssistantEnabled(): boolean {
  if (!isProviderWorkIntakeEnabled()) return false;
  return (
    String(process.env.NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ASSISTANT_ENABLED || "")
      .trim()
      .toLowerCase() === "true"
  );
}
