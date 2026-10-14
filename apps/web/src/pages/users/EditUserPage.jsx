import { useEffect, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { getErrorMessage } from "../../utils/errors";
import { useAuth } from "../../context/AuthContext";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import { manageableRoles, ROLE_LABELS } from "../../utils/roles";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import TemporaryPasswordCell from "../../components/common/TemporaryPasswordCell";

export default function EditUserPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const [user, setUser] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [roleBusy, setRoleBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetResult, setResetResult] = useState(null);
  const [resetError, setResetError] = useState(null);

  async function handleDelete() {
    if (!window.confirm(`Are you sure you want to delete ${user.name}? This action cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await apiClient.delete(`/users/${id}`);
      navigate(`/users?role=${user.role}`);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to delete user."));
      setDeleting(false);
    }
  }

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

  async function handleResetPassword(e) {
    e.preventDefault();
    setResettingPassword(true);
    setResetError(null);
    setResetResult(null);
    try {
      await apiClient.post(`/users/${id}/reset-password`, { password: newPassword });
      setResetResult(newPassword);
      setNewPassword("");
      setShowNewPassword(false);
      load(true);
    } catch (err) {
      setResetError(getErrorMessage(err, "Failed to reset password."));
    } finally {
      setResettingPassword(false);
    }
  }

  async function handleRoleChange(newRole) {
    if (!window.confirm(`Change ${user.name}'s role to ${ROLE_LABELS[newRole] || newRole}?`)) return;
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{user.name}</h1>
        <Link to={`/users?role=${user.role}`} className="text-sm text-slate-500 hover:underline">
          Back to list
        </Link>
      </div>

      {notice && <div className="rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{notice}</div>}
      {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {!canEdit && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2 text-sm">
          <h2 className="font-medium text-slate-900 mb-2">Profile</h2>
          <p>
            <span className="text-slate-500">Email:</span> {user.email}
          </p>
          <p>
            <span className="text-slate-500">Phone:</span> {user.phone?.trim() ? user.phone : "-"}
          </p>
          <p>
            <span className="text-slate-500">Role:</span> {ROLE_LABELS[user.role] || user.role}
          </p>
          <p>
            <span className="text-slate-500">Status:</span> {user.isActive ? "Active" : "Inactive"}
          </p>
          <p className="text-xs text-slate-400 pt-2">You can view this user but not change them.</p>
        </div>
      )}

      {canEdit && (
      <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <h2 className="font-medium text-slate-900">Profile</h2>
        <div>
          <label htmlFor="edit-user-name" className="block text-sm font-medium text-slate-700 mb-1">
            Name
          </label>
          <input id="edit-user-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label htmlFor="edit-user-email" className="block text-sm font-medium text-slate-700 mb-1">
            Email
          </label>
          <input id="edit-user-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label htmlFor="edit-user-phone" className="block text-sm font-medium text-slate-700 mb-1">
            Phone (optional)
          </label>
          <input id="edit-user-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <button disabled={saving} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
          {saving ? "Saving..." : "Save changes"}
        </button>
      </form>
      )}

      {canEdit && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <h2 className="font-medium text-slate-900">Password</h2>

          {user.passwordState && (
            <div className="text-sm text-slate-600">
              Current password: <TemporaryPasswordCell userId={id} passwordState={user.passwordState} />
            </div>
          )}

          <form onSubmit={handleResetPassword} className="space-y-3 pt-2 border-t border-slate-100">
            <p className="text-sm font-medium text-slate-700">Set a new password</p>
            <div>
              <label htmlFor="edit-user-new-password" className="sr-only">
                New password
              </label>
              <div className="relative">
                <input
                  id="edit-user-new-password"
                  required
                  minLength={8}
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (min 8 characters)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  {showNewPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            <button disabled={resettingPassword} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
              {resettingPassword ? "Resetting..." : "Reset password"}
            </button>
            {resetError && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{resetError}</div>}
            {resetResult && (
              <div className="rounded-lg bg-green-50 text-green-800 text-sm px-3 py-2 space-y-1">
                <p>Password reset. Share it with {user.name} securely:</p>
                <code className="block font-mono text-sm bg-white border border-green-200 rounded px-2 py-1">{resetResult}</code>
              </div>
            )}
          </form>
        </div>
      )}

      {canEdit && (user.role === "ADMIN" || user.role === "USER") && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-3">Role</h2>
          <p className="text-sm text-slate-500 mb-3">
            Current role: <span className="font-medium text-slate-900">{ROLE_LABELS[user.role] || user.role}</span>
          </p>
          <button
            disabled={roleBusy}
            onClick={() => handleRoleChange(user.role === "ADMIN" ? "USER" : "ADMIN")}
            className="text-sm rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-50 hover:bg-slate-50"
          >
            Change to {user.role === "ADMIN" ? "User" : "Admin"}
          </button>
        </div>
      )}

      {canEdit && user._id !== me?._id && (
        <div className="bg-white rounded-2xl border border-red-200 p-6">
          <h2 className="font-medium text-red-900 mb-2">Delete User</h2>
          <p className="text-sm text-slate-500 mb-4">
            Permanently remove this user account. If the user has history (orders, requests, audits), their record will be safely deactivated and anonymized.
          </p>
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete user"}
          </button>
        </div>
      )}
    </div>
  );
}
