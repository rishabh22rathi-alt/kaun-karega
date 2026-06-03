/**
 * KKTEST reset — guarded purge of all test rows, then optional reseed.
 *
 * Deletes ONLY rows that belong to KKTEST: provider child rows scoped by
 * KKTEST provider ids, and tasks/matches scoped by KKTEST phones or the
 * `KKTEST_%` task-id pattern. Every delete is routed through the guard, so a
 * filter that would touch real data throws instead of running.
 *
 * SAFETY: refuses to run unless [env.assertWritesAllowed] passes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { assertWritesAllowed, makeAdminClient } from "./env";
import { assertKkTestIds, assertKkTestPhones } from "./guard";
import { seedPersonas, type SeedSummary } from "./seedPersonas";
import {
  ALL_KKTEST_PHONES,
  ALL_KKTEST_PROVIDER_IDS,
  ID_PREFIX,
} from "./personas";

export interface ResetSummary {
  ok: boolean;
  reseeded: boolean;
  seed?: SeedSummary;
  error?: string;
}

/** Provider child tables cleared by KKTEST provider id. */
const PROVIDER_CHILD_TABLES = [
  "provider_task_matches",
  "provider_notifications",
  "push_logs",
  "provider_scheduled_areas",
  "provider_plans",
  "provider_areas",
  "provider_services",
  // Revenue rows (Phase 2 packs populate these) — cleared defensively.
  "payment_orders",
  "invoices",
] as const;

async function clearByProviderId(
  c: SupabaseClient,
  table: string,
  ids: readonly string[]
): Promise<void> {
  const { error } = await c.from(table).delete().in("provider_id", ids as string[]);
  // A missing column/table on some envs should not abort the whole reset.
  if (error && !/column .* does not exist|relation .* does not exist/i.test(error.message)) {
    throw new Error(`reset clear ${table} (provider_id) failed: ${error.message}`);
  }
}

export async function resetPersonas(options?: {
  reseed?: boolean;
  client?: SupabaseClient;
}): Promise<ResetSummary> {
  assertWritesAllowed();

  const reseed = options?.reseed ?? true;
  const c = options?.client ?? makeAdminClient();

  const ids = assertKkTestIds(ALL_KKTEST_PROVIDER_IDS);
  const phones = assertKkTestPhones(ALL_KKTEST_PHONES);

  // 1. Tasks + matches by KKTEST phone (posters) and KKTEST_ task-id pattern.
  const taskMatchByTaskPattern = await c
    .from("provider_task_matches")
    .delete()
    .like("task_id", `${ID_PREFIX}%`);
  if (taskMatchByTaskPattern.error) {
    throw new Error(
      `reset provider_task_matches (task pattern) failed: ${taskMatchByTaskPattern.error.message}`
    );
  }

  const tasksByPhone = await c
    .from("tasks")
    .delete()
    .in("phone", phones as string[]);
  if (tasksByPhone.error) {
    throw new Error(`reset tasks (phone) failed: ${tasksByPhone.error.message}`);
  }
  const tasksByPattern = await c
    .from("tasks")
    .delete()
    .like("task_id", `${ID_PREFIX}%`);
  if (tasksByPattern.error) {
    throw new Error(`reset tasks (pattern) failed: ${tasksByPattern.error.message}`);
  }

  // 2. Provider child rows by KKTEST provider id.
  for (const table of PROVIDER_CHILD_TABLES) {
    await clearByProviderId(c, table, ids);
  }

  // 3. Provider rows themselves.
  const provDel = await c.from("providers").delete().in("provider_id", ids as string[]);
  if (provDel.error) {
    throw new Error(`reset providers failed: ${provDel.error.message}`);
  }

  if (!reseed) return { ok: true, reseeded: false };

  const seed = await seedPersonas(c);
  return { ok: true, reseeded: true, seed };
}
