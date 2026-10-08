import { useEffect, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";

export default function EditUserPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [roleBusy, setRoleBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .get(`/users/${id}`)
      .then((res) => {
        setUser(res.data.data);
        setForm({ name: res.data.data.name, email: res.data.data.email, phone: res.data.data.phone || "" });
      })
      .catch((err) => setError(err?.response?.data?.message || "Failed to load user."))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiClient.patch(`/users/${id}`, form);
      setNotice("Employee updated.");
      load();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update employee.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(newRole) {
    if (!window.confirm(`Change ${user.name}'s role to ${newRole}?`)) return;
    setRoleBusy(true);
    setError(null);
    try {
      await apiClient.patch(`/users/${id}/role`, { role: newRole });
      setNotice(`Role changed to ${newRole}.`);
      load();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to change role.");
    } finally {
      setRoleBusy(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (error && !user) return <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>;
  if (!user) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{user.name}</h1>
        <Link to="/users" className="text-sm text-slate-500 hover:underline">
          Back to list
        </Link>
      </div>

      {notice && <div className="rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{notice}</div>}
      {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

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
            Phone
          </label>
          <input id="edit-user-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <button disabled={saving} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
          {saving ? "Saving..." : "Save changes"}
        </button>
      </form>

      {(user.role === "ADMIN" || user.role === "USER") && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-3">Role</h2>
          <p className="text-sm text-slate-500 mb-3">
            Current role: <span className="font-medium text-slate-900">{user.role}</span>
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
    </div>
  );
}
