"use client";

"use client";
import { useEffect, useMemo, useState } from "react";

type TeamMember = {
  name: string;
  phone: string;
  role: string;
  permissions: string[];
  active: boolean;
  timestamp: string;
};

const ROLE_OPTIONS = ["admin", "support", "community", "operations"];

const PERMISSION_OPTIONS = [
  "view_tasks",
  "view_chats",
  "view_reviews",
  "view_community",
  "manage_community",
  "manage_roles",
];

export default function AdminTeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    role: "support",
    permissions: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [editRole, setEditRole] = useState("support");
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [editActive, setEditActive] = useState(true);

  const permissions = useMemo(
    () =>
      JSON.parse(
        typeof window !== "undefined"
          ? localStorage.getItem("kk_permissions") || "[]"
          : "[]"
      ),
    []
  );

  const canManage = permissions.includes("manage_roles");

  const fetchMembers = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/team/list");
      const data = await res.json();
      if (data.ok) {
        setMembers(data.members || []);
      } else {
        setError("Error loading members");
      }
    } catch {
      setError("Error loading members");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const toggleFormPermission = (perm: string) => {
    setForm((prev) => {
      const exists = prev.permissions.includes(perm);
      return {
        ...prev,
        permissions: exists
          ? prev.permissions.filter((p) => p !== perm)
          : [...prev.permissions, perm],
      };
    });
  };

  const toggleEditPermission = (perm: string) => {
    setEditPermissions((prev) => {
      const exists = prev.includes(perm);
      return exists ? prev.filter((p) => p !== perm) : [...prev, perm];
    });
  };

  const handleAdd = async () => {
    if (!canManage) return;
    if (!form.name.trim() || form.phone.length < 10) {
      setError("Enter name and valid phone");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/team/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.ok) {
        setForm({ name: "", phone: "", role: "support", permissions: [] });
        fetchMembers();
      } else {
        setError(data.error || "Failed to add member");
      }
    } catch {
      setError("Failed to add member");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (member: TeamMember) => {
    setEditing(member);
    setEditRole(member.role);
    setEditPermissions(member.permissions);
    setEditActive(member.active);
  };

  const saveEdit = async () => {
    if (!editing || !canManage) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/team/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: editing.phone,
          role: editRole,
          permissions: editPermissions,
          active: editActive,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setEditing(null);
        fetchMembers();
      } else {
        setError(data.error || "Failed to update member");
      }
    } catch {
      setError("Failed to update member");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (member: TeamMember) => {
    if (!canManage) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/team/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: member.phone,
          role: member.role,
          permissions: member.permissions,
          active: !member.active,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchMembers();
      } else {
        setError(data.error || "Failed to update status");
      }
    } catch {
      setError("Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  const deleteMember = async (member: TeamMember) => {
    if (!canManage) return;
    const confirmed = window.confirm("Delete this team member permanently?");
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/team/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: member.phone }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchMembers();
      } else {
        setError(data.error || "Failed to delete member");
      }
    } catch {
      setError("Failed to delete member");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Team Members</h1>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
          {error}
        </p>
      )}

      {canManage && (
        <div className="bg-white rounded-lg shadow p-4 border border-gray-100 space-y-3">
          <h2 className="text-lg font-semibold">Add New Team Member</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Full name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) =>
                  setForm({
                    ...form,
                    phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                  })
                }
                className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="10-digit phone"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">
                Permissions
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PERMISSION_OPTIONS.map((perm) => (
                  <label key={perm} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.permissions.includes(perm)}
                      onChange={() => toggleFormPermission(perm)}
                    />
                    <span>{perm}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Add Member"}
          </button>
        </div>
      )}

      {editing && canManage && (
        <div className="bg-white rounded-lg shadow p-4 border border-gray-100 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Edit Member</h2>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-sm text-blue-600"
            >
              Close
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-gray-700">Name</p>
              <p className="text-sm text-gray-800">{editing.name}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-gray-700">Phone</p>
              <p className="text-sm text-gray-800">{editing.phone}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">Role</label>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">
                Permissions
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PERMISSION_OPTIONS.map((perm) => (
                  <label key={perm} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editPermissions.includes(perm)}
                      onChange={() => toggleEditPermission(perm)}
                    />
                    <span>{perm}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <input
                type="checkbox"
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
              />
              Active
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg shadow hover:bg-green-700 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg shadow"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 border border-gray-100">
        {loading ? (
          <p className="text-sm text-gray-600">Loading...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-gray-700">
              <thead>
                <tr className="text-blue-600 font-semibold border-b">
                  <th className="text-left py-2 pr-4">Name</th>
                  <th className="text-left py-2 pr-4">Phone</th>
                  <th className="text-left py-2 pr-4">Role</th>
                  <th className="text-left py-2 pr-4">Permissions</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-left py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td className="py-3 pr-4" colSpan={6}>
                      <p className="text-sm text-gray-600">No records found.</p>
                    </td>
                  </tr>
                ) : (
                  members.map((member) => (
                    <tr
                      key={member.phone}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-2 pr-4">{member.name}</td>
                      <td className="py-2 pr-4">{member.phone}</td>
                      <td className="py-2 pr-4 capitalize">{member.role}</td>
                      <td className="py-2 pr-4">
                        {member.permissions.length
                          ? member.permissions.join(", ")
                          : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {member.active ? (
                          <span className="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded-full text-xs font-semibold bg-gray-200 text-gray-700">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {canManage ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(member)}
                              className="px-3 py-1 text-xs bg-blue-600 text-white rounded"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleActive(member)}
                              className="px-3 py-1 text-xs bg-amber-500 text-white rounded"
                            >
                              {member.active ? "Deactivate" : "Reactivate"}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteMember(member)}
                              className="px-3 py-1 text-xs bg-red-600 text-white rounded"
                            >
                              Delete
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">
                            No actions available
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
