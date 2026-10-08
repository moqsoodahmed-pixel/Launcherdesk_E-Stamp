import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiClient } from "../../api/client";

export default function CreateOrganizationPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", contactEmail: "", contactPhone: "", gstin: "", address: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data } = await apiClient.post("/organizations", form);
      navigate(`/organizations/${data.data._id}`, { state: { created: true } });
    } catch (err) {
      const flat = err?.response?.data?.details;
      if (flat?.fieldErrors) {
        const firstField = Object.keys(flat.fieldErrors)[0];
        setError(`${firstField}: ${flat.fieldErrors[firstField][0]}`);
      } else {
        setError(err?.response?.data?.message || "Failed to create organization.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">New Organization</h1>
        <Link to="/organizations" className="text-sm text-slate-500 hover:underline">
          Back to list
        </Link>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div>
          <label htmlFor="create-org-name" className="block text-sm font-medium text-slate-700 mb-1">
            Organization name
          </label>
          <input id="create-org-name" required minLength={2} value={form.name} onChange={(e) => update("name", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="create-org-email" className="block text-sm font-medium text-slate-700 mb-1">
              Contact email
            </label>
            <input id="create-org-email" required type="email" value={form.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label htmlFor="create-org-phone" className="block text-sm font-medium text-slate-700 mb-1">
              Contact phone
            </label>
            <input id="create-org-phone" required minLength={6} value={form.contactPhone} onChange={(e) => update("contactPhone", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>
        <div>
          <label htmlFor="create-org-gstin" className="block text-sm font-medium text-slate-700 mb-1">
            GSTIN (optional)
          </label>
          <input id="create-org-gstin" value={form.gstin} onChange={(e) => update("gstin", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label htmlFor="create-org-address" className="block text-sm font-medium text-slate-700 mb-1">
            Address (optional)
          </label>
          <textarea id="create-org-address" value={form.address} onChange={(e) => update("address", e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <button disabled={busy} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Creating..." : "Create organization"}
        </button>
      </form>
    </div>
  );
}
