import AuthLayout from "../../components/brand/AuthLayout";
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
    <AuthLayout title="Change password" subtitle="LauncherDesk E-Stamping Platform">
        {forced && (
          <p className="text-sm text-slate-600 mb-4">You signed in with a temporary password. Choose a new password to continue.</p>
        )}
        <ChangePasswordForm onSuccess={handleSuccess} />
        <div className="mt-6 flex justify-between text-sm">
          {!forced ? (
            <button type="button" onClick={() => navigate(-1)} className="min-h-[44px] text-slate-600 hover:underline">
              Cancel
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={() => logout()} className="min-h-[44px] font-medium text-red-700 hover:underline">
            Log out
          </button>
        </div>
    </AuthLayout>
  );
}
