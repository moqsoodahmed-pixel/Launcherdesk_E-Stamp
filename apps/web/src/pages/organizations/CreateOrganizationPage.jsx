import { useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { getErrorMessage } from "../../utils/errors";
import { useAuth } from "../../context/AuthContext";
import AssignedAssistantSelect from "../../components/organizations/AssignedAssistantSelect";
import { CopyButton } from "../../components/vendor/vendorUi";

const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg"];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export default function CreateOrganizationPage() {
  const { user } = useAuth();
  // Only a Master Admin picks the assistant; an assistant creating a client
  // is assigned to it automatically by the server.
  const canAssign = user?.role === "MASTER_ADMIN";
  const [form, setForm] = useState({ name: "", contactEmail: "", contactPhone: "", gstin: "", address: "", superAdminName: "", activateNow: true, enableEstampService: true });
  // One-step onboarding result (organization + Super Admin + one-time
  // temporary password). Lives only in this component's state.
  const [result, setResult] = useState(null);
  const [assistantId, setAssistantId] = useState("");
  const [logoFile, setLogoFile] = useState(null);
  const [logoError, setLogoError] = useState(null);
  const [logoUploadFailed, setLogoUploadFailed] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleLogoChange(e) {
    const file = e.target.files?.[0] || null;
    setLogoError(null);
    if (!file) {
      setLogoFile(null);
      return;
    }
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setLogoError("Logo must be a PNG or JPEG image.");
      setLogoFile(null);
      e.target.value = "";
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("Logo must be 2MB or smaller.");
      setLogoFile(null);
      e.target.value = "";
      return;
    }
    setLogoFile(file);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    // A company logo is required at setup - every organization must be
    // created with branding from day one, not left to configure later.
    if (!logoFile) {
      setLogoError("A company logo is required to create an organization.");
      return;
    }
    setBusy(true);
    try {
      const body = canAssign && assistantId ? { ...form, assignedAssistantId: assistantId } : form;
      const { data } = await apiClient.post("/organizations", body);
      const organization = data.data.organization;
      try {
        const logoForm = new FormData();
        logoForm.append("file", logoFile);
        const { data: logoRes } = await apiClient.post(`/organizations/${organization._id}/logo`, logoForm, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        organization.logoUrl = logoRes.data.logoUrl;
      } catch (logoErr) {
        // The organization itself is already created at this point (same
        // "non-fatal follow-up step" treatment as the welcome email below) -
        // surfaced clearly on the result screen rather than losing the logo
        // upload failure silently.
        setLogoUploadFailed(true);
      }
      setResult({ ...data.data, organization });
    } catch (err) {
      const flat = err?.response?.data?.details;
      if (flat?.fieldErrors) {
        const firstField = Object.keys(flat.fieldErrors)[0];
        setError(`${firstField}: ${flat.fieldErrors[firstField][0]}`);
      } else {
        setError(getErrorMessage(err, "Failed to create organization."));
      }
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Organization created</h1>
        <section aria-label="Organization created" className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3 text-sm">
          <p>
            <b>{result.organization.name}</b> is {result.organization.status === "ACTIVE" ? "active" : "pending approval"}
            {result.organization.isEstampServiceEnabled ? " with the E-Stamp service enabled." : "; the E-Stamp service is off."}
          </p>
          <p>
            Super Admin login: <b>{result.superAdmin.email}</b>
          </p>
          {result.emailSent ? (
            <p className="text-green-700">A welcome email was sent to {result.superAdmin.email} (it contains no password).</p>
          ) : (
            <p role="alert" className="text-amber-700">
              The welcome email could not be sent. Share the login details with the client another way.
            </p>
          )}
          {logoUploadFailed && (
            <p role="alert" className="text-amber-700">
              The organization was created, but the logo upload failed. You can add it from the organization's detail page.
            </p>
          )}
          <div className="rounded-lg bg-amber-50 border-2 border-amber-300 p-3">
            <p className="font-medium text-amber-900">Temporary password</p>
            <p className="mt-1">
              <code className="font-mono text-base text-amber-950">{result.tempPassword}</code>
              <CopyButton value={result.tempPassword} label="temporary password" />
            </p>
            <p className="text-xs text-amber-800 mt-1">Share it privately; they must change it at first login. They can also use Forgot password.</p>
          </div>
          <div className="flex gap-3 pt-2">
            <Link to={`/organizations/${result.organization._id}`} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
              Open organization
            </Link>
            <Link to="/organizations" className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
              Back to list
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">New Organization</h1>
        <Link to="/organizations" className="text-sm text-slate-500 hover:underline">
          Back to list
        </Link>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div>
          <label htmlFor="create-org-name" className="block text-sm font-medium text-slate-700 mb-1">
            Organization name
          </label>
          <input id="create-org-name" required minLength={2} value={form.name} onChange={(e) => update("name", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="create-org-email" className="block text-sm font-medium text-slate-700 mb-1">
              Contact email
            </label>
            <input id="create-org-email" required type="email" value={form.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label htmlFor="create-org-phone" className="block text-sm font-medium text-slate-700 mb-1">
              Contact phone
            </label>
            <input id="create-org-phone" required minLength={6} value={form.contactPhone} onChange={(e) => update("contactPhone", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>
        <div>
          <label htmlFor="create-org-logo" className="block text-sm font-medium text-slate-700 mb-1">
            Company logo <span className="text-red-600">*</span>
          </label>
          <input
            id="create-org-logo"
            type="file"
            accept="image/png,image/jpeg"
            onChange={handleLogoChange}
            className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
          />
          <p className="text-xs text-slate-500 mt-1">PNG or JPEG, up to 2MB. Required - shown throughout the dashboard wherever this organization appears.</p>
          {logoFile && <p className="text-xs text-green-700 mt-1">Selected: {logoFile.name}</p>}
          {logoError && <p className="text-xs text-red-600 mt-1">{logoError}</p>}
        </div>
        <div>
          <label htmlFor="create-org-super-admin" className="block text-sm font-medium text-slate-700 mb-1">
            Super Admin name
          </label>
          <input id="create-org-super-admin" required minLength={2} maxLength={150} value={form.superAdminName} onChange={(e) => update("superAdminName", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          <p className="text-xs text-slate-500 mt-1">The contact email becomes this person's login. They receive a welcome email and log in with a one-time code.</p>
        </div>
        <div className="flex flex-wrap gap-6 text-sm text-slate-700">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.activateNow} onChange={(e) => update("activateNow", e.target.checked)} />
            Activate now
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.enableEstampService} onChange={(e) => update("enableEstampService", e.target.checked)} />
            Enable E-Stamp service
          </label>
        </div>
        <div>
          <label htmlFor="create-org-gstin" className="block text-sm font-medium text-slate-700 mb-1">
            GSTIN (optional)
          </label>
          <input id="create-org-gstin" value={form.gstin} onChange={(e) => update("gstin", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label htmlFor="create-org-address" className="block text-sm font-medium text-slate-700 mb-1">
            Address (optional)
          </label>
          <textarea id="create-org-address" value={form.address} onChange={(e) => update("address", e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        {canAssign && <AssignedAssistantSelect value={assistantId} onChange={setAssistantId} disabled={busy} />}
        <button disabled={busy} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Creating..." : "Create organization"}
        </button>
      </form>
    </div>
  );
}
