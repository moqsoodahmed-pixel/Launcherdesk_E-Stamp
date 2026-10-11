import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/errors";
import { safeNextPath } from "./LoginPage";
import PasswordField from "../../components/common/PasswordField";

// Same strength rule as the API's changePasswordSchema / resetPasswordSchema.
const MIN_LENGTH = 8;

export default function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const forced = !!user?.mustChangePassword;
  const from = location.state?.from;
  const nextPath = safeNextPath(from ? `${from.pathname}${from.search || ""}` : null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < MIN_LENGTH) return setError(`New password must be at least ${MIN_LENGTH} characters.`);
    if (newPassword !== confirmPassword) return setError("New passwords do not match.");
    if (newPassword === currentPassword) return setError("New password must be different from the current password.");
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      navigate(nextPath === "/change-password" ? "/dashboard" : nextPath, { replace: true, state: { passwordChanged: true } });
    } catch (err) {
      setError(getErrorMessage(err, "Could not change your password."));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-2xl font-semibold text-slate-900 mb-1">Change password</h1>
        <p className="text-sm text-slate-500 mb-6">LauncherDesk E-Stamping Platform</p>
        {forced && (
          <p className="text-sm text-slate-600 mb-4">You signed in with a temporary password. Choose a new password to continue.</p>
        )}
        {error && (
          <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <PasswordField label="New password" value={newPassword} onChange={setNewPassword} minLength={MIN_LENGTH} />
          <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} minLength={MIN_LENGTH} />
          <p className="text-xs text-slate-500">At least {MIN_LENGTH} characters. Changing it signs you out on other devices.</p>
          <button disabled={busy} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">
            {busy ? "Saving..." : "Change password"}
          </button>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          {!forced ? (
            <button type="button" onClick={() => navigate(-1)} className="text-slate-500 hover:underline">
              Cancel
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={() => logout()} className="text-red-600 hover:underline">
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
