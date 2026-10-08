import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiClient } from "../../api/client";

export default function CreateUserPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "USER" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data } = await apiClient.post("/users", form);
      setResult(data.data);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to create user.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-slate-900 mb-4">Employee created</h1>
        <div className="bg-amber-50 text-amber-800 rounded-2xl border border-amber-200 p-6 space-y-2">
          <p>
            <strong>{result.user.name}</strong> ({result.user.email}) has been created as <strong>{result.user.role}</strong>.
          </p>
          <p>Share this temporary password securely - it will not be shown again:</p>
          <p className="font-mono font-semibold text-lg">{result.tempPassword}</p>
          <p className="text-xs text-amber-700">They will be required to change it on first login.</p>
        </div>
        <div className="mt-4 space-x-4">
          <Link to="/users" className="text-sm text-brand-600 hover:underline">
            Back to user list
          </Link>
          <button
            onClick={() => {
              setResult(null);
              setForm({ name: "", email: "", phone: "", role: "USER" });
            }}
            className="text-sm text-slate-500 hover:underline"
          >
            Add another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Add Employee</h1>
        <Link to="/users" className="text-sm text-slate-500 hover:underline">
          Back to list
        </Link>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div>
          <label htmlFor="create-user-name" className="block text-sm font-medium text-slate-700 mb-1">
            Name
          </label>
          <input id="create-user-name" required minLength={2} value={form.name} onChange={(e) => update("name", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="create-user-email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input id="create-user-email" required type="email" value={form.email} onChange={(e) => update("email", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label htmlFor="create-user-phone" className="block text-sm font-medium text-slate-700 mb-1">
              Phone (optional)
            </label>
            <input id="create-user-phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>
        <div>
          <label htmlFor="create-user-role" className="block text-sm font-medium text-slate-700 mb-1">
            Role
          </label>
          <select id="create-user-role" value={form.role} onChange={(e) => update("role", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <button disabled={busy} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Creating..." : "Create employee"}
        </button>
      </form>
    </div>
  );
}
