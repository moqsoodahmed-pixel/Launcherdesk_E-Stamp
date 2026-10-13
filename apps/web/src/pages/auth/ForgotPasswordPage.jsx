import AuthLayout from "../../components/brand/AuthLayout";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/errors";

export default function ForgotPasswordPage() {
  const { forgotPassword } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [challengeToken, setChallengeToken] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await forgotPassword(email);
      // Always proceed to the OTP + new-password step, regardless of whether
      // the email actually exists - the backend intentionally returns the
      // same shape either way so this flow can never be used to enumerate
      // registered accounts.
      setChallengeToken(result.challengeToken);
    } catch (err) {
      setError(getErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (challengeToken) {
    return (
      <AuthShell>
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
          If that email is registered, a verification code has been sent to it.
        </div>
        <button
          onClick={() => navigate(`/reset-password?token=${encodeURIComponent(challengeToken)}`)}
          className="inline-flex w-full min-h-[44px] items-center justify-center rounded-lg bg-brand-600 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          I have the code
        </button>
        <Link to="/login" className="block text-center text-sm mt-6 text-slate-600 hover:text-slate-900 hover:underline">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <p className="text-sm text-slate-600 mb-4">
        Enter your account email and we'll send you a verification code to reset your password.
      </p>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="forgot-email" className="mb-1.5 block text-sm font-medium text-slate-800">Email</label>
          <input id="forgot-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </div>
        <button disabled={busy} className="inline-flex w-full min-h-[44px] items-center justify-center rounded-lg bg-brand-600 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Sending..." : "Send reset code"}
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
    <AuthLayout title="Forgot password" subtitle="LauncherDesk E-Stamping Platform">
      {children}
    </AuthLayout>
  );
}
