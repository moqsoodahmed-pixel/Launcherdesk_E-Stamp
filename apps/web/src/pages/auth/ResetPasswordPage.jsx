import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export default function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [resetToken] = useState(searchParams.get("token") || "");
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
      await resetPassword(resetToken, code, newPassword);
      setDone(true);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 400) {
        setError("That code is invalid or has expired. Request a new one.");
      } else if (status === 429) {
        setError("Too many attempts. Please wait before trying again.");
      } else {
        setError(err?.response?.data?.message || "Password reset failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!resetToken) {
    return (
      <AuthShell>
        <div className="mb-4 rounded-lg bg-amber-50 text-amber-700 text-sm px-3 py-2">
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
        <div className="mb-4 rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">
          Password reset successful. Please log in with your new password.
        </div>
        <button onClick={() => navigate("/login")} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2 text-sm font-medium">
          Go to login
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <p className="text-sm text-slate-600 mb-4">Enter the verification code sent to your email and choose a new password.</p>
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Verification code</label>
          <input
            type="text"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full text-center tracking-[0.5em] text-lg rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="______"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">New password</label>
          <div className="relative">
            <input
              type={showNewPassword ? "text" : "password"}
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={() => setShowNewPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showNewPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
            >
              {showNewPassword ? "🙈" : "👁️"}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Confirm new password</label>
          <div className="relative">
            <input
              type={showConfirmPassword ? "text" : "password"}
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
            >
              {showConfirmPassword ? "🙈" : "👁️"}
            </button>
          </div>
        </div>
        <button disabled={busy} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Resetting..." : "Reset password"}
        </button>
      </form>
      <Link to="/login" className="block text-center text-sm text-slate-500 mt-4 hover:underline">
        Back to sign in
      </Link>
    </AuthShell>
  );
}

function AuthShell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-2xl font-semibold text-slate-900 mb-1">Reset password</h1>
        <p className="text-sm text-slate-500 mb-6">LauncherDesk E-Stamping Platform</p>
        {children}
      </div>
    </div>
  );
}
