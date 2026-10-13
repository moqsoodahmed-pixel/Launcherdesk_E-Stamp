import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { getErrorMessage } from "../../utils/errors";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import ChangePasswordForm from "../../components/common/ChangePasswordForm";

const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

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

  useEffect(() => {
    if (!me) return;
    setName(me.name || "");
    setPhone(me.phone || "");
  }, [me]);

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
    <div className="max-w-3xl">
      <PageHeader title="Profile" subtitle="Your account details" />
      {loading && <LoadingState text="Loading your profile..." />}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && me && (
        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">Account</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 text-sm">
              <div>
                <dt className="text-slate-500">Email</dt>
                <dd className="text-slate-900 break-all">{me.email}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Role</dt>
                <dd className="text-slate-900">{ROLE_LABELS[me.role] || me.role}</dd>
              </div>
            </dl>
            {saveMsg && (
              <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
                {saveMsg}
              </div>
            )}
            {saveErr && (
              <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                {saveErr}
              </div>
            )}
            <form onSubmit={saveProfile} className="space-y-4">
              <div>
                <label htmlFor="profile-name" className="mb-1.5 block text-sm font-medium text-slate-800">
                  Name
                </label>
                <input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={150} className={inputClass} />
              </div>
              <div>
                <label htmlFor="profile-phone" className="mb-1.5 block text-sm font-medium text-slate-800">
                  Phone (optional)
                </label>
                <input id="profile-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} className={inputClass} />
              </div>
              <button disabled={saving} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50">
                {saving ? "Saving..." : "Save changes"}
              </button>
            </form>
          </section>

          <section className="card p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">Change password</h2>
            {pwMsg && (
              <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
                {pwMsg}
              </div>
            )}
            <ChangePasswordForm submitClassName="" onSuccess={() => setPwMsg("Password changed. Other devices have been signed out.")} />
          </section>
        </div>
      )}
    </div>
  );
}
