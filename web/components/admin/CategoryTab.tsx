"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, X } from "lucide-react";
import UnreadBadge, { type UnreadIndicator } from "./UnreadBadge";

type CategoryTabProps = {
  // Wired by the dashboard page (see useAdminUnread).
  unread?: UnreadIndicator | null;
  onMarkRead?: () => void;
};

// Window event dispatched by ProvidersTab when admin clicks "Manage
// category" on a drilldown row. Kept in sync with ProvidersTab's
// MANAGE_CATEGORY_EVENT — duplicated as a string (instead of imported)
// to keep CategoryTab free of cross-component imports.
const MANAGE_CATEGORY_EVENT = "kk-admin-manage-category";
// Mirror of ProvidersTab.CATEGORY_CHANGED_EVENT. Dispatched after
// archive / restore success so the Providers tile (which is now gated
// on "has an active approved category") refreshes without forcing the
// admin to close + reopen the section.
const CATEGORY_CHANGED_EVENT = "kk-admin-category-changed";

function dispatchCategoryChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CATEGORY_CHANGED_EVENT));
}
// How long the highlighted row stays ringed before the effect clears
// itself. Matches the spec window (2–4s).
const HIGHLIGHT_DURATION_MS = 3000;
// Visible duration of the "Category not found" banner.
const NOT_FOUND_DURATION_MS = 4000;

type AliasRow = { id: string; alias: string; aliasType: string | null };
type CategoryRow = { name: string; active: boolean; aliases: AliasRow[] };
type CategoryProviderCountRow = { category: string; count: number };
type CategoryBreakdownResponse = {
  byCategory: CategoryProviderCountRow[];
};

type PendingRequest = {
  RequestID: string;
  ProviderName: string;
  ProviderID: string;
  Phone: string;
  RequestedCategory: string;
  Area?: string;
  Status: string;
  CreatedAt: string;
};

// Mirror of /api/admin/aliases?status=pending response shape. Pending
// custom work-tags / aliases live in `category_aliases` with active=false
// and are surfaced here so the admin can approve / reject them from the
// same Pending Admin Approval tab as category requests.
type PendingAliasRequest = {
  alias: string;
  canonicalCategory: string;
  aliasType: string | null;
  active: boolean;
  createdAt: string | null;
  submittedByProviderId: string | null;
  submittedByName: string | null;
  submittedByPhone: string | null;
};

type CategoryArchiveRow = {
  id: string;
  categoryName: string;
  providerCount: number;
  aliasCount: number;
  archivedBy: string | null;
  archivedAt: string;
  status: string;
  reviewedAt: string | null;
};

type ActiveTab = "approved" | "pending" | "archived";

const ARCHIVE_CONFIRM_MESSAGE =
  "This will hide the category from users/providers and move it to archive review. Provider mappings will be kept for review. Continue?";

function getAdminActor(): { name: string; phone: string } {
  if (typeof window === "undefined") return { name: "", phone: "" };
  try {
    const raw = window.localStorage.getItem("kk_admin_session");
    if (!raw) return { name: "", phone: "" };
    const parsed = JSON.parse(raw) as { name?: unknown; phone?: unknown };
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      phone: typeof parsed.phone === "string" ? parsed.phone : "",
    };
  } catch {
    return { name: "", phone: "" };
  }
}

export default function CategoryTab({
  unread,
  onMarkRead,
}: CategoryTabProps = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("approved");
  const markReadFiredRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      markReadFiredRef.current = false;
      return;
    }
    if (markReadFiredRef.current) return;
    markReadFiredRef.current = true;
    onMarkRead?.();
  }, [isOpen, onMarkRead]);

  // Approved tab data
  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  // Bumping this re-runs the categories fetch effect. Using a counter
  // (instead of resetting `categories` to null) is required because the
  // effect's deps don't include `categories` — without this key, calling
  // refreshCategories() would silently no-op and the table would stay stale.
  const [categoriesRefreshKey, setCategoriesRefreshKey] = useState(0);
  // Provider counts per category, keyed by name.trim().toLowerCase() so a
  // case-drifted category row still resolves to its real count. Loaded
  // lazily from provider-stats/by-category — failure to load is non-fatal
  // (column shows "—") so the rename / toggle UX is never blocked.
  const [providerCountsByCategoryKey, setProviderCountsByCategoryKey] =
    useState<Record<string, number> | null>(null);
  const [providerCountsLoaded, setProviderCountsLoaded] = useState(false);

  // Pending tab data
  const [pending, setPending] = useState<PendingRequest[] | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingRefreshKey, setPendingRefreshKey] = useState(0);

  // Pending alias / work-tag submissions — second list rendered under the
  // same Pending Admin Approval tab. Sourced from /api/admin/aliases?
  // status=pending and approved/rejected through the existing POST
  // /api/admin/aliases endpoint. Reuses pendingRefreshKey so any action
  // bumps both fetches together.
  const [pendingAliases, setPendingAliases] = useState<
    PendingAliasRequest[] | null
  >(null);
  const [pendingAliasesError, setPendingAliasesError] = useState<string | null>(
    null
  );

  // Archived tab data — read from /api/admin/categories/archive. A
  // successful archive on the Approved tab bumps both keys so the next
  // switch to Archived is fresh.
  const [archives, setArchives] = useState<CategoryArchiveRow[] | null>(null);
  const [archivesLoading, setArchivesLoading] = useState(false);
  const [archivesError, setArchivesError] = useState<string | null>(null);
  const [archivesRefreshKey, setArchivesRefreshKey] = useState(0);

  // Approved tab UI state
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState<string | null>(null);
  const [editingCategoryDraft, setEditingCategoryDraft] = useState("");
  // Aliases collapsed by default; user expands per row.
  const [expandedAliasFor, setExpandedAliasFor] = useState<Set<string>>(
    new Set()
  );
  // Per-alias inline edit state (one alias at a time).
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [editingAliasDraft, setEditingAliasDraft] = useState("");

  // Per-row inline "+ Add alias / work tag" state. Keyed by category name
  // so only one add-form is open at a time across the whole table.
  const [addingAliasFor, setAddingAliasFor] = useState<string | null>(null);
  const [newAliasDraft, setNewAliasDraft] = useState("");
  const [newAliasType, setNewAliasType] = useState<
    "search" | "local_name" | "work_tag"
  >("search");

  // Pending tab UI state
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);

  // Bridge from ProvidersTab — the normalized category key the admin
  // asked to manage, the inline "not found" message (when the key has
  // no matching approved row), and ref map for scroll-into-view.
  const [highlightCategoryKey, setHighlightCategoryKey] = useState<string | null>(
    null
  );
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);
  const categoryRowRefs = useRef(new Map<string, HTMLTableRowElement>());

  // Action plumbing
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Lazy fetch — approved categories. Refetches whenever
  // categoriesRefreshKey is bumped (after an approve / edit / toggle / etc.)
  // so the live list stays in sync with the DB without page reload.
  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== "approved") return;
    let cancelled = false;
    setCategoriesLoading(true);
    setCategoriesError(null);
    fetch("/api/admin/categories")
      .then((r) => r.json())
      .then((res: { ok?: boolean; categories?: CategoryRow[]; error?: string }) => {
        if (cancelled) return;
        if (res?.ok && Array.isArray(res.categories)) setCategories(res.categories);
        else setCategoriesError(res?.error || "Failed to load categories");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCategoriesError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setCategoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, categoriesRefreshKey]);

  // Lazy fetch — provider counts per approved category. Same lifecycle
  // as the categories fetch: re-runs on tab open or refresh-key bump so
  // counts stay in sync after a rename. Non-fatal — a failed fetch just
  // leaves the column showing "—" without blocking other actions.
  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== "approved") return;
    let cancelled = false;
    fetch("/api/admin/provider-stats/by-category")
      .then((r) => r.json())
      .then(
        (res: {
          ok?: boolean;
          data?: CategoryBreakdownResponse;
          error?: string;
        }) => {
          if (cancelled) return;
          if (res?.ok && res.data && Array.isArray(res.data.byCategory)) {
            const next: Record<string, number> = {};
            for (const row of res.data.byCategory) {
              const key = String(row.category ?? "").trim().toLowerCase();
              if (key) next[key] = Number(row.count) || 0;
            }
            setProviderCountsByCategoryKey(next);
          }
          // Mark "loaded" even on error so the column shows "—" instead
          // of a permanent loading dash. A reload will retry.
          setProviderCountsLoaded(true);
        }
      )
      .catch(() => {
        if (cancelled) return;
        setProviderCountsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, categoriesRefreshKey]);

  // Lazy fetch — pending requests AND pending aliases. Both lists are
  // surfaced under the same Pending Admin Approval tab. They are fetched
  // in parallel so opening the tab pays the network cost once, and the
  // shared pendingRefreshKey re-fires both on approve / reject of either
  // type. The two lists feed two separate render sections so the data
  // never mixes — a category request and a work-tag are different
  // entities even though they share the same admin queue.
  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== "pending") return;
    let cancelled = false;
    setPendingLoading(true);
    setPendingError(null);
    setPendingAliasesError(null);

    const categoryRequestsP = fetch("/api/admin/pending-category-requests")
      .then((r) => r.json())
      .then(
        (res: {
          ok?: boolean;
          categoryApplications?: PendingRequest[];
          error?: string;
        }) => {
          if (cancelled) return;
          if (res?.ok && Array.isArray(res.categoryApplications)) {
            setPending(res.categoryApplications);
          } else {
            setPendingError(res?.error || "Failed to load pending requests");
          }
        }
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        setPendingError(err instanceof Error ? err.message : "Network error");
      });

    const aliasesP = fetch("/api/admin/aliases?status=pending")
      .then((r) => r.json())
      .then(
        (res: {
          ok?: boolean;
          aliases?: PendingAliasRequest[];
          error?: string;
        }) => {
          if (cancelled) return;
          if (res?.ok && Array.isArray(res.aliases)) {
            setPendingAliases(res.aliases);
          } else {
            // Independent error track — a failure here MUST NOT clear
            // or block the category-requests list. They surface
            // separately under the alias section.
            setPendingAliasesError(
              res?.error || "Failed to load pending work terms"
            );
          }
        }
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        setPendingAliasesError(
          err instanceof Error ? err.message : "Network error"
        );
      });

    Promise.allSettled([categoryRequestsP, aliasesP]).finally(() => {
      if (!cancelled) setPendingLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, pendingRefreshKey]);

  // Lazy fetch — archived categories. Same shape as the pending fetch.
  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== "archived") return;
    let cancelled = false;
    setArchivesLoading(true);
    setArchivesError(null);
    fetch("/api/admin/categories/archive?status=all")
      .then((r) => r.json())
      .then(
        (res: {
          ok?: boolean;
          archives?: CategoryArchiveRow[];
          error?: string;
        }) => {
          if (cancelled) return;
          if (res?.ok && Array.isArray(res.archives)) {
            setArchives(res.archives);
          } else {
            setArchivesError(res?.error || "Failed to load archives");
          }
        }
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        setArchivesError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setArchivesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, archivesRefreshKey]);

  // Bridge listener — ProvidersTab dispatches MANAGE_CATEGORY_EVENT when
  // the admin clicks "Manage category". We open the accordion, force the
  // approved tab, and store the normalized key so the highlight effect
  // below can scroll into view once the categories table renders.
  // Re-dispatching for the same key still re-triggers the scroll because
  // we always set a fresh state object via setHighlightCategoryKey(null)
  // first when the keys match.
  useEffect(() => {
    function handle(event: Event) {
      const detail = (event as CustomEvent<{ category?: unknown }>).detail;
      const raw = String(detail?.category ?? "").trim();
      if (!raw) return;
      const key = raw.toLowerCase();
      setIsOpen(true);
      setActiveTab("approved");
      setBridgeMessage(null);
      // Force a state change even if the key is unchanged, so back-to-back
      // clicks on the same category re-scroll/re-highlight.
      setHighlightCategoryKey(null);
      // Schedule the actual highlight on the next tick so the null→key
      // transition produces a fresh effect run.
      queueMicrotask(() => setHighlightCategoryKey(key));
    }
    window.addEventListener(MANAGE_CATEGORY_EVENT, handle);
    return () => window.removeEventListener(MANAGE_CATEGORY_EVENT, handle);
  }, []);

  // After categories load (or change), match the requested key, scroll
  // it into view, and auto-clear the highlight after HIGHLIGHT_DURATION_MS.
  // If no match exists, surface the not-found banner instead.
  useEffect(() => {
    if (!highlightCategoryKey) return;
    if (categoriesLoading) return;
    if (!categories) return;
    const match = categories.find(
      (cat) => cat.name.trim().toLowerCase() === highlightCategoryKey
    );
    if (!match) {
      setBridgeMessage("Category not found in approved list.");
      const t = setTimeout(() => {
        setBridgeMessage(null);
        setHighlightCategoryKey(null);
      }, NOT_FOUND_DURATION_MS);
      return () => clearTimeout(t);
    }
    const node = categoryRowRefs.current.get(highlightCategoryKey);
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const t = setTimeout(
      () => setHighlightCategoryKey(null),
      HIGHLIGHT_DURATION_MS
    );
    return () => clearTimeout(t);
  }, [highlightCategoryKey, categories, categoriesLoading]);

  const refreshCategories = () => {
    setCategoriesRefreshKey((prev) => prev + 1);
  };
  const refreshPending = () => {
    setPendingRefreshKey((prev) => prev + 1);
  };
  const refreshArchives = () => {
    setArchivesRefreshKey((prev) => prev + 1);
  };

  const callKk = async (
    actionKey: string,
    body: Record<string, unknown>,
    onSuccess: () => void
  ) => {
    setActionInProgress(actionKey);
    setActionError(null);
    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        setActionError(json?.error || `Action failed (${res.status})`);
        return;
      }
      onSuccess();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleAddCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    void callKk(
      `add::${name}`,
      { action: "add_category", categoryName: name },
      () => {
        setNewCategoryName("");
        refreshCategories();
      }
    );
  };

  const handleSaveEdit = (oldName: string) => {
    const newName = editingCategoryDraft.trim();
    if (!newName || newName === oldName) {
      setEditingCategoryName(null);
      setEditingCategoryDraft("");
      return;
    }
    void callKk(
      `edit::${oldName}`,
      { action: "edit_category", oldName, newName },
      () => {
        setEditingCategoryName(null);
        setEditingCategoryDraft("");
        refreshCategories();
      }
    );
  };

  const handleToggleActive = (name: string, currentlyActive: boolean) => {
    void callKk(
      `toggle::${name}`,
      {
        action: "toggle_category",
        categoryName: name,
        active: currentlyActive ? "no" : "yes",
      },
      () => refreshCategories()
    );
  };

  const handleArchive = async (name: string) => {
    // Hard confirm gate — archive is reversible but the snapshot fan-out
    // is expensive and the side effects (suggestions disappearing) are
    // user-visible immediately. Mirror confirm copy verbatim with the
    // spec so admins reading the prompt see the exact contract.
    if (
      typeof window !== "undefined" &&
      !window.confirm(ARCHIVE_CONFIRM_MESSAGE)
    ) {
      return;
    }
    const actionKey = `archive::${name}`;
    setActionInProgress(actionKey);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/categories/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryName: name }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        setActionError(json?.error || `Archive failed (${res.status})`);
        return;
      }
      refreshCategories();
      refreshArchives();
      dispatchCategoryChanged();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRestoreArchive = async (archiveId: string) => {
    const actionKey = `restore::${archiveId}`;
    setActionInProgress(actionKey);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/categories/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archiveId }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        setActionError(json?.error || `Restore failed (${res.status})`);
        return;
      }
      refreshArchives();
      refreshCategories();
      dispatchCategoryChanged();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleSaveAlias = async (aliasId: string, originalAlias: string) => {
    const newAlias = editingAliasDraft.trim();
    if (!newAlias || newAlias === originalAlias) {
      setEditingAliasId(null);
      setEditingAliasDraft("");
      return;
    }
    const actionKey = `editAlias::${aliasId}`;
    setActionInProgress(actionKey);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/aliases/${encodeURIComponent(aliasId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newAlias }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        setActionError(json?.error || `Update failed (${res.status})`);
        return;
      }
      setEditingAliasId(null);
      setEditingAliasDraft("");
      refreshCategories();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStartAddAlias = (categoryName: string) => {
    setAddingAliasFor(categoryName);
    setNewAliasDraft("");
    setNewAliasType("search");
    setActionError(null);
  };

  const handleCancelAddAlias = () => {
    setAddingAliasFor(null);
    setNewAliasDraft("");
    setNewAliasType("search");
  };

  const handleSaveNewAlias = async (categoryName: string) => {
    const aliasText = newAliasDraft.trim();
    if (!aliasText) return;
    const actionKey = `addAlias::${categoryName}`;
    setActionInProgress(actionKey);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          alias: aliasText,
          canonicalCategory: categoryName,
          aliasType: newAliasType,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        setActionError(json?.error || `Add failed (${res.status})`);
        return;
      }
      handleCancelAddAlias();
      refreshCategories();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRemoveAlias = async (aliasId: string, aliasText: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Remove alias "${aliasText}"? This cannot be undone.`)
    ) {
      return;
    }
    const actionKey = `removeAlias::${aliasId}`;
    setActionInProgress(actionKey);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/aliases/${encodeURIComponent(aliasId)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        setActionError(json?.error || `Remove failed (${res.status})`);
        return;
      }
      refreshCategories();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleApprove = (request: PendingRequest) => {
    const actor = getAdminActor();
    void callKk(
      `approve::${request.RequestID}`,
      {
        action: "approve_category_request",
        requestId: request.RequestID,
        categoryName: request.RequestedCategory,
        AdminActorName: actor.name,
        AdminActorPhone: actor.phone,
        adminActionReason: "",
      },
      () => {
        refreshPending();
        refreshCategories();
        setExpandedRequest(null);
      }
    );
  };

  const handleReject = (request: PendingRequest) => {
    // Fixed reason — admin doesn't get prompted. window.prompt() isn't
    // available in some embedded environments and used to crash here.
    // The audit row still records who rejected and when.
    const actor = getAdminActor();
    void callKk(
      `reject::${request.RequestID}`,
      {
        action: "reject_category_request",
        requestId: request.RequestID,
        reason: "Rejected by admin",
        AdminActorName: actor.name,
        AdminActorPhone: actor.phone,
      },
      () => {
        refreshPending();
        setExpandedRequest(null);
      }
    );
  };

  // Approve / reject for pending custom work-tags. Both flow through the
  // existing /api/admin/aliases POST endpoint, which is already gated by
  // requireAdminSession and which we kept untouched in this slice. On
  // success we bump pendingRefreshKey so BOTH the category-request list
  // and the alias list refetch — and the approved alias also disappears
  // from the pending list because the endpoint flips active=true.
  const handleAliasApprove = async (alias: string) => {
    const actionKey = `approveAlias::${alias.toLowerCase()}`;
    setActionInProgress(actionKey);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", alias }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        setActionError(json?.error || `Approve failed (${res.status})`);
        return;
      }
      refreshPending();
      refreshCategories();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleAliasReject = async (alias: string) => {
    const actionKey = `rejectAlias::${alias.toLowerCase()}`;
    setActionInProgress(actionKey);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          alias,
          reason: "Rejected by admin",
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        setActionError(json?.error || `Reject failed (${res.status})`);
        return;
      }
      refreshPending();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionInProgress(null);
    }
  };

  // Header pending count includes BOTH lists so the admin sees a single
  // accurate number on the section chip. Category requests count only the
  // ones with Status="pending" (the list also carries rejected rows for
  // history). Aliases are always pending by definition of the endpoint
  // filter (`?status=pending` → active=false rows only).
  const pendingCategoryCount =
    pending?.filter((r) => String(r.Status).toLowerCase() === "pending").length ?? 0;
  const pendingAliasCount = pendingAliases?.length ?? 0;
  const pendingOpenCount = pendingCategoryCount + pendingAliasCount;
  const summary = `Category approvals and alias/work-tag management${
    pendingOpenCount > 0 ? ` · ${pendingOpenCount} pending` : ""
  }`;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="category-tab-body"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="flex items-center text-base font-semibold text-slate-900">
            Category
            <UnreadBadge unread={unread} testId="category-unread-badge" />
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{summary}</p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {isOpen && (
        <div id="category-tab-body" className="border-t border-slate-200 px-5 py-5">
          <div className="flex gap-2 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab("approved")}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition ${
                activeTab === "approved"
                  ? "border-[#003d20] text-[#003d20]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Approved Categories
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("pending")}
              data-testid="kk-admin-category-pending-tab"
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition ${
                activeTab === "pending"
                  ? "border-[#003d20] text-[#003d20]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Pending Admin Approval
              {pendingOpenCount > 0 ? (
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700">
                  {pendingOpenCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("archived")}
              data-testid="kk-admin-category-archived-tab"
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition ${
                activeTab === "archived"
                  ? "border-[#003d20] text-[#003d20]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Archived Categories
            </button>
          </div>

          {actionError && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </p>
          )}

          {activeTab === "approved" && (
            <div className="mt-4 space-y-4">
              {bridgeMessage && (
                <p
                  role="status"
                  aria-live="polite"
                  data-testid="category-bridge-message"
                  className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700"
                >
                  {bridgeMessage}
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddCategory();
                  }}
                  placeholder="Add new canonical category…"
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20"
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  disabled={
                    !newCategoryName.trim() ||
                    actionInProgress === `add::${newCategoryName.trim()}`
                  }
                  className="rounded-lg bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a15] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionInProgress === `add::${newCategoryName.trim()}`
                    ? "Adding…"
                    : "Add"}
                </button>
              </div>

              {categoriesLoading && (
                <p className="text-sm text-slate-500">Loading categories…</p>
              )}
              {categoriesError && !categoriesLoading && (
                <p className="text-sm text-red-600">Error: {categoriesError}</p>
              )}
              {categories &&
                !categoriesLoading &&
                !categoriesError &&
                categories.length === 0 && (
                  <p className="text-sm text-slate-500">No categories yet.</p>
                )}

              {categories &&
                !categoriesLoading &&
                !categoriesError &&
                categories.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          <th className="px-3 py-2">Category</th>
                          <th className="px-3 py-2 text-right">Providers</th>
                          <th className="px-3 py-2">Aliases / Work Tags</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categories.map((cat, catIndex) => {
                          const isEditing = editingCategoryName === cat.name;
                          const toggleKey = `toggle::${cat.name}`;
                          const editKey = `edit::${cat.name}`;
                          const providerCountKey = cat.name.trim().toLowerCase();
                          const providerCount =
                            providerCountsByCategoryKey?.[providerCountKey];
                          const isHighlighted =
                            highlightCategoryKey === providerCountKey;
                          return (
                            <tr
                              key={`${cat.name}-${catIndex}`}
                              ref={(node) => {
                                if (node)
                                  categoryRowRefs.current.set(
                                    providerCountKey,
                                    node
                                  );
                                else
                                  categoryRowRefs.current.delete(
                                    providerCountKey
                                  );
                              }}
                              data-testid={`category-row-${providerCountKey}`}
                              data-highlighted={isHighlighted ? "true" : undefined}
                              className={`border-b border-slate-100 align-top last:border-b-0 transition-colors ${
                                isHighlighted
                                  ? "bg-orange-50 ring-2 ring-orange-300"
                                  : ""
                              }`}
                            >
                              <td className="px-3 py-2 font-medium text-slate-800">
                                {isEditing ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={editingCategoryDraft}
                                      onChange={(e) =>
                                        setEditingCategoryDraft(e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          handleSaveEdit(cat.name);
                                        if (e.key === "Escape") {
                                          setEditingCategoryName(null);
                                          setEditingCategoryDraft("");
                                        }
                                      }}
                                      className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#003d20] focus:ring-1 focus:ring-[#003d20]/20"
                                      autoFocus
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEdit(cat.name)}
                                      disabled={actionInProgress === editKey}
                                      className="rounded bg-[#003d20] px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                    >
                                      {actionInProgress === editKey
                                        ? "…"
                                        : "Save"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingCategoryName(null);
                                        setEditingCategoryDraft("");
                                      }}
                                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <span className={cat.active ? "" : "text-slate-400 line-through"}>
                                    {cat.name}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                {providerCount !== undefined ? (
                                  providerCount.toLocaleString()
                                ) : providerCountsLoaded ? (
                                  <span className="text-slate-400">0</span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-slate-700">
                                <div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedAliasFor((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(cat.name)) next.delete(cat.name);
                                        else next.add(cat.name);
                                        return next;
                                      })
                                    }
                                    aria-expanded={expandedAliasFor.has(cat.name)}
                                    className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                  >
                                    {expandedAliasFor.has(cat.name)
                                      ? "Hide"
                                      : "View"}{" "}
                                    aliases / work tags ({cat.aliases.length})
                                  </button>
                                  {expandedAliasFor.has(cat.name) && (
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                      {cat.aliases.length === 0 && (
                                        <span className="text-xs italic text-slate-400">
                                          no aliases yet
                                        </span>
                                      )}
                                      {cat.aliases.map((a, aliasIndex) => {
                                          const isEditingAlias =
                                            editingAliasId === a.id && a.id !== "";
                                          const editKey = `editAlias::${a.id}`;
                                          const removeKey = `removeAlias::${a.id}`;
                                          if (isEditingAlias) {
                                            return (
                                              <div
                                                key={a.id || `${a.alias}-${aliasIndex}`}
                                                className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5"
                                              >
                                                <input
                                                  type="text"
                                                  value={editingAliasDraft}
                                                  onChange={(e) =>
                                                    setEditingAliasDraft(e.target.value)
                                                  }
                                                  onKeyDown={(e) => {
                                                    if (e.key === "Enter")
                                                      void handleSaveAlias(a.id, a.alias);
                                                    if (e.key === "Escape") {
                                                      setEditingAliasId(null);
                                                      setEditingAliasDraft("");
                                                    }
                                                  }}
                                                  className="w-32 bg-transparent text-xs text-slate-900 outline-none"
                                                  autoFocus
                                                />
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void handleSaveAlias(a.id, a.alias)
                                                  }
                                                  disabled={actionInProgress === editKey}
                                                  className="rounded bg-[#003d20] px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
                                                >
                                                  {actionInProgress === editKey ? "…" : "Save"}
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setEditingAliasId(null);
                                                    setEditingAliasDraft("");
                                                  }}
                                                  className="text-[10px] text-slate-500 hover:text-slate-800"
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                            );
                                          }
                                          return (
                                            <span
                                              key={a.id || `${a.alias}-${aliasIndex}`}
                                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700"
                                              title={a.aliasType ?? undefined}
                                            >
                                              {a.alias}
                                              {a.aliasType === "work_tag" ? (
                                                <span className="text-[9px] uppercase text-orange-600">
                                                  tag
                                                </span>
                                              ) : null}
                                              {a.id ? (
                                                <>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setEditingAliasId(a.id);
                                                      setEditingAliasDraft(a.alias);
                                                    }}
                                                    aria-label={`Edit alias ${a.alias}`}
                                                    title="Edit"
                                                    className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-[#003d20]"
                                                  >
                                                    <Pencil className="h-3 w-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      void handleRemoveAlias(a.id, a.alias)
                                                    }
                                                    disabled={actionInProgress === removeKey}
                                                    aria-label={`Remove alias ${a.alias}`}
                                                    title="Remove"
                                                    className="inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-orange-100 hover:text-orange-700 disabled:opacity-50"
                                                  >
                                                    <X className="h-3 w-3" />
                                                  </button>
                                                </>
                                              ) : null}
                                            </span>
                                          );
                                        })}
                                      {addingAliasFor === cat.name ? (
                                        <div className="inline-flex items-center gap-1 rounded-full border border-[#003d20]/40 bg-white px-2 py-0.5">
                                          <input
                                            type="text"
                                            value={newAliasDraft}
                                            onChange={(e) =>
                                              setNewAliasDraft(e.target.value)
                                            }
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter")
                                                void handleSaveNewAlias(cat.name);
                                              if (e.key === "Escape")
                                                handleCancelAddAlias();
                                            }}
                                            placeholder="alias text"
                                            maxLength={80}
                                            autoFocus
                                            className="w-32 bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400"
                                          />
                                          <select
                                            value={newAliasType}
                                            onChange={(e) =>
                                              setNewAliasType(
                                                e.target.value as
                                                  | "search"
                                                  | "local_name"
                                                  | "work_tag"
                                              )
                                            }
                                            className="bg-transparent text-[10px] text-slate-700 outline-none"
                                            aria-label="alias type"
                                          >
                                            <option value="search">search</option>
                                            <option value="local_name">
                                              local_name
                                            </option>
                                            <option value="work_tag">
                                              work_tag
                                            </option>
                                          </select>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void handleSaveNewAlias(cat.name)
                                            }
                                            disabled={
                                              !newAliasDraft.trim() ||
                                              actionInProgress ===
                                                `addAlias::${cat.name}`
                                            }
                                            className="rounded bg-[#003d20] px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
                                          >
                                            {actionInProgress ===
                                            `addAlias::${cat.name}`
                                              ? "…"
                                              : "Save"}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={handleCancelAddAlias}
                                            className="text-[10px] text-slate-500 hover:text-slate-800"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleStartAddAlias(cat.name)
                                          }
                                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#003d20]/40 bg-white px-2 py-0.5 text-xs font-medium text-[#003d20] hover:bg-[#003d20]/5"
                                        >
                                          + Add alias / work tag
                                        </button>
                                      )}
                                      </div>
                                    )}
                                  </div>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="inline-flex flex-wrap justify-end gap-2">
                                  {!isEditing && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingCategoryName(cat.name);
                                        setEditingCategoryDraft(cat.name);
                                      }}
                                      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                      Edit
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleToggleActive(cat.name, cat.active)
                                    }
                                    disabled={actionInProgress === toggleKey}
                                    className={`rounded border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                                      cat.active
                                        ? "border-orange-300 text-orange-700 hover:bg-orange-50"
                                        : "border-[#003d20]/40 text-[#003d20] hover:bg-green-50"
                                    }`}
                                  >
                                    {actionInProgress === toggleKey
                                      ? "…"
                                      : cat.active
                                        ? "Disable"
                                        : "Enable"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleArchive(cat.name)}
                                    disabled={
                                      actionInProgress === `archive::${cat.name}`
                                    }
                                    data-testid={`archive-category-${cat.name}`}
                                    title="Archive — hides from users/providers and snapshots the mappings for review"
                                    className="rounded border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                  >
                                    {actionInProgress === `archive::${cat.name}`
                                      ? "…"
                                      : "Archive"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

            </div>
          )}

          {activeTab === "pending" && (
            <div className="mt-4 space-y-2">
              {pendingLoading && (
                <p className="text-sm text-slate-500">
                  Loading pending requests…
                </p>
              )}
              {pendingError && !pendingLoading && (
                <p className="text-sm text-red-600">Error: {pendingError}</p>
              )}
              {pending &&
                !pendingLoading &&
                !pendingError &&
                pending.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No pending category requests.
                  </p>
                )}

              {pending &&
                !pendingLoading &&
                !pendingError &&
                pending.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Pending Category Requests
                    </p>
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          <th className="px-3 py-2">Category</th>
                          <th className="px-3 py-2">Provider</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pending.map((req, reqIndex) => {
                          const isExpanded = expandedRequest === req.RequestID;
                          const status = String(req.Status ?? "pending").toLowerCase();
                          const isPending = status === "pending";
                          const approveKey = `approve::${req.RequestID}`;
                          const rejectKey = `reject::${req.RequestID}`;
                          return (
                            <Fragment key={`${req.RequestID || "no-id"}-${reqIndex}`}>
                              <tr className="border-b border-slate-100">
                                <td className="px-3 py-2 font-medium text-slate-800">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedRequest(
                                        isExpanded ? null : req.RequestID
                                      )
                                    }
                                    aria-expanded={isExpanded}
                                    className="inline-flex items-center gap-1.5 text-left hover:text-[#003d20] focus:outline-none focus:ring-2 focus:ring-[#003d20]/30"
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                                    )}
                                    {req.RequestedCategory || "—"}
                                  </button>
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                  <div className="font-medium">
                                    {req.ProviderName || "—"}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {req.Phone || "—"}
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                      isPending
                                        ? "bg-orange-100 text-orange-700"
                                        : status === "approved"
                                          ? "bg-green-100 text-[#003d20]"
                                          : "bg-slate-200 text-slate-700"
                                    }`}
                                  >
                                    {status}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {isPending ? (
                                    <div className="inline-flex flex-wrap justify-end gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleApprove(req)}
                                        disabled={actionInProgress === approveKey}
                                        className="rounded border border-[#003d20]/40 px-2 py-1 text-xs font-semibold text-[#003d20] hover:bg-green-50 disabled:opacity-50"
                                      >
                                        {actionInProgress === approveKey
                                          ? "…"
                                          : "Approve"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleReject(req)}
                                        disabled={actionInProgress === rejectKey}
                                        className="rounded border border-orange-300 px-2 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                                      >
                                        {actionInProgress === rejectKey
                                          ? "…"
                                          : "Reject"}
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-slate-400">—</span>
                                  )}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="border-b border-slate-100 bg-slate-50/60">
                                  <td colSpan={4} className="px-3 py-3">
                                    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                                      <div>
                                        <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                          Requested category
                                        </dt>
                                        <dd className="text-slate-800">
                                          {req.RequestedCategory || "—"}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                          Area
                                        </dt>
                                        <dd className="text-slate-800">
                                          {req.Area || "—"}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                          Provider name
                                        </dt>
                                        <dd className="text-slate-800">
                                          {req.ProviderName || "—"}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                          Phone
                                        </dt>
                                        <dd className="text-slate-800">
                                          {req.Phone || "—"}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                          Provider ID
                                        </dt>
                                        <dd className="text-slate-800">
                                          {req.ProviderID || (
                                            <span className="text-slate-400">
                                              not registered yet
                                            </span>
                                          )}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                          Created
                                        </dt>
                                        <dd className="text-slate-800">
                                          {req.CreatedAt
                                            ? new Date(req.CreatedAt).toLocaleString()
                                            : "—"}
                                        </dd>
                                      </div>
                                    </dl>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

              {/* Pending Custom Work Terms — second list under the same
                  Pending Admin Approval tab. Approve/Reject calls hit the
                  existing /api/admin/aliases POST (admin-gated). Each row
                  shows the alias text, the canonical it maps to, the
                  submitter (provider name + phone when available), and a
                  created-at timestamp. Failures render in a small error
                  strip but do not unmount the section. */}
              <div
                className="mt-4 space-y-2"
                data-testid="kk-admin-pending-work-terms"
              >
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Pending Custom Work Terms
                </p>
                {pendingAliasesError && (
                  <p className="text-sm text-red-600">
                    Error: {pendingAliasesError}
                  </p>
                )}
                {pendingAliases &&
                  !pendingAliasesError &&
                  pendingAliases.length === 0 && (
                    <p className="text-sm text-slate-500">
                      No pending custom work terms.
                    </p>
                  )}
                {pendingAliases &&
                  !pendingAliasesError &&
                  pendingAliases.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            <th className="px-3 py-2">Work Term</th>
                            <th className="px-3 py-2">Canonical Category</th>
                            <th className="px-3 py-2">Submitted By</th>
                            <th className="px-3 py-2">Created</th>
                            <th className="px-3 py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pendingAliases.map((row) => {
                            const aliasKey = `${row.alias}`.toLowerCase();
                            const approveKey = `approveAlias::${aliasKey}`;
                            const rejectKey = `rejectAlias::${aliasKey}`;
                            return (
                              <tr
                                key={`${row.alias}-${row.canonicalCategory}`}
                                className="border-b border-slate-100"
                                data-testid={`kk-admin-pending-alias-row-${aliasKey}`}
                              >
                                <td className="px-3 py-2 font-medium text-slate-800">
                                  {row.alias}
                                  {row.aliasType ? (
                                    <span className="ml-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                                      {row.aliasType}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                  {row.canonicalCategory || "—"}
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                  <div className="font-medium">
                                    {row.submittedByName || "—"}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {row.submittedByPhone || "—"}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-xs text-slate-600">
                                  {row.createdAt
                                    ? new Date(row.createdAt).toLocaleString()
                                    : "—"}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="inline-flex flex-wrap justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleAliasApprove(row.alias)
                                      }
                                      disabled={actionInProgress === approveKey}
                                      data-testid={`kk-admin-alias-approve-${aliasKey}`}
                                      className="rounded border border-[#003d20]/40 px-2 py-1 text-xs font-semibold text-[#003d20] hover:bg-green-50 disabled:opacity-50"
                                    >
                                      {actionInProgress === approveKey
                                        ? "…"
                                        : "Approve"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleAliasReject(row.alias)
                                      }
                                      disabled={actionInProgress === rejectKey}
                                      data-testid={`kk-admin-alias-reject-${aliasKey}`}
                                      className="rounded border border-orange-300 px-2 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                                    >
                                      {actionInProgress === rejectKey
                                        ? "…"
                                        : "Reject"}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>
            </div>
          )}

          {activeTab === "archived" && (
            <div className="mt-4 space-y-2">
              {archivesLoading && (
                <p className="text-sm text-slate-500">Loading archives…</p>
              )}
              {archivesError && !archivesLoading && (
                <p className="text-sm text-red-600">Error: {archivesError}</p>
              )}
              {archives &&
                !archivesLoading &&
                !archivesError &&
                archives.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No archived categories yet.
                  </p>
                )}
              {archives &&
                !archivesLoading &&
                !archivesError &&
                archives.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          <th className="px-3 py-2">Category</th>
                          <th className="px-3 py-2 text-right">Providers</th>
                          <th className="px-3 py-2 text-right">Aliases</th>
                          <th className="px-3 py-2">Archived</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {archives.map((row, rowIndex) => {
                          const restoreKey = `restore::${row.id}`;
                          const isRestored = row.status === "restored";
                          return (
                            <tr
                              key={`${row.id || row.categoryName}-${rowIndex}`}
                              data-testid={`archive-row-${row.categoryName
                                .trim()
                                .toLowerCase()}`}
                              className="border-b border-slate-100 align-top last:border-b-0"
                            >
                              <td className="px-3 py-2 font-medium text-slate-800">
                                {row.categoryName || "—"}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                {row.providerCount.toLocaleString()}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                {row.aliasCount.toLocaleString()}
                              </td>
                              <td className="px-3 py-2 text-slate-700">
                                {row.archivedAt
                                  ? new Date(row.archivedAt).toLocaleString()
                                  : "—"}
                                {row.archivedBy ? (
                                  <span className="ml-1 text-xs text-slate-500">
                                    by {row.archivedBy}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                    isRestored
                                      ? "bg-green-100 text-[#003d20]"
                                      : "bg-rose-100 text-rose-700"
                                  }`}
                                >
                                  {row.status}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                {isRestored ? (
                                  <span
                                    className="text-[11px] text-slate-400"
                                    title="Already restored"
                                  >
                                    —
                                  </span>
                                ) : (
                                  <div className="inline-flex flex-wrap justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleRestoreArchive(row.id)
                                      }
                                      disabled={
                                        actionInProgress === restoreKey
                                      }
                                      data-testid={`restore-archive-${row.id}`}
                                      className="rounded border border-[#003d20]/40 px-2 py-1 text-xs font-semibold text-[#003d20] hover:bg-green-50 disabled:opacity-50"
                                    >
                                      {actionInProgress === restoreKey
                                        ? "…"
                                        : "Restore"}
                                    </button>
                                    <span
                                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500"
                                      title="Permanent delete review is a future step"
                                    >
                                      Review later
                                    </span>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
