import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { getErrorMessage } from "../../utils/errors";
import { PERMISSIONS } from "../../utils/permissions";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";
import TemporaryPasswordCell from "../../components/common/TemporaryPasswordCell";

const LIMIT = 20;
const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";
const ALL_PERMISSIONS = Object.values(PERMISSIONS);

// 403/409/429 get explicit wording; anything else uses the server message.
export function actionError(err, fallback) {
  const status = err?.response?.status;
  if (status === 403) return "You do not have permission to do this. Only a Master Admin can manage Assistant Master Admins.";
  if (status === 409) return err?.response?.data?.message || "A user with this email already exists.";
  return getErrorMessage(err, fallback);
}

export default function AssistantAdminsPage() {
  const [page, setPage] = useState(1);
  const { data, loading, error, refetch } = useApi(
    (signal) => apiClient.get("/users", { signal, params: { role: "ASSISTANT_MASTER_ADMIN", page, limit: LIMIT } }).then((r) => r.data.data),
    [page],
    { errorMessage: "Failed to load Assistant Master Admins." }
  );

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState(null);
  const [created, setCreated] = useState(null); // { email, tempPassword } shown once
  const [rowErr, setRowErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null); // user whose permissions are being edited

  async function handleCreate(e) {
    e.preventDefault();
    setCreateErr(null);
    setCreating(true);
    try {
      const body = { name: form.name.trim(), email: form.email.trim() };
      if (form.phone.trim()) body.phone = form.phone.trim();
      const { data: res } = await apiClient.post("/users/assistant-admins", body);
      setCreated({ email: res.data.user.email, tempPassword: res.data.tempPassword });
      setForm({ name: "", email: "", phone: "" });
      setShowCreate(false);
      refetch();
    } catch (err) {
      setCreateErr(actionError(err, "Could not create the Assistant Master Admin."));
    } finally {
      setCreating(false);
    }
  }

  async function toggleStatus(u) {
    setRowErr(null);
    setBusyId(u._id);
    try {
      await apiClient.patch(`/users/${u._id}/status`, { isActive: !u.isActive });
      refetch();
    } catch (err) {
      setRowErr(actionError(err, "Could not change this account's status."));
    } finally {
      setBusyId(null);
    }
  }

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div>
      <PageHeader
        title="Assistant Master Admins"
        subtitle="Internal staff accounts with a permission set you control"
        actions={
          <button type="button" onClick={() => setShowCreate((v) => !v)} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
            {showCreate ? "Cancel" : "New Assistant Admin"}
          </button>
        }
      />

      {created && (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">Account created for {created.email}.</p>
              <p className="mt-1">
                Temporary password: <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-200 select-all">{created.tempPassword}</code>
              </p>
              <p className="mt-1 text-xs">Share it securely. It will not be shown again; they must change it at first sign-in.</p>
            </div>
            <button type="button" onClick={() => setCreated(null)} className="text-amber-800 hover:underline text-xs font-medium">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 bg-white rounded-xl border border-slate-200 p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {createErr && (
            <div role="alert" className="sm:col-span-3 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
              {createErr}
            </div>
          )}
          <div>
            <label htmlFor="aa-name" className="block text-sm font-medium text-slate-700 mb-1">
              Name
            </label>
            <input id="aa-name" required minLength={2} maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor="aa-email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input id="aa-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor="aa-phone" className="block text-sm font-medium text-slate-700 mb-1">
              Phone (optional)
            </label>
            <input id="aa-phone" type="tel" minLength={6} maxLength={20} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} />
          </div>
          <div className="sm:col-span-3">
            <button disabled={creating} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
              {creating ? "Creating..." : "Create account"}
            </button>
          </div>
        </form>
      )}

      {rowErr && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
          {rowErr}
        </div>
      )}

      {loading && <LoadingState text="Loading Assistant Master Admins..." />}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && items.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <EmptyState title="No Assistant Master Admins yet" description="Create one to delegate client and order operations." />
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Permissions</th>
                <th className="text-left px-4 py-3">Password</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u._id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{u.name}</td>
                  <td className="px-4 py-3 text-slate-600 break-all">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${u.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                      {u.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{(u.permissions || []).length}</td>
                  <td className="px-4 py-3">
                    <TemporaryPasswordCell userId={u._id} passwordState={u.passwordState} label={`password for ${u.name}`} />
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button type="button" onClick={() => setEditing(u)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
                      Edit permissions
                    </button>
                    <button
                      type="button"
                      disabled={busyId === u._id}
                      onClick={() => toggleStatus(u)}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {u.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!error && total > LIMIT && (
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 text-sm text-slate-500">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="space-x-2">
            <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
              Previous
            </button>
            <button disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}

      {editing && (
        <PermissionsDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

// PATCH /users/:id/permissions is a FULL overwrite: the checked set is sent
// as-is, so unchecking a box revokes it.
function PermissionsDialog({ user, onClose, onSaved }) {
  const [selected, setSelected] = useState(() => new Set(user.permissions || []));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus the first checkbox once on open; Escape closes.
  useEffect(() => {
    dialogRef.current?.querySelector("input")?.focus();
    function onKey(e) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function toggle(p) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      await apiClient.patch(`/users/${user._id}/permissions`, { permissions: ALL_PERMISSIONS.filter((p) => selected.has(p)) });
      onSaved();
    } catch (e) {
      setErr(actionError(e, "Could not save permissions."));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="perm-dialog-title" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-xl border border-slate-200 p-6">
        <h2 id="perm-dialog-title" className="text-base font-semibold text-slate-900">
          Permissions for {user.name}
        </h2>
        <p className="text-xs text-slate-500 mt-1 mb-4">Saving replaces the whole permission set: unchecked permissions are revoked.</p>
        {err && (
          <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
            {err}
          </div>
        )}
        <fieldset>
          <legend className="sr-only">Permissions</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ALL_PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={selected.has(p)} onChange={() => toggle(p)} className="rounded border-slate-300" />
                <span className="font-mono text-xs">{p}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {saving ? "Saving..." : "Save permissions"}
          </button>
        </div>
      </div>
    </div>
  );
}
