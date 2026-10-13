import AuthLayout from "../components/brand/AuthLayout";

// Shown instead of the app when a production build was made without
// VITE_API_BASE_URL - otherwise every request would silently go to
// http://localhost:5000 on the visitor's own machine and fail mysteriously.
export default function ConfigErrorPage() {
  return (
    <AuthLayout role="alert">
      <h1 className="mb-2 font-display text-3xl font-semibold text-slate-900">Configuration error</h1>
      <p className="mb-3 text-sm text-slate-700">This site was built without its API address, so it cannot connect to the server.</p>
      <p className="rounded-lg border border-vermilion-200 bg-vermilion-50 px-3 py-2.5 text-sm text-vermilion-800">
        Administrator: set the <code className="font-medium">VITE_API_BASE_URL</code> build variable (for example{" "}
        <code className="font-medium">https://your-api-host/api/v1</code>) in the hosting settings and redeploy.
      </p>
    </AuthLayout>
  );
}
