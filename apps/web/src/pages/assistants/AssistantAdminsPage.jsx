import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { PERMISSIONS } from "../../utils/permissions";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

// Labels for the permission checkboxes (values come from utils/permissions.js).
const PERMISSION_OPTIONS = Object.entries(PERMISSIONS).map(([key, value]) => ({
  value,
  label: key.toLowerCase().replace(/_/g, " "),
}));

function msg(err, fallback) {
  if (err?.response?.status === 403) return "You do not have permission to do this.";
  if (err?.response?.status === 429) return "Too many requests. Please wait and try again.";
  return err?.response?.data?.message || fallback;
}

export default function AssistantAdminsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 10;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // create form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [tempPassword, setTempPassword] = useState(null); // shown ONCE after creation

  // permission editor
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState([]);
  const [savingPerms, setSavingPerms] = useState(false);
  const [permError, setPermError] = useState(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get("/users", { params: { role: "ASSISTANT_MASTER_ADMIN", page, limit } })
      .then(({ data }) => {
        if (cancelled) return;
        setItems(data.data.items || []);
        setTotal(data.data.total || 0);
      })
      .catch((err) => !cancelled && setError(msg(err, "Failed to load Assistant Master Admins.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page]);

  useEffect(() => load(), [load]);

  async function create(e) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const body = { name: form.name.trim(), email: form.email.trim() };
      if (form.phone.trim()) body.phone = form.phone.trim();
      const { data } = await apiClient.post("/users/assistant-admins", body);
      setTempPassword({ email: body.email, password: data.data.tempPassword });
      setForm({ name: "", email: "", phone: "" });
      setShowCreate(false);
      setNotice(null);
      load();
    } catch (err) {
      setCreateError(msg(err, "Failed to create Assistant Master Admin."));
    } finally {
      setCreating(false);
    }
  }

  async function toggleStatus(u) {
    const next = !u.isActive;
    if (!window.confirm(`${next ? "Activate" : "Deactivate"} ${u.name}?`)) return;
    try {
      await apiClient.patch(`/users/${u._id}/status`, { isActive: next });
      setNotice(`${u.name} ${next ? "activated" : "deactivated"}.`);
      load();
    } catch (err) {
      setError(msg(err, "Failed to update status."));
    }
  }

  function openPermissions(u) {
    setEditing(u);
    setSelected(Array.isArray(u.permissions) ? u.permissions : []);
    setPermError(null);
  }

  function togglePerm(value) {
    setSelected((cur) => (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]));
  }

  async function savePermissions() {
    setSavingPerms(true);
    setPermError(null);
    try {
      // Full overwrite: grants AND revokes, exactly what the API expects.
      await apiClient.patch(`/users/${editing._id}/permissions`, { permissions: selected });
      setNotice(`Permissions updated for ${editing.name}.`);
      setEditing(null);
      load();
    } catch (err) {
      setPermError(msg(err, "Failed to update permissions."));
    } finally {
      setSavingPerms(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Assistant Master Admins</h1>
        <button type="button" onClick={() => { setShowCreate((v) => !v); setCreateError(null); }} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
          {showCreate ? "Cancel" : "+ Add Assistant"}
        </button>
      </div>

      {tempPassword && (
        <div role="status" className="mb-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm p-4">
          <p className="font-medium">Account created for {tempPassword.email}</p>
          <p className="mt-1">
            Temporary password: <code className="bg-white px-2 py-0.5 rounded border border-amber-200">{tempPassword.password}</code>
          </p>
          <p className="mt-1">This is shown only once. Share it securely; they must change it at first login.</p>
          <button type="button" className="mt-2 underline" onClick={() => setTempPassword(null)}>Dismiss</button>
        </div>
      )}
      {notice && <p role="status" className="mb-4 rounded-lg bg-green-50 text-green-700 text-sm p-3">{notice}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm p-3">{error}</p>}

      {showCreate && (
        <form onSubmit={create} className="bg-white rounded-xl border border-slate-200 p-6 mb-6 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm text-slate-600 mb-1" htmlFor="aa-name">Name</label>
            <input id="aa-name" className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={150} />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1" htmlFor="aa-email">Email</label>
            <input id="aa-email" type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1" htmlFor="aa-phone">Phone (optional)</label>
            <input id="aa-phone" className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} minLength={6} maxLength={20} />
          </div>
          {createError && <p role="alert" className="sm:col-span-3 text-sm text-red-600">{createError}</p>}
          <div className="sm:col-span-3">
            <button type="submit" disabled={creating} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-medium">
              {creating ? "Creating..." : "Create"}
            </button>
            <span className="ml-3 text-xs text-slate-500">New assistants get the default permission set. Edit it afterwards.</span>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 bg-slate-50">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Permissions</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>}
            {!loading && items.length === 0 && !error && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No Assistant Master Admins yet.</td></tr>
            )}
            {!loading && items.map((u) => (
              <tr key={u._id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={"rounded-full px-2 py-0.5 text-xs " + (u.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600")}>
                    {u.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">{Array.isArray(u.permissions) ? u.permissions.length : 0} granted</td>
                <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                  <button type="button" className="text-brand-600 hover:underline" onClick={() => openPermissions(u)}>Permissions</button>
                  <button type="button" className={u.isActive ? "text-red-600 hover:underline" : "text-green-700 hover:underline"} onClick={() => toggleStatus(u)}>
                    {u.isActive ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
        <span>{total} total</span>
        <div className="flex items-center gap-3">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50">Previous</button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50">Next</button>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Permissions for ${editing.name}`}>
          <div className="bg-white rounded-xl max-w-lg w-full max-h-[85vh] flex flex-col">
            <div className="p-5 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900">Permissions: {editing.name}</h2>
              <p className="text-xs text-slate-500">Saving replaces the full set. Unticked items are revoked.</p>
            </div>
            <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PERMISSION_OPTIONS.map((p) => (
                <label key={p.value} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={selected.includes(p.value)} onChange={() => togglePerm(p.value)} />
                  <span className="capitalize">{p.label}</span>
                </label>
              ))}
            </div>
            {permError && <p role="alert" className="px-5 text-sm text-red-600">{permError}</p>}
            <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
              <button type="button" disabled={savingPerms} onClick={savePermissions} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-medium">
                {savingPerms ? "Saving..." : "Save permissions"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}