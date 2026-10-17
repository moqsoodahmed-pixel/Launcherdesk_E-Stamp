import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/errors";
import AuthBackground from "../../components/common/AuthBackground";
// Served from /public - an animated GIF plays automatically as a plain <img>.
// BASE_URL must be prefixed (see DashboardLayout.jsx's identical constant
// for why) - production serves this app under /e-stamp/, not domain root.
const PLATFORM_LOGO = `${import.meta.env.BASE_URL}launcherdesk-logo-animated-BMOHLLXe.gif`;

// Only same-app relative paths are allowed as a post-login destination -
// never "//evil.com" or an absolute URL (open redirect), never /login itself.
export function safeNextPath(raw) {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/")) return "/dashboard";
  return raw;
}

function messageFor(err, context) {
  const status = err?.response?.status;
  const backendMessage = err?.response?.data?.message;
  if (status === 429) {
    return backendMessage || "Too many attempts. Please wait before trying again.";
  }
  if (!err?.response) return getErrorMessage(err, "Login failed. Please try again.");
  if (context === "otp") {
    if (status === 400) return "Incorrect or expired code. Please try again or resend.";
    return backendMessage || "OTP verification failed.";
  }
  if (status === 401) return "Invalid email or password.";
  return backendMessage || "Login failed. Please try again.";
}

export default function LoginPage() {
  const { user, loading, loginStep1, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get("sessionExpired") === "1";
  // Where to go after login: ProtectedRoute passes it as router state, the
  // API client's session-expired redirect passes it as ?next=.
  const fromState = location.state?.from;
  const nextPath = safeNextPath(fromState ? `${fromState.pathname}${fromState.search || ""}` : searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState("");
  const [challengeToken, setChallengeToken] = useState(null);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const result = await loginStep1(email, password);
      if (result.requiresOtp && result.challengeToken) {
        setChallengeToken(result.challengeToken);
      } else {
        navigate(nextPath, { replace: true });
      }
    } catch (err) {
      setError(messageFor(err, "login"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e) {
    e.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await verifyOtp(challengeToken, otp);
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(messageFor(err, "otp"));
    } finally {
      setBusy(false);
    }
  }

  async function handleResendOtp() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const result = await loginStep1(email, password);
      if (result.requiresOtp && result.challengeToken) {
        setChallengeToken(result.challengeToken);
        setOtp("");
        setInfo("A new verification code has been sent.");
      }
    } catch (err) {
      setError(messageFor(err, "otp"));
    } finally {
      setBusy(false);
    }
  }

  // Already signed in (e.g. back button to /login): go straight on.
  if (!loading && user) return <Navigate to={nextPath} replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <AuthBackground />
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <div className="flex flex-col items-center mb-6">
          <img src={PLATFORM_LOGO} alt="LauncherDesk" className="h-14 w-auto max-w-[260px] object-contain mb-2" />
          <p className="text-xs uppercase tracking-wider text-slate-400 font-medium">E-Stamping Platform</p>
        </div>

        {sessionExpired && !challengeToken && (
          <div className="mb-4 rounded-lg bg-amber-50 text-amber-700 text-sm px-3 py-2">
            Your session has expired. Please sign in again.
          </div>
        )}
        {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
        {info && <div className="mb-4 rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{info}</div>}

        {!challengeToken ? (
          <form onSubmit={handleLogin} className="space-y-4">
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
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </div>
            <button disabled={busy} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">
              {busy ? "Signing in..." : "Sign in"}
            </button>
            <Link to="/forgot-password" className="block text-center text-sm text-slate-500 hover:underline">
              Forgot password?
            </Link>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <p className="text-sm text-slate-600">We've sent a 6-digit verification code to your registered email.</p>
            <input
              type="text"
              maxLength={6}
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className="w-full text-center tracking-[0.5em] text-lg rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="______"
            />
            <button disabled={busy} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">
              {busy ? "Verifying..." : "Verify & Continue"}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={handleResendOtp} disabled={busy} className="text-brand-600 hover:underline disabled:opacity-50">
                Resend code
              </button>
              <button
                type="button"
                onClick={() => {
                  setChallengeToken(null);
                  setOtp("");
                  setError(null);
                  setInfo(null);
                }}
                className="text-slate-500 hover:underline"
              >
                Use a different account
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
