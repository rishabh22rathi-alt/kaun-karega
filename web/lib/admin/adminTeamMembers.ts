import { adminSupabase } from "../supabase/admin";

type AdminRow = {
  phone: string;
  name: string | null;
  role: string;
  permissions: string[] | null;
  active: boolean;
  created_at: string;
};

export type TeamMember = {
  name: string;
  phone: string;
  role: string;
  permissions: string[];
  active: boolean;
  timestamp: string;
};

export type TeamMembersResult =
  | { ok: true; status: "success"; members: TeamMember[] }
  | { ok: false; status: "error"; error: string };

export type TeamMemberMutateResult =
  | { ok: true; status: "success" }
  | { ok: false; status: "error"; error: string };

function toCanonical12DigitPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

function mapRow(row: AdminRow): TeamMember {
  return {
    name: row.name || "",
    phone: row.phone,
    role: row.role || "admin",
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    active: row.active === true,
    timestamp: row.created_at || "",
  };
}

export async function getTeamMembersFromSupabase(): Promise<TeamMembersResult> {
  try {
    const { data, error } = await adminSupabase
      .from("admins")
      .select("phone, name, role, permissions, active, created_at")
      .order("name", { ascending: true });

    if (error) {
      return { ok: false, status: "error", error: error.message };
    }

    return {
      ok: true,
      status: "success",
      members: ((data ?? []) as AdminRow[]).map(mapRow),
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to load team members",
    };
  }
}

export async function addTeamMemberToSupabase(params: {
  name: string;
  phone: string;
  role: string;
  permissions: string[];
}): Promise<TeamMemberMutateResult> {
  try {
    const canonicalPhone = toCanonical12DigitPhone(params.phone);
    if (canonicalPhone.length !== 12) {
      return { ok: false, status: "error", error: "Invalid phone number" };
    }

    const { data: existing } = await adminSupabase
      .from("admins")
      .select("phone")
      .eq("phone", canonicalPhone)
      .maybeSingle();

    if (existing) {
      return { ok: false, status: "error", error: "A team member with this phone already exists" };
    }

    const { error } = await adminSupabase.from("admins").insert({
      phone: canonicalPhone,
      name: params.name.trim(),
      role: params.role || "admin",
      permissions: Array.isArray(params.permissions) ? params.permissions : [],
      active: true,
    });

    if (error) {
      return { ok: false, status: "error", error: error.message };
    }

    return { ok: true, status: "success" };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to add team member",
    };
  }
}

export async function updateTeamMemberInSupabase(params: {
  phone: string;
  role: string;
  permissions: string[];
  active: boolean;
}): Promise<TeamMemberMutateResult> {
  try {
    const canonicalPhone = toCanonical12DigitPhone(params.phone);
    if (canonicalPhone.length !== 12) {
      return { ok: false, status: "error", error: "Invalid phone number" };
    }

    const { data: existing } = await adminSupabase
      .from("admins")
      .select("phone")
      .eq("phone", canonicalPhone)
      .maybeSingle();

    if (!existing) {
      return { ok: false, status: "error", error: "Team member not found" };
    }

    const { error } = await adminSupabase
      .from("admins")
      .update({
        role: params.role || "admin",
        permissions: Array.isArray(params.permissions) ? params.permissions : [],
        active: params.active === true,
      })
      .eq("phone", canonicalPhone);

    if (error) {
      return { ok: false, status: "error", error: error.message };
    }

    return { ok: true, status: "success" };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to update team member",
    };
  }
}

export async function deleteTeamMemberFromSupabase(
  phone: string
): Promise<TeamMemberMutateResult> {
  try {
    const canonicalPhone = toCanonical12DigitPhone(phone);
    if (canonicalPhone.length !== 12) {
      return { ok: false, status: "error", error: "Invalid phone number" };
    }

    const { error } = await adminSupabase
      .from("admins")
      .delete()
      .eq("phone", canonicalPhone);

    if (error) {
      return { ok: false, status: "error", error: error.message };
    }

    return { ok: true, status: "success" };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to delete team member",
    };
  }
}
