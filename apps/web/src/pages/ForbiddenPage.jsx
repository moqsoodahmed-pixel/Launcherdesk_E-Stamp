import { Link } from "react-router-dom";
import AuthLayout from "../components/brand/AuthLayout";

const PRIMARY = "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700";

export default function ForbiddenPage() {
  return (
    <AuthLayout inline>
      <p className="mb-2 font-display text-sm font-semibold text-brand-700 tabular-nums">403</p>
      <h1 className="mb-2 font-display text-2xl font-semibold text-slate-900">You don't have access</h1>
      <p className="mb-8 text-sm text-slate-600">Your account doesn't have permission to open this page. Ask your administrator if you need it.</p>
      <Link to="/dashboard" className={PRIMARY}>
        Back to Dashboard
      </Link>
    </AuthLayout>
  );
}
