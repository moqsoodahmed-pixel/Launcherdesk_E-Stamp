import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { getErrorMessage } from "../../utils/errors";
import { useAuth } from "../../context/AuthContext";
import { creatableRoles, ROLE_LABELS } from "../../utils/roles";

export default function CreateUserPage() {
  const { user: me } = useAuth();
  const [searchParams] = useSearchParams();
  // Only roles the backend will accept from this actor (strictly lower
  // authority); ?role= from the list page preselects one of them.
  const roleOptions = creatableRoles(me?.role);
  const requestedRole = searchParams.get("role");
  const initialRole = roleOptions.includes(requestedRole) ? requestedRole : roleOptions.includes("USER") ? "USER" : roleOptions[0] || "USER";
  const roleLabel = ROLE_LABELS[initialRole] || "User";
  const backTo = `/users?role=${initialRole}`;
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: initialRole });
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
      setError(getErrorMessage(err, "Failed to create user."));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-slate-900 mb-4">{ROLE_LABELS[result.user.role] || "User"} created</h1>
        <div className="bg-amber-50 text-amber-800 rounded-2xl border border-amber-200 p-6 space-y-2">
          <p>
            <strong>{result.user.name}</strong> ({result.user.email}) has been created as <strong>{result.user.role}</strong>.
          </p>
          <p>Share this temporary password securely - it will not be shown again:</p>
          <p className="font-mono font-semibold text-lg">{result.tempPassword}</p>
          <p className="text-xs text-amber-700">They will be required to change it on first login.</p>
        </div>
        <div className="mt-4 space-x-4">
          <Link to={backTo} className="text-sm font-medium text-brand-700 hover:underline">
            Back to user list
          </Link>
          <button
            onClick={() => {
              setResult(null);
              setForm({ name: "", email: "", phone: "", role: initialRole });
            }}
            className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline"
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
        <h1 className="font-display text-2xl font-semibold text-slate-900">Add {roleLabel}</h1>
        <Link to={backTo} className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
          Back to list
        </Link>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>}

      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div>
          <label htmlFor="create-user-name" className="mb-1.5 block text-sm font-medium text-slate-800">
            Name
          </label>
          <input id="create-user-name" required minLength={2} value={form.name} onChange={(e) => update("name", e.target.value)} className="input" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="create-user-email" className="mb-1.5 block text-sm font-medium text-slate-800">
              Email
            </label>
            <input id="create-user-email" required type="email" value={form.email} onChange={(e) => update("email", e.target.value)} className="input" />
          </div>
          <div>
            <label htmlFor="create-user-phone" className="mb-1.5 block text-sm font-medium text-slate-800">
              Phone (optional)
            </label>
            <input id="create-user-phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} className="input" />
          </div>
        </div>
        <div>
          <label htmlFor="create-user-role" className="mb-1.5 block text-sm font-medium text-slate-800">
            Role
          </label>
          <select id="create-user-role" value={form.role} onChange={(e) => update("role", e.target.value)} className="input">
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <button disabled={busy} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Creating..." : `Create ${(ROLE_LABELS[form.role] || "user").toLowerCase()}`}
        </button>
      </form>
    </div>
  );
}
