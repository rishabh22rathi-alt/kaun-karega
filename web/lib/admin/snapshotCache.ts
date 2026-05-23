import { adminSupabase } from "@/lib/supabase/admin";

// Shared snapshot cache for admin dashboard endpoints. Stage 1 caller
// is /api/admin/provider-stats; subsequent stages share this helper
// verbatim with different cache_keys + ttls.
//
// Two-layer design:
//   L1 — per-instance in-memory Map. Absorbs burst reads (admin
//        clicking tabs in quick succession) and the same key being
//        hit across multiple tabs within ~30 s. Lost on cold start —
//        that's the L2's job.
//   L2 — admin_cached_snapshots row in Supabase. Survives Vercel
//        Lambda cold starts and is shared across instances.
//
// Read path: L1 hit → return; else L2 hit & fresh → return + warm L1;
// else compute → write L2 + L1 → return.
//
// Stampede guard: while a key's compute() is in flight, a parallel
// request for the same key awaits the same Promise instead of
// kicking off a duplicate compute. Per-instance only — two Lambdas
// can still recompute the same key once each, which is acceptable
// (admin reads are low concurrency).
//
// Soft-fail policy: every Supabase read/write is wrapped in
// try/catch. A DB failure on cache I/O must NEVER break the
// underlying admin endpoint; the worst case is that we fall back to
// the pre-cache slow path (which is what these endpoints did before
// Stage 1 anyway).

const L1_TTL_MS = 60 * 1000;

export type CacheMetadata = {
  // True when the response is being served from a cached row (L1 or
  // L2). False when the current request did the compute() itself.
  cached: boolean;
  // ISO timestamp of when the cached row was computed.
  last_updated_at: string;
  // ISO timestamp at which the cache entry expires.
  expires_at: string;
  // TTL the row was written with — surfaced so the UI can render
  // "Auto-refreshes every 6 hours" without hard-coding the constant.
  ttl_seconds: number;
  // Always true today — clients can issue ?refresh=1. The field
  // exists so a future read-only / locked-down mode can hide the
  // Refresh button server-side.
  refresh_available: boolean;
  // Admin phone that triggered the most recent compute. Non-null
  // only when the latest refresh was a manual ?refresh=1; auto-on-
  // miss recomputes record null.
  computed_by: string | null;
  // How long the most recent compute() took. Useful for ongoing
  // performance telemetry.
  computed_duration_ms: number | null;
};

export type SnapshotCacheResult<T> = {
  payload: T;
  cache: CacheMetadata;
};

type L1Entry<T> = {
  payload: T;
  expiresAt: number;
  cache: CacheMetadata;
};

type L2Row = {
  cache_key: string;
  payload: unknown;
  computed_at: string;
  expires_at: string;
  ttl_seconds: number;
  computed_by: string | null;
  computed_duration_ms: number | null;
};

const l1 = new Map<string, L1Entry<unknown>>();
// Stampede guard. Promises returned here resolve to a fully-formed
// SnapshotCacheResult so two parallel callers can return the same
// `cache` block without re-computing.
const inFlight = new Map<string, Promise<SnapshotCacheResult<unknown>>>();

function nowIso(): string {
  return new Date().toISOString();
}

function isExpiredIso(isoTimestamp: string): boolean {
  // Defensive: a malformed timestamp parses as NaN — treat as expired
  // so the helper recomputes rather than serving a row it can't trust.
  const t = Date.parse(isoTimestamp);
  if (Number.isNaN(t)) return true;
  return t <= Date.now();
}

function readFromL1<T>(key: string): SnapshotCacheResult<T> | null {
  const entry = l1.get(key) as L1Entry<T> | undefined;
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    l1.delete(key);
    return null;
  }
  // L1 entries are clones of what L2 returned, so the cached.cached
  // flag is already true; we just hand the same metadata back.
  return { payload: entry.payload, cache: entry.cache };
}

function writeToL1<T>(key: string, result: SnapshotCacheResult<T>): void {
  // L1 TTL is the smaller of (1 minute, L2 expires_at). Once L2 is
  // stale we MUST go back to disk to discover the new computed_at.
  const l2ExpiresMs = Date.parse(result.cache.expires_at);
  const horizonMs = Math.min(
    Date.now() + L1_TTL_MS,
    Number.isNaN(l2ExpiresMs) ? Date.now() + L1_TTL_MS : l2ExpiresMs
  );
  l1.set(key, {
    payload: result.payload,
    expiresAt: horizonMs,
    cache: result.cache,
  });
}

async function readFromL2<T>(
  key: string
): Promise<SnapshotCacheResult<T> | null> {
  try {
    const { data, error } = await adminSupabase
      .from("admin_cached_snapshots")
      .select(
        "cache_key, payload, computed_at, expires_at, ttl_seconds, computed_by, computed_duration_ms"
      )
      .eq("cache_key", key)
      .maybeSingle();
    if (error) {
      console.warn(
        `[admin-perf] snapshotCache L2 read error key=${key}: ${error.message}`
      );
      return null;
    }
    if (!data) return null;
    const row = data as L2Row;
    if (isExpiredIso(row.expires_at)) return null;
    return {
      payload: row.payload as T,
      cache: {
        cached: true,
        last_updated_at: row.computed_at,
        expires_at: row.expires_at,
        ttl_seconds: row.ttl_seconds,
        refresh_available: true,
        computed_by: row.computed_by,
        computed_duration_ms: row.computed_duration_ms,
      },
    };
  } catch (err) {
    // Network/JSON failure — treat as a miss. Calling endpoint will
    // recompute (slow but correct) rather than 500.
    console.warn(
      `[admin-perf] snapshotCache L2 read exception key=${key}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function writeToL2(
  key: string,
  payload: unknown,
  computedAt: string,
  expiresAt: string,
  ttlSeconds: number,
  computedBy: string | null,
  computedDurationMs: number
): Promise<void> {
  try {
    const { error } = await adminSupabase
      .from("admin_cached_snapshots")
      .upsert(
        {
          cache_key: key,
          payload: payload as Record<string, unknown>,
          computed_at: computedAt,
          expires_at: expiresAt,
          ttl_seconds: ttlSeconds,
          computed_by: computedBy,
          computed_duration_ms: computedDurationMs,
        },
        { onConflict: "cache_key" }
      );
    if (error) {
      console.warn(
        `[admin-perf] snapshotCache L2 write error key=${key}: ${error.message}`
      );
    }
  } catch (err) {
    console.warn(
      `[admin-perf] snapshotCache L2 write exception key=${key}:`,
      err instanceof Error ? err.message : err
    );
  }
}

export type ReadThroughSnapshotCacheOpts<T> = {
  // Identifier for the snapshot. Stable per dataset — never include
  // PII or admin identity here; computed_by holds that.
  key: string;
  // How long the row should be considered fresh after compute. 21600
  // for the 6-hour standard; other endpoints can pass shorter.
  ttlSeconds: number;
  // Force a recompute even if a fresh row exists. Wire from the
  // route's ?refresh=1 flag.
  forceRefresh?: boolean;
  // Admin phone that triggered the request. Recorded in
  // computed_by when this request does the compute itself.
  adminPhone?: string | null;
  // The actual work. The helper times this and records the duration.
  compute: () => Promise<T>;
};

// Standard read-through pattern: L1 → L2 → compute. See header
// comment for the soft-fail policy.
export async function readThroughSnapshotCache<T>(
  opts: ReadThroughSnapshotCacheOpts<T>
): Promise<SnapshotCacheResult<T>> {
  const { key, ttlSeconds, forceRefresh, adminPhone, compute } = opts;

  if (!forceRefresh) {
    const l1Hit = readFromL1<T>(key);
    if (l1Hit) {
      console.log(
        `[admin-perf] snapshotCache L1 hit key=${key} last_updated_at=${l1Hit.cache.last_updated_at}`
      );
      return l1Hit;
    }
    const l2Hit = await readFromL2<T>(key);
    if (l2Hit) {
      console.log(
        `[admin-perf] snapshotCache L2 hit key=${key} last_updated_at=${l2Hit.cache.last_updated_at}`
      );
      writeToL1(key, l2Hit);
      return l2Hit;
    }
  }

  // Stampede guard. Only one compute per key per instance can be in
  // flight; parallel requests await the same Promise. forceRefresh
  // still piggy-backs on an existing in-flight refresh — there's no
  // semantic value in computing twice in a row, and it avoids a
  // dog-pile when many admins click Refresh together.
  const existing = inFlight.get(key) as
    | Promise<SnapshotCacheResult<T>>
    | undefined;
  if (existing) {
    console.log(
      `[admin-perf] snapshotCache stampede coalesced key=${key} (waiting for in-flight compute)`
    );
    return existing;
  }

  const computePromise: Promise<SnapshotCacheResult<T>> = (async () => {
    const tCompute0 = Date.now();
    const payload = await compute();
    const computedDurationMs = Date.now() - tCompute0;
    const computedAt = nowIso();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const computedBy = adminPhone ?? null;

    // Best-effort L2 persistence — fire-and-forget would race with
    // the next request; await keeps it predictable but the
    // soft-fail policy means a DB error here doesn't break this
    // response.
    await writeToL2(
      key,
      payload,
      computedAt,
      expiresAt,
      ttlSeconds,
      computedBy,
      computedDurationMs
    );

    const result: SnapshotCacheResult<T> = {
      payload,
      cache: {
        cached: false,
        last_updated_at: computedAt,
        expires_at: expiresAt,
        ttl_seconds: ttlSeconds,
        refresh_available: true,
        computed_by: computedBy,
        computed_duration_ms: computedDurationMs,
      },
    };
    writeToL1(key, result);
    console.log(
      `[admin-perf] snapshotCache compute key=${key} took ${computedDurationMs}ms forceRefresh=${
        forceRefresh ?? false
      } admin=${computedBy ?? "n/a"}`
    );
    return result;
  })();

  inFlight.set(
    key,
    computePromise as unknown as Promise<SnapshotCacheResult<unknown>>
  );
  try {
    return await computePromise;
  } finally {
    // Always clear the in-flight entry, success or failure, so a
    // throwing compute() doesn't poison the key for future reads.
    inFlight.delete(key);
  }
}

// Mark one or more cache_keys as immediately stale. Mutation routes
// call this after a successful write so the next read recomputes.
// Soft-fail: a DB error here never throws (mutation succeeded; cache
// invalidation must not retroactively fail it). L1 is purged
// synchronously so the calling instance never serves a stale value
// to the same admin who just made the change.
export async function invalidateSnapshots(keys: string[]): Promise<void> {
  if (!Array.isArray(keys) || keys.length === 0) return;
  // L1 purge — synchronous, in-process, can't fail.
  for (const key of keys) {
    l1.delete(key);
  }
  // L2 purge — DELETE rather than expires_at=now() so the next read
  // path takes the standard "no row, compute" branch instead of
  // "expired row, recompute"; both end up at the same place but
  // DELETE keeps the table cleaner and skips a write per mutation.
  try {
    const { error } = await adminSupabase
      .from("admin_cached_snapshots")
      .delete()
      .in("cache_key", keys);
    if (error) {
      console.warn(
        `[admin-perf] snapshotCache invalidate L2 error keys=${keys.join(
          ","
        )}: ${error.message}`
      );
      return;
    }
    console.log(
      `[admin-perf] snapshotCache invalidated keys=${keys.join(",")}`
    );
  } catch (err) {
    console.warn(
      `[admin-perf] snapshotCache invalidate exception keys=${keys.join(
        ","
      )}:`,
      err instanceof Error ? err.message : err
    );
  }
}

// Higher-level wrapper used by simple admin GET routes that want
// cache behaviour without the inline boilerplate. Pass a compute()
// that returns the same shape the old route used to return as
// `data`, and the wrapper builds a `{ ok: true, data, cache }`
// response with proper ?refresh=1 handling and ?refresh-aware
// timing logs. Authentication MUST be performed by the caller
// before this helper is invoked — the wrapper does not check
// admin status, by design (some callers normalise auth before
// computing the cache key, e.g. user-scoped snapshots).
export type CachedAdminRouteOpts<T> = {
  request: Request;
  key: string;
  ttlSeconds: number;
  adminPhone?: string | null;
  // Logging prefix used in [admin-perf] lines (e.g. "users.admin").
  logLabel?: string;
  compute: () => Promise<T>;
};

export async function respondWithCachedAdminPayload<T>(
  opts: CachedAdminRouteOpts<T>
): Promise<Response> {
  const { request, key, ttlSeconds, adminPhone, logLabel, compute } = opts;
  const tRoute0 = Date.now();
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  try {
    const { payload, cache } = await readThroughSnapshotCache<T>({
      key,
      ttlSeconds,
      forceRefresh,
      adminPhone,
      compute,
    });
    console.log(
      `[admin-perf] ${
        logLabel ?? key
      } route TOTAL ${Date.now() - tRoute0}ms (cached=${
        cache.cached
      }, refresh=${forceRefresh})`
    );
    return new Response(
      JSON.stringify({ ok: true, data: payload, cache }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "compute failed";
    console.error(
      `[admin-perf] ${logLabel ?? key} compute failed: ${message}`
    );
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// Test/dev escape hatch: drop both layers for a given key (or all
// keys). Not exported through any API surface; only test code needs
// it. Useful when a fixture seeds an unexpected state into L2.
export function __resetSnapshotCacheForTests(key?: string): void {
  if (key) {
    l1.delete(key);
    inFlight.delete(key);
  } else {
    l1.clear();
    inFlight.clear();
  }
}
