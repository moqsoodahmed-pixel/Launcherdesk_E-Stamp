import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { safeNextPath } from "./LoginPage";
import ChangePasswordForm from "../../components/common/ChangePasswordForm";

export default function ChangePasswordPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const forced = !!user?.mustChangePassword;
  const from = location.state?.from;
  const nextPath = safeNextPath(from ? `${from.pathname}${from.search || ""}` : null);

  function handleSuccess() {
    navigate(nextPath === "/change-password" ? "/dashboard" : nextPath, { replace: true, state: { passwordChanged: true } });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-2xl font-semibold text-slate-900 mb-1">Change password</h1>
        <p className="text-sm text-slate-500 mb-6">LauncherDesk E-Stamping Platform</p>
        {forced && (
          <p className="text-sm text-slate-600 mb-4">You signed in with a temporary password. Choose a new password to continue.</p>
        )}
        <ChangePasswordForm onSuccess={handleSuccess} />
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
