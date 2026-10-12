import { useState } from "react";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { actionErrorMessage } from "../../utils/format";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";

const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

// Master Admin: vendor accounts. Same pattern as Assistant Master Admins:
// the temporary password is shown once and never emailed.
export default function VendorsPage() {
  const { data, loading, error, refetch } = useApi((signal) => apiClient.get("/vendors", { signal }).then((r) => r.data.data.items), [], {
    errorMessage: "Failed to load vendors.",
  });
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [created, setCreated] = useState(null);
  const [rowError, setRowError] = useState("");

  async function create(e) {
    e.preventDefault();
    setFormError("");
    if (form.name.trim().length < 2 || !form.email.includes("@")) return setFormError("Enter a name and a valid email.");
    setCreating(true);
    try {
      const body = { name: form.name.trim(), email: form.email.trim() };
      if (form.phone.trim()) body.phone = form.phone.trim();
      const res = await apiClient.post("/vendors", body);
      setCreated({ email: res.data.data.user.email, tempPassword: res.data.data.tempPassword });
      setForm({ name: "", email: "", phone: "" });
      refetch();
    } catch (err) {
      setFormError(err?.response?.status === 409 ? "A user with this email already exists." : actionErrorMessage(err, "Could not create the vendor."));
    } finally {
      setCreating(false);
    }
  }
  async function setActive(v, isActive) {
    if (!window.confirm(`${isActive ? "Activate" : "Deactivate"} ${v.name}?${isActive ? "" : " They will be signed out immediately."}`)) return;
    setRowError("");
    try {
      await apiClient.patch(`/vendors/${v._id}/status`, { isActive });
      refetch();
    } catch (err) {
      setRowError(actionErrorMessage(err, "Could not change the vendor's status."));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Vendors" subtitle="External stamping partners. Vendors only see orders sent to them." />
      <section className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-medium text-slate-900 mb-3">Add vendor</h2>
        <form onSubmit={create} className="grid sm:grid-cols-4 gap-3 items-end">
          <label className="text-sm text-slate-700">
            Name
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="text-sm text-slate-700">
            Email
            <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="text-sm text-slate-700">
            Phone (optional)
            <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <button type="submit" disabled={creating} className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
            {creating ? "Creating..." : "Create vendor"}
          </button>
        </form>
        {formError && <p role="alert" className="mt-2 text-sm text-red-600">{formError}</p>}
        {created && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm" role="status">
            <p className="text-amber-900">
              Temporary password for <b>{created.email}</b> (shown once): <code className="font-mono">{created.tempPassword}</code>
            </p>
            <p className="text-amber-800 text-xs mt-1">The welcome email does not include it; the vendor can also set a password with Forgot password.</p>
            <button type="button" onClick={() => setCreated(null)} className="mt-2 text-xs underline text-amber-900">
              Dismiss
            </button>
          </div>
        )}
      </section>
      {rowError && <p role="alert" className="text-sm text-red-600">{rowError}</p>}
      {loading && <LoadingState text="Loading vendors..." />}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && (data || []).length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <EmptyState title="No vendors yet" description="Create a vendor to start sending orders." />
        </div>
      )}
      {!loading && !error && (data || []).length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Last login</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((v) => (
                <tr key={v._id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{v.name}</td>
                  <td className="px-4 py-3 text-slate-600">{v.email}</td>
                  <td className="px-4 py-3">{v.isActive ? <span className="text-green-700">Active</span> : <span className="text-slate-500">Inactive</span>}</td>
                  <td className="px-4 py-3 text-slate-500">{v.lastLoginAt ? new Date(v.lastLoginAt).toLocaleString() : "Never"}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => setActive(v, !v.isActive)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs" aria-label={`${v.isActive ? "Deactivate" : "Activate"} ${v.name}`}>
                      {v.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
