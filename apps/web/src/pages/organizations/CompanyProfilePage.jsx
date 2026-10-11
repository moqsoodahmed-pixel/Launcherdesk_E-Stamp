import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900 break-words">{children || "Not provided"}</dd>
    </div>
  );
}

// Read-only view of the caller's own organization (GET /profile/organization).
// A 404 means the account has no organization, shown as an empty state.
export default function CompanyProfilePage() {
  const { data: org, loading, error, refetch } = useApi(
    (signal) =>
      apiClient
        .get("/profile/organization", { signal })
        .then((r) => r.data.data)
        .catch((err) => {
          if (err?.response?.status === 404) return null;
          throw err;
        }),
    [],
    { errorMessage: "Failed to load your company profile." }
  );

  return (
    <div className="max-w-3xl">
      <PageHeader title="Company Profile" subtitle="Your organization's details" />
      {loading && <LoadingState text="Loading company profile..." />}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && !org && (
        <div className="bg-white rounded-xl border border-slate-200">
          <EmptyState title="No company linked" description="Your account is not linked to an organization." />
        </div>
      )}
      {!loading && !error && org && (
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Field label="Company name">{org.name}</Field>
            <Field label="Status">{org.status}</Field>
            <Field label="Contact email">{org.contactEmail}</Field>
            <Field label="Contact phone">{org.contactPhone}</Field>
            <Field label="GSTIN">{org.gstin}</Field>
            <Field label="E-Stamp service">{org.isEstampServiceEnabled ? "Enabled" : "Disabled"}</Field>
            <div className="sm:col-span-2">
              <Field label="Address">{org.address}</Field>
            </div>
            <Field label="Member since">{org.createdAt ? new Date(org.createdAt).toLocaleDateString() : null}</Field>
          </dl>
          <p className="mt-6 text-xs text-slate-500">To change company details contact support.</p>
        </section>
      )}
    </div>
  );
}
