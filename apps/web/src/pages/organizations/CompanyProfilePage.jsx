import { useRef, useState } from "react";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/errors";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";
import OrganizationLogo from "../../components/common/OrganizationLogo";

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900 break-words">{children || "Not provided"}</dd>
    </div>
  );
}

const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg"];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

// Logo upload/removal - Super Admin only (see profile.routes.js's
// requireRole gate); every other tenant role only ever sees the result,
// never this control.
function LogoEditor({ org, onChanged }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    setError(null);
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setError("Logo must be a PNG or JPEG image.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("Logo must be 2MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await apiClient.post("/profile/organization/logo", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onChanged(data.data);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to upload logo."));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiClient.delete("/profile/organization/logo");
      onChanged(data.data);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to remove logo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <OrganizationLogo logoUrl={org.logoUrl} name={org.name} size={64} />
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 font-medium disabled:opacity-50"
          >
            {busy ? "Uploading..." : org.logoUrl ? "Change logo" : "Upload logo"}
          </button>
          {org.logoUrl && (
            <button type="button" disabled={busy} onClick={handleRemove} className="text-sm text-slate-500 hover:underline disabled:opacity-50">
              Remove
            </button>
          )}
          <input ref={inputRef} type="file" accept="image/png,image/jpeg" onChange={handleFile} className="hidden" aria-label="Upload company logo" />
        </div>
        <p className="text-xs text-slate-400">PNG or JPEG, up to 2MB. Shown throughout the dashboard wherever your organization appears.</p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

// Mostly read-only view of the caller's own organization (GET
// /profile/organization) - the one editable part is the logo, gated to
// Super Admin server-side (see profile.routes.js).
export default function CompanyProfilePage() {
  const { user } = useAuth();
  const canEditLogo = user?.role === "SUPER_ADMIN";
  const { data: org, loading, error, refetch, setData } = useApi(
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

  function handleLogoChanged(updated) {
    setData((prev) => (prev ? { ...prev, logoUrl: updated.logoUrl } : prev));
  }

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
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
          <div>
            <dt className="text-slate-500 text-sm mb-2">Company logo</dt>
            {canEditLogo ? (
              <LogoEditor org={org} onChanged={handleLogoChanged} />
            ) : (
              <div className="flex items-center gap-3">
                <OrganizationLogo logoUrl={org.logoUrl} name={org.name} size={64} />
                {!org.logoUrl && <p className="text-xs text-slate-400">No logo uploaded yet. Ask your Super Admin to add one.</p>}
              </div>
            )}
          </div>
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
          <p className="text-xs text-slate-500">To change company details contact support.</p>
        </section>
      )}
    </div>
  );
}
