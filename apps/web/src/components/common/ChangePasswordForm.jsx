import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/errors";
import PasswordField from "./PasswordField";

// Same strength rule as the API's changePasswordSchema / resetPasswordSchema.
export const MIN_LENGTH = 8;

// The one change-password form, shared by ChangePasswordPage (forced or
// voluntary change) and ProfilePage. Calls AuthContext.changePassword, which
// posts { currentPassword, newPassword } to /auth/change-password and stores
// the fresh session the API returns.
export default function ChangePasswordForm({ onSuccess, submitClassName = "w-full" }) {
  const { changePassword } = useAuth();
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
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setBusy(false);
      onSuccess?.();
    } catch (err) {
      setError(getErrorMessage(err, "Could not change your password."));
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
        <PasswordField label="New password" value={newPassword} onChange={setNewPassword} minLength={MIN_LENGTH} />
        <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} minLength={MIN_LENGTH} />
        <p className="text-xs text-slate-500">At least {MIN_LENGTH} characters. Changing it signs you out on other devices.</p>
        <button disabled={busy} className={`${submitClassName} inline-flex min-h-[44px] items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50`}>
          {busy ? "Saving..." : "Change password"}
        </button>
      </form>
    </>
  );
}
