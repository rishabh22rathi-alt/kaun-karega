"use client";

"use client";
import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getProviderById, updateProvider } from "@/lib/api/providers";

type ProviderForm = {
  name: string;
  phone: string;
  categories: string;
  areas: string;
};

export default function EditProviderPage() {
  const params = useParams();
  const router = useRouter();
  const providerIdParam = params?.id;
  const providerId = Array.isArray(providerIdParam)
    ? providerIdParam[0]
    : providerIdParam || "";

  const [form, setForm] = useState<ProviderForm>({
    name: "",
    phone: "",
    categories: "",
    areas: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await getProviderById(providerId);
        if (!mounted) return;
        if (!data) {
          setError("Provider not found");
          return;
        }
        const categoriesString = (data.categories || []).join(", ");
        const areasString = (data.areas || []).join(", ");
        setForm({
          name: data.name || "",
          phone: data.phone || "",
          categories: categoriesString,
          areas: areasString,
        });
      } catch (err) {
        console.error("Failed to load provider", err);
        if (mounted) setError("Unable to load provider.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    if (providerId) {
      load();
    } else {
      setError("Invalid provider id");
      setLoading(false);
    }
    return () => {
      mounted = false;
    };
  }, [providerId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        id: providerId,
        name: form.name,
        phone: form.phone,
        categories: form.categories
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        areas: form.areas
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      };
      const res = await updateProvider(payload);
      if (!res.success) {
        setError("Save failed. Try again.");
        setSaving(false);
        return;
      }
      router.push(`/admin/providers/${providerId}`);
    } catch (err) {
      console.error("Save error", err);
      setError("Save failed. Try again.");
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading provider...</p>;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Edit Provider
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {form.name || "Provider"} ({providerId})
          </h1>
        </div>
        <button
          onClick={() => router.push(`/admin/providers/${providerId}`)}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100"
        >
          Back to Profile
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-800">
            Name
            <input
              required
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="Enter provider name"
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-800">
            Phone
            <input
              required
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="+91 98765 43210"
            />
          </label>
        </div>

        <label className="block space-y-2 text-sm font-medium text-slate-800">
          Categories
          <input
            value={form.categories}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, categories: e.target.value }))
            }
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            placeholder="Comma separated e.g. Plumber, Repairs"
          />
          <p className="text-xs font-normal text-slate-500">
            Add comma separated services for quick tagging.
          </p>
        </label>

        <label className="block space-y-2 text-sm font-medium text-slate-800">
          Areas
          <input
            value={form.areas}
            onChange={(e) => setForm((prev) => ({ ...prev, areas: e.target.value }))}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            placeholder="Comma separated e.g. Andheri, Bandra"
          />
          <p className="text-xs font-normal text-slate-500">
            List coverage zones separated by commas.
          </p>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/admin/providers/${providerId}`)}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
