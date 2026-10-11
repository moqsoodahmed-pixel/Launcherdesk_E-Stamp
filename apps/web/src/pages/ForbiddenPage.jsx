import { Link } from "react-router-dom";

export default function ForbiddenPage() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
      <h1 className="text-xl font-semibold text-slate-900 mb-2">You don't have access</h1>
      <p className="text-sm text-slate-500 mb-6">Your account doesn't have permission to open this page. Ask your administrator if you need it.</p>
      <Link to="/dashboard" className="inline-block bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
        Back to Dashboard
      </Link>
    </div>
  );
}
