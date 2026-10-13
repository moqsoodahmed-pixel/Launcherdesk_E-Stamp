import { Link, useLocation } from "react-router-dom";
import AuthLayout from "../components/brand/AuthLayout";

const PRIMARY = "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700";

export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <AuthLayout>
      <p className="mb-2 font-display text-sm font-semibold text-brand-700 tabular-nums">404</p>
      <h1 className="mb-2 font-display text-3xl font-semibold text-slate-900">Page not found</h1>
      <p className="mb-8 break-all text-sm text-slate-600">
        Nothing exists at <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-800">{pathname}</code>.
      </p>
      <Link to="/dashboard" className={PRIMARY}>
        Back to Dashboard
      </Link>
    </AuthLayout>
  );
}
