import { ArrowLeft, UserCog } from "lucide-react";
import StatusChip from "../../components/ui/StatusChip";
import { SectionCard, DetailRow } from "../../components/ui/DetailList";
import Toast from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/useConfirm";
import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { getErrorMessage } from "../../utils/errors";
import { useAuth } from "../../context/AuthContext";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import { manageableRoles, ROLE_LABELS } from "../../utils/roles";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";

export default function EditUserPage() {
  const [confirm, confirmDialog] = useConfirm();
  const { id } = useParams();
  const { user: me } = useAuth();
  const [user, setUser] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [roleBusy, setRoleBusy] = useState(false);

  // `silent` reloads after a save keep the form on screen instead of
  // flashing back to "Loading...".
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    apiClient
      .get(`/users/${id}`)
      .then((res) => {
        setUser(res.data.data);
        setForm({ name: res.data.data.name, email: res.data.data.email, phone: res.data.data.phone || "" });
      })
      .catch((err) => setError(getErrorMessage(err, "Failed to load user.")))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // Phone is optional but must be >= 6 chars when sent - an empty box is omitted.
      const body = { name: form.name.trim(), email: form.email.trim() };
      if (form.phone.trim()) body.phone = form.phone.trim();
      await apiClient.patch(`/users/${id}`, body);
      setNotice("User updated.");
      load(true);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update user."));
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(newRole) {
    const ok = await confirm({ title: `Change ${user.name}'s role to ${newRole}?`, confirmLabel: "Change role" });
    if (!ok) return;
    setRoleBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiClient.patch(`/users/${id}/role`, { role: newRole });
      setNotice(`Role changed to ${ROLE_LABELS[newRole] || newRole}.`);
      load(true);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to change role."));
    } finally {
      setRoleBusy(false);
    }
  }

  if (loading) return <LoadingState text="Loading user..." />;
  if (error && !user) return <ErrorState message={error} onRetry={() => load()} />;
  if (!user) return null;

  // USER_MANAGE (Super Admin) is needed to edit, and only for strictly lower
  // roles - same rule as user.controller.js. ADMIN (view only) gets a read-only page.
  const canEdit = hasPermission(me, PERMISSIONS.USER_MANAGE) && manageableRoles(me?.role).includes(user.role);

  return (
    <div className="max-w-2xl space-y-6">
      {confirmDialog}
      <div>
        <Link to={`/users?role=${user.role}`} className="inline-flex min-h-[36px] items-center gap-1 text-sm text-slate-600 hover:text-slate-900 hover:underline">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to list
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100 font-display text-base font-semibold text-brand-800" aria-hidden="true">
            {String(user.name || "?").trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="break-words font-display text-2xl font-semibold text-slate-900">{user.name}</h1>
            <p className="text-sm text-slate-600">{ROLE_LABELS[user.role] || user.role}</p>
          </div>
          <StatusChip kind="account" status={user.isActive ? "ACTIVE" : "INACTIVE"} label={user.isActive ? "Active" : "Inactive"} />
        </div>
      </div>

      {notice && <Toast tone="success">{notice}</Toast>}
      {error && <Toast tone="error">{error}</Toast>}

      {!canEdit && (
        <SectionCard title="Profile">
          <DetailRow label="Email" value={user.email} />
          <DetailRow label="Phone" value={user.phone?.trim() ? user.phone : "-"} />
          <p className="pt-4 text-sm text-slate-600">You can view this user but not change them.</p>
        </SectionCard>
      )}

      {canEdit && (
      <form onSubmit={handleSave} className="card space-y-4 p-5 sm:p-6">
        <h2 className="font-display text-base font-semibold text-slate-900">Profile</h2>
        <div>
          <label htmlFor="edit-user-name" className="mb-1.5 block text-sm font-medium text-slate-800">
            Name
          </label>
          <input id="edit-user-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="edit-user-email" className="mb-1.5 block text-sm font-medium text-slate-800">
            Email
          </label>
          <input id="edit-user-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="input" />
        </div>
        <div>
          <label htmlFor="edit-user-phone" className="mb-1.5 block text-sm font-medium text-slate-800">
            Phone (optional)
          </label>
          <input id="edit-user-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="input" />
        </div>
        </div>
        <button disabled={saving} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50">
          {saving ? "Saving..." : "Save changes"}
        </button>
      </form>
      )}

      {canEdit && (user.role === "ADMIN" || user.role === "USER") && (
        <div className="card p-5 sm:p-6">
          <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold text-slate-900">
            <UserCog size={18} strokeWidth={1.75} className="text-slate-500" aria-hidden="true" />
            Role
          </h2>
          <p className="mb-3 text-sm text-slate-600">
            Current role: <span className="font-medium text-slate-900">{user.role}</span>
          </p>
          <button
            disabled={roleBusy}
            onClick={() => handleRoleChange(user.role === "ADMIN" ? "USER" : "ADMIN")}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 sm:min-h-[40px]"
          >
            Change to {user.role === "ADMIN" ? "User" : "Admin"}
          </button>
        </div>
      )}
    </div>
  );
}
