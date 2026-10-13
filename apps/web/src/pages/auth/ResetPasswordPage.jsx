import { Eye, EyeOff } from "lucide-react";
import AuthLayout from "../../components/brand/AuthLayout";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/errors";

export default function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [resetToken] = useState(searchParams.get("token") || "");
  const isDirectToken = searchParams.get("direct") === "true" || resetToken.length === 64;
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!isDirectToken && !code.trim()) {
      setError("Please enter the verification code.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(resetToken, isDirectToken ? undefined : code.trim(), newPassword);
      setDone(true);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 400) {
        setError(isDirectToken ? "This reset link is invalid or has expired. Please request a new one." : "That code is invalid or has expired. Request a new one.");
      } else if (status === 429) {
        setError("Too many attempts. Please wait before trying again.");
      } else {
        setError(getErrorMessage(err, "Password reset failed."));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!resetToken) {
    return (
      <AuthShell>
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          Missing reset link. Please request a new password reset code.
        </div>
        <Link to="/forgot-password" className="block text-center text-sm text-brand-600 hover:underline">
          Request a reset code
        </Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell>
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
          Password reset successful. Please log in with your new password.
        </div>
        <button onClick={() => navigate("/login")} className="inline-flex w-full min-h-[44px] items-center justify-center rounded-lg bg-brand-600 text-sm font-medium text-white transition-colors hover:bg-brand-700">
          Go to login
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <p className="text-sm text-slate-600 mb-4">
        {isDirectToken
          ? "Set a new password for your account below."
          : "Enter the verification code sent to your email and choose a new password."}
      </p>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
        {!isDirectToken && (
          <div>
            <label htmlFor="reset-code" className="mb-1.5 block text-sm font-medium text-slate-800">Verification code</label>
            <input id="reset-code"
              type="text"
              name="one-time-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input text-center text-lg tracking-[0.5em] tabular-nums"
              placeholder="______"
            />
          </div>
        )}
        <div>
          <label htmlFor="reset-new" className="mb-1.5 block text-sm font-medium text-slate-800">New password</label>
          <div className="relative">
            <input id="reset-new"
              type={showNewPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input pr-11"
            />
            <button
              type="button"
              onClick={() => setShowNewPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showNewPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-slate-800"
            >
              {showNewPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="reset-confirm" className="mb-1.5 block text-sm font-medium text-slate-800">Confirm new password</label>
          <div className="relative">
            <input id="reset-confirm"
              type={showConfirmPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input pr-11"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-slate-800"
            >
              {showConfirmPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <button disabled={busy} className="inline-flex w-full min-h-[44px] items-center justify-center rounded-lg bg-brand-600 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Resetting..." : "Reset password"}
        </button>
      </form>
      <Link to="/login" className="block text-center text-sm mt-6 text-slate-600 hover:text-slate-900 hover:underline">
        Back to sign in
      </Link>
    </AuthShell>
  );
}

function AuthShell({ children }) {
  return (
    <AuthLayout title="Reset password" subtitle="LauncherDesk E-Stamping Platform">
      {children}
    </AuthLayout>
  );
}
