"use client";

type AdminTopbarProps = {
  name?: string;
  role?: string;
  onLogout: () => void;
  onMenuToggle?: () => void;
};

export default function AdminTopbar({
  name = "Admin",
  role = "admin",
  onLogout,
  onMenuToggle,
}: AdminTopbarProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm md:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuToggle}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 md:hidden"
          aria-label="Toggle sidebar"
        >
          <span className="block h-0.5 w-5 bg-slate-700" />
          <span className="block h-0.5 w-5 bg-slate-700" />
          <span className="block h-0.5 w-5 bg-slate-700" />
        </button>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Admin Workspace
          </p>
          <p className="text-sm font-semibold leading-tight text-slate-900">
            {name} <span className="text-slate-500">({role})</span>
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
      >
        Logout
      </button>
    </header>
  );
}
