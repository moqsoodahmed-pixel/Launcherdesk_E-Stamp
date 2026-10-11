import { Link, useLocation } from "react-router-dom";

export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <p className="text-sm font-semibold text-brand-600 mb-1">404</p>
        <h1 className="text-xl font-semibold text-slate-900 mb-2">Page not found</h1>
        <p className="text-sm text-slate-500 mb-6 break-all">
          Nothing exists at <code className="text-slate-700">{pathname}</code>.
        </p>
        <Link to="/dashboard" className="inline-block bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
