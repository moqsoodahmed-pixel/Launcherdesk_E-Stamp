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
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: initialRole, password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

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
            <strong>{result.user.name}</strong> ({result.user.email}) has been created as <strong>{ROLE_LABELS[result.user.role] || result.user.role}</strong>.
          </p>
          <p>Share this password securely - it won't be shown here again:</p>
          <p className="font-mono font-semibold text-lg">{result.tempPassword}</p>
          <p className="text-xs text-amber-700">
            They can sign in with it right away - no forced change on first login. You can view it again later from the user list, or ask them to request a reset if they ever want a different one.
          </p>
        </div>
        <div className="mt-4 space-x-4">
          <Link to={backTo} className="text-sm text-brand-600 hover:underline">
            Back to user list
          </Link>
          <button
            onClick={() => {
              setResult(null);
              setForm({ name: "", email: "", phone: "", role: initialRole, password: "" });
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
        <h1 className="text-xl font-semibold text-slate-900">Add {roleLabel}</h1>
        <Link to={backTo} className="text-sm text-slate-500 hover:underline">
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
          <label htmlFor="create-user-password" className="block text-sm font-medium text-slate-700 mb-1">
            Password
          </label>
          <div className="relative">
            <input
              id="create-user-password"
              required
              type={showPassword ? "text" : "password"}
              minLength={8}
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-700">
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            At least 8 characters. They can log in with it right away - no forced password change on first login.
          </p>
        </div>
        <div>
          <label htmlFor="create-user-role" className="block text-sm font-medium text-slate-700 mb-1">
            Role
          </label>
          <select id="create-user-role" value={form.role} onChange={(e) => update("role", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <button disabled={busy} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Creating..." : `Create ${(ROLE_LABELS[form.role] || "user").toLowerCase()}`}
        </button>
      </form>
    </div>
  );
}
