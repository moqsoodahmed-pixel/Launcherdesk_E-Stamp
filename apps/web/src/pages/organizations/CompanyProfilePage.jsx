import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";

function Row({ label, value }) {
  return (
    <div className="py-3 grid grid-cols-3 gap-4 border-b border-slate-100 last:border-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="col-span-2 text-sm text-slate-900 break-words">{value || "-"}</dd>
    </div>
  );
}

export default function CompanyProfilePage() {
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function load() {
    setLoading(true);
    setError(null);
    apiClient
      .get("/profile/organization")
      .then(({ data }) => setOrg(data.data))
      .catch((err) => setError(err?.response?.data?.message || "Failed to load company profile."))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  if (loading) return <p className="text-sm text-slate-500">Loading company profile...</p>;
  if (error)
    return (
      <div className="rounded-lg bg-red-50 text-red-700 text-sm p-4">
        {error}{" "}
        <button type="button" onClick={load} className="underline font-medium">
          Retry
        </button>
      </div>
    );

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Company Profile</h1>
      <div className="bg-white rounded-xl border border-slate-200 px-6">
        <dl>
          <Row label="Company name" value={org.name} />
          <Row label="Status" value={String(org.status || "").replace(/_/g, " ")} />
          <Row label="Contact email" value={org.contactEmail} />
          <Row label="Contact phone" value={org.contactPhone} />
          <Row label="GSTIN" value={org.gstin} />
          <Row label="Address" value={org.address} />
          <Row label="E-Stamp service" value={org.isEstampServiceEnabled ? "Enabled" : "Not enabled"} />
          <Row label="Member since" value={org.createdAt ? new Date(org.createdAt).toLocaleDateString() : ""} />
        </dl>
      </div>
      <p className="text-xs text-slate-500 mt-3">To change company details, contact LauncherDesk support.</p>
    </div>
  );
}
