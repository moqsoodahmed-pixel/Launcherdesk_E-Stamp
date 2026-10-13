import { KeyRound, Mail, ShieldCheck } from "lucide-react";
import Toast from "../../components/ui/Toast";
import { useState } from "react";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { getErrorMessage } from "../../utils/errors";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import ChangePasswordForm from "../../components/common/ChangePasswordForm";


const ROLE_LABELS = {
  MASTER_ADMIN: "Master Admin",
  ASSISTANT_MASTER_ADMIN: "Assistant Master Admin",
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  USER: "User",
};

export default function ProfilePage() {
  const { data: me, loading, error, refetch, setData } = useApi(
    (signal) => apiClient.get("/auth/me", { signal }).then((r) => r.data.data),
    [],
    { errorMessage: "Failed to load your profile." }
  );

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [saveErr, setSaveErr] = useState(null);
  const [pwMsg, setPwMsg] = useState(null);

  // Fill the form in the same render that first shows the loaded profile
  // (not in an effect afterwards), so the fields are never on screen empty
  // next to loaded account details.
  const [formFor, setFormFor] = useState(null);
  if (me && me !== formFor) {
    setFormFor(me);
    setName(me.name || "");
    setPhone(me.phone || "");
  }

  async function saveProfile(e) {
    e.preventDefault();
    setSaveMsg(null);
    setSaveErr(null);
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (trimmedName.length < 2 || trimmedName.length > 150) return setSaveErr("Name must be 2 to 150 characters.");
    if (trimmedPhone && (trimmedPhone.length < 6 || trimmedPhone.length > 20)) return setSaveErr("Phone must be 6 to 20 characters, or empty.");
    setSaving(true);
    try {
      const { data } = await apiClient.patch("/profile", { name: trimmedName, phone: trimmedPhone });
      setData((prev) => ({ ...prev, name: data.data.name, phone: data.data.phone }));
      setSaveMsg("Profile updated.");
    } catch (err) {
      setSaveErr(getErrorMessage(err, "Could not update your profile."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader title="Profile" subtitle="Your account details" />
      {loading && <LoadingState text="Loading your profile..." />}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && me && (
        <div className="space-y-6">
          <section className="card flex flex-wrap items-center gap-4 p-5 sm:p-6">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 font-display text-lg font-semibold text-brand-800" aria-hidden="true">
              {initialsOf(me.name || me.email)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-semibold text-slate-900">{me.name}</p>
              <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div className="flex min-w-0 items-center gap-1.5">
                  <dt className="sr-only">Email</dt>
                  <Mail size={14} className="shrink-0 text-slate-500" aria-hidden="true" />
                  <dd className="break-all text-slate-700">{me.email}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Role</dt>
                  <ShieldCheck size={14} className="shrink-0 text-slate-500" aria-hidden="true" />
                  <dd className="text-slate-700">{ROLE_LABELS[me.role] || me.role}</dd>
                </div>
              </dl>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card p-5 sm:p-6">
              <h2 className="mb-1 font-display text-base font-semibold text-slate-900">Account</h2>
              <p className="mb-4 text-sm text-slate-600">Your email and role are managed by your administrator.</p>
              {saveMsg && (
                <Toast tone="success" className="mb-4">
                  {saveMsg}
                </Toast>
              )}
              {saveErr && (
                <Toast tone="error" className="mb-4">
                  {saveErr}
                </Toast>
              )}
              <form onSubmit={saveProfile} className="space-y-4">
                <div>
                  <label htmlFor="profile-name" className="mb-1.5 block text-sm font-medium text-slate-800">
                    Name
                  </label>
                  <input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={150} className="input" />
                </div>
                <div>
                  <label htmlFor="profile-phone" className="mb-1.5 block text-sm font-medium text-slate-800">
                    Phone (optional)
                  </label>
                  <input id="profile-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} className="input" />
                </div>
                <button disabled={saving} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50 sm:min-h-[40px]">
                  {saving ? "Saving..." : "Save changes"}
                </button>
              </form>
            </section>

            <section className="card p-5 sm:p-6">
              <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-slate-900">
                <KeyRound size={18} strokeWidth={1.75} className="text-slate-500" aria-hidden="true" />
                Change password
              </h2>
              {pwMsg && (
                <Toast tone="success" className="mb-4">
                  {pwMsg}
                </Toast>
              )}
              <ChangePasswordForm submitClassName="" onSuccess={() => setPwMsg("Password changed. Other devices have been signed out.")} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function initialsOf(text) {
  return (
    String(text || "")
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U"
  );
}
