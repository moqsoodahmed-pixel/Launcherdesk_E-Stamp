import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

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
      setError(err?.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (challengeToken) {
    return (
      <AuthShell>
        <div className="mb-4 rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">
          If that email is registered, a verification code has been sent to it.
        </div>
        <button
          onClick={() => navigate(`/reset-password?token=${encodeURIComponent(challengeToken)}`)}
          className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2 text-sm font-medium"
        >
          I have the code
        </button>
        <Link to="/login" className="block text-center text-sm text-slate-500 mt-4 hover:underline">
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
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button disabled={busy} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Sending..." : "Send reset code"}
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
        <h1 className="text-2xl font-semibold text-slate-900 mb-1">Forgot password</h1>
        <p className="text-sm text-slate-500 mb-6">LauncherDesk E-Stamping Platform</p>
        {children}
      </div>
    </div>
  );
}
