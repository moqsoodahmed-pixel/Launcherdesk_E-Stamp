// Shown instead of the app when a production build was made without
// VITE_API_BASE_URL - otherwise every request would silently go to
// http://localhost:5000 on the visitor's own machine and fail mysteriously.
export default function ConfigErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
      <div role="alert" className="max-w-lg w-full bg-white rounded-2xl border border-red-200 p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">Configuration error</h1>
        <p className="text-sm text-slate-600 mb-3">This site was built without its API address, so it cannot connect to the server.</p>
        <p className="text-sm text-slate-500">
          Administrator: set the <code className="text-slate-800">VITE_API_BASE_URL</code> build variable (for example{" "}
          <code className="text-slate-800">https://your-api-host/api/v1</code>) in the hosting settings and redeploy.
        </p>
      </div>
    </div>
  );
}
