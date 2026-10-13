import { ArrowLeft, CheckCircle2, UserPlus } from "lucide-react";
import Toast from "../../components/ui/Toast";
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
        <h1 className="mb-4 flex items-center gap-2 font-display text-2xl font-semibold text-slate-900">
          <CheckCircle2 size={24} className="text-emerald-600" aria-hidden="true" />
          {ROLE_LABELS[result.user.role] || "User"} created
        </h1>
        <div className="space-y-2 rounded-card border border-marigold-200 bg-marigold-50 p-5 text-sm text-marigold-900 sm:p-6">
          <p>
            <strong>{result.user.name}</strong> ({result.user.email}) has been created as <strong>{result.user.role}</strong>.
          </p>
          <p>Share this temporary password securely - it will not be shown again:</p>
          <p className="inline-block rounded-lg border border-marigold-200 bg-white px-3 py-2 font-mono text-lg font-semibold text-slate-900">{result.tempPassword}</p>
          <p className="text-xs text-marigold-800">They will be required to change it on first login.</p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Link to={backTo} className="inline-flex min-h-[36px] items-center text-sm font-medium text-brand-700 hover:underline">
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
      <Link to={backTo} className="inline-flex min-h-[36px] items-center gap-1 text-sm text-slate-600 hover:text-slate-900 hover:underline">
        <ArrowLeft size={16} aria-hidden="true" />
        Back to list
      </Link>
      <div className="mb-6 mt-1">
        <h1 className="font-display text-2xl font-semibold text-slate-900">Add {roleLabel}</h1>
        <p className="mt-1 text-sm text-slate-600">They get a temporary password and choose their own when they first sign in.</p>
      </div>

      {error && <Toast tone="error" className="mb-4">{error}</Toast>}

      <form onSubmit={handleSubmit} className="card space-y-5 p-5 sm:p-6">
        <div>
          <label htmlFor="create-user-name" className="mb-1.5 block text-sm font-medium text-slate-800">
            Name
          </label>
          <input id="create-user-name" required minLength={2} value={form.name} onChange={(e) => update("name", e.target.value)} className="input" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-5">
          <Link to={backTo} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 sm:min-h-[40px]">
            Cancel
          </Link>
          <button disabled={busy} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50 sm:min-h-[40px]">
            <UserPlus size={16} aria-hidden="true" />
            {busy ? "Creating..." : `Create ${(ROLE_LABELS[form.role] || "user").toLowerCase()}`}
          </button>
        </div>
      </form>
    </div>
  );
}
