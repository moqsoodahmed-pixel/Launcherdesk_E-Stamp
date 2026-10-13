import { Building2, Mail, MapPin, Phone, ReceiptText, Stamp } from "lucide-react";
import StatusChip from "../../components/ui/StatusChip";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";

function Field({ label, icon: IconCmp, children }) {
  return (
    <div className="flex gap-3">
      {IconCmp && <IconCmp size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />}
      <div className="min-w-0">
        <dt className="text-slate-600">{label}</dt>
        <dd className={`break-words font-medium ${children ? "text-slate-900" : "text-slate-500"}`}>{children || "Not provided"}</dd>
      </div>
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
    <div className="max-w-4xl">
      <PageHeader title="Company Profile" subtitle="Your organization's details" />
      {loading && <LoadingState text="Loading company profile..." />}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && !org && (
        <div className="card">
          <EmptyState title="No company linked" description="Your account is not linked to an organization." />
        </div>
      )}
      {!loading && !error && org && (
        <div className="space-y-6">
          <section className="card flex flex-wrap items-center gap-4 p-5 sm:p-6">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700" aria-hidden="true">
              <Building2 size={26} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="break-words font-display text-xl font-semibold text-slate-900">{org.name}</h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Member since <span className="tabular-nums">{org.createdAt ? new Date(org.createdAt).toLocaleDateString() : "Not provided"}</span>
              </p>
            </div>
            <StatusChip kind="account" status={org.status} label={org.status === "ACTIVE" ? "Active" : undefined} />
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <section className="card p-5 sm:p-6">
              <h3 className="mb-4 font-display text-base font-semibold text-slate-900">Contact</h3>
              <dl className="space-y-4 text-sm">
                <Field label="Contact email" icon={Mail}>{org.contactEmail}</Field>
                <Field label="Contact phone" icon={Phone}>{org.contactPhone}</Field>
                <Field label="Address" icon={MapPin}>{org.address}</Field>
              </dl>
            </section>
            <section className="card p-5 sm:p-6">
              <h3 className="mb-4 font-display text-base font-semibold text-slate-900">Registration</h3>
              <dl className="space-y-4 text-sm">
                <Field label="GSTIN" icon={ReceiptText}>{org.gstin}</Field>
                <Field label="E-Stamp service" icon={Stamp}>{org.isEstampServiceEnabled ? "Enabled" : "Disabled"}</Field>
              </dl>
            </section>
          </div>
          <p className="text-sm text-slate-600">To change company details contact support.</p>
        </div>
      )}
    </div>
  );
}
