import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

function msg(err, fallback) {
  if (err?.response?.status === 429) return "Too many attempts. Please wait and try again.";
  return err?.response?.data?.message || fallback;
}

export default function ProfilePage() {
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [saveErr, setSaveErr] = useState(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);
  const [pwErr, setPwErr] = useState(null);

  function load() {
    setLoading(true);
    setLoadError(null);
    apiClient
      .get("/auth/me")
      .then(({ data }) => {
        setMe(data.data);
        setName(data.data.name || "");
        setPhone(data.data.phone || "");
      })
      .catch((err) => setLoadError(msg(err, "Failed to load your profile.")))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function saveProfile(e) {
    e.preventDefault();
    setSaveMsg(null);
    setSaveErr(null);
    setSaving(true);
    try {
      const { data } = await apiClient.patch("/profile", { name, phone });
      setMe(data.data);
      setSaveMsg("Profile updated.");
    } catch (err) {
      setSaveErr(msg(err, "Failed to update profile."));
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    setPwErr(null);
    if (newPassword.length < 8) return setPwErr("New password must be at least 8 characters.");
    if (newPassword !== confirmPassword) return setPwErr("New password and confirmation do not match.");
    if (newPassword === currentPassword) return setPwErr("New password must be different from the current one.");
    setPwSaving(true);
    try {
      // IMPORTANT: if your Phase 2 endpoint uses different field names, change them here.
      // Check apps/web/src/pages/auth/ChangePasswordPage.jsx for the exact body it sends.
      const { data } = await apiClient.post("/auth/change-password", { currentPassword, newPassword });
      // Phase 2 returns a fresh session for this tab; save it if present.
      const payload = data?.data;
      if (payload?.accessToken) localStorage.setItem("ld_access_token", payload.accessToken);
      if (payload?.refreshToken) localStorage.setItem("ld_refresh_token", payload.refreshToken);
      setPwMsg("Password changed. Other devices have been signed out.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwErr(msg(err, "Failed to change password."));
    } finally {
      setPwSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading profile...</p>;
  if (loadError)
    return (
      <div className="rounded-lg bg-red-50 text-red-700 text-sm p-4">
        {loadError}{" "}
        <button type="button" onClick={load} className="underline font-medium">
          Retry
        </button>
      </div>
    );

  const role = (me?.role || user?.role || "").replace(/_/g, " ");

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Profile</h1>

      <form onSubmit={saveProfile} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="font-medium text-slate-900">Your details</h2>
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="pf-email">Email</label>
          <input id="pf-email" className={inputClass + " bg-slate-50"} value={me?.email || ""} disabled />
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="pf-role">Role</label>
          <input id="pf-role" className={inputClass + " bg-slate-50"} value={role} disabled />
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="pf-name">Name</label>
          <input id="pf-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={150} />
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="pf-phone">Phone</label>
          <input id="pf-phone" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" maxLength={20} />
        </div>
        {saveErr && <p role="alert" className="text-sm text-red-600">{saveErr}</p>}
        {saveMsg && <p role="status" className="text-sm text-green-700">{saveMsg}</p>}
        <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-medium">
          {saving ? "Saving..." : "Save changes"}
        </button>
      </form>

      <form onSubmit={changePassword} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="font-medium text-slate-900">Change password</h2>
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="pw-current">Current password</label>
          <input id="pw-current" type={show ? "text" : "password"} className={inputClass} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="pw-new">New password (min 8 characters)</label>
          <input id="pw-new" type={show ? "text" : "password"} className={inputClass} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required />
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="pw-confirm">Confirm new password</label>
          <input id="pw-confirm" type={show ? "text" : "password"} className={inputClass} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords
        </label>
        {pwErr && <p role="alert" className="text-sm text-red-600">{pwErr}</p>}
        {pwMsg && <p role="status" className="text-sm text-green-700">{pwMsg}</p>}
        <button type="submit" disabled={pwSaving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-medium">
          {pwSaving ? "Changing..." : "Change password"}
        </button>
      </form>
    </div>
  );
}