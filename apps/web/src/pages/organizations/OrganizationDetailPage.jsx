import { useEffect, useState, useCallback } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { formatCurrency } from "../../utils/format";
import { getErrorMessage } from "../../utils/errors";
import { useAuth } from "../../context/AuthContext";
import AssignedAssistantSelect from "../../components/organizations/AssignedAssistantSelect";
import TemporaryPasswordCell from "../../components/common/TemporaryPasswordCell";
import { CopyButton } from "../../components/vendor/vendorUi";

const STATUS_OPTIONS = ["ACTIVE", "PENDING_APPROVAL", "RESTRICTED", "SUSPENDED", "DEACTIVATED"];

export default function OrganizationDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [statusBusy, setStatusBusy] = useState(false);
  // PATCH /organizations/:id/status and /:id/estamp-service are both
  // Master-Admin-only (requireRole) - no other role can ever grant this.
  const { user } = useAuth();
  const canChangeStatus = user?.role === "MASTER_ADMIN";

  const [estampBusy, setEstampBusy] = useState(false);

  const [assistantChoice, setAssistantChoice] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState(null);

  // "Create login" from the organizations list opens the provisioning form.
  const [searchParams] = useSearchParams();
  const [showProvision, setShowProvision] = useState(searchParams.get("provision") === "1");
  const [provisionForm, setProvisionForm] = useState({ name: "", email: "", phone: "" });
  const [provisionResult, setProvisionResult] = useState(null);
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [provisionError, setProvisionError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .get(`/organizations/${id}`)
      .then((res) => {
        setData(res.data.data);
        setAssistantChoice(res.data.data.assignedAssistant?._id || "");
        setEditForm({
          name: res.data.data.organization.name,
          contactEmail: res.data.data.organization.contactEmail,
          contactPhone: res.data.data.organization.contactPhone,
          gstin: res.data.data.organization.gstin || "",
          address: res.data.data.organization.address || "",
        });
      })
      .catch((err) => setError(getErrorMessage(err, "Failed to load organization.")))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSaveEdit(e) {
    e.preventDefault();
    setSavingEdit(true);
    setError(null);
    try {
      await apiClient.patch(`/organizations/${id}`, editForm);
      setEditing(false);
      setNotice("Organization updated.");
      load();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update organization."));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleAssign(e) {
    e.preventDefault();
    setAssignBusy(true);
    setAssignError(null);
    try {
      await apiClient.patch(`/organizations/${id}/assigned-assistant`, { assistantId: assistantChoice || null });
      setNotice(assistantChoice ? "Assigned assistant saved." : "Assistant unassigned. Only Master Admins handle this client now.");
      load();
    } catch (err) {
      setAssignError(getErrorMessage(err, "Failed to save the assigned assistant."));
    } finally {
      setAssignBusy(false);
    }
  }

  async function handleStatusChange(newStatus) {
    if (!window.confirm(`Change organization status to ${newStatus.replace(/_/g, " ")}? Client users may lose access immediately.`)) {
      return;
    }
    setStatusBusy(true);
    setError(null);
    try {
      await apiClient.patch(`/organizations/${id}/status`, { status: newStatus });
      setNotice(`Status changed to ${newStatus.replace(/_/g, " ")}.`);
      load();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to change status."));
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleToggleEstampService(nextEnabled) {
    const verb = nextEnabled ? "Enable" : "Disable";
    if (!window.confirm(`${verb} E-Stamp service for this organization?`)) return;
    setEstampBusy(true);
    setError(null);
    try {
      await apiClient.patch(`/organizations/${id}/estamp-service`, { enabled: nextEnabled });
      setNotice(`E-Stamp service ${nextEnabled ? "enabled" : "disabled"}.`);
      load();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to change E-Stamp service."));
    } finally {
      setEstampBusy(false);
    }
  }

  async function handleProvisionSuperAdmin(e) {
    e.preventDefault();
    setProvisionBusy(true);
    setProvisionError(null);
    try {
      // Phone is optional but must be >= 6 chars when present - omit an empty box.
      const body = { name: provisionForm.name.trim(), email: provisionForm.email.trim() };
      if (provisionForm.phone.trim()) body.phone = provisionForm.phone.trim();
      const { data: result } = await apiClient.post(`/organizations/${id}/super-admin`, body);
      setProvisionResult(result.data);
      load();
    } catch (err) {
      setProvisionError(getErrorMessage(err, "Failed to provision Super Admin."));
    } finally {
      setProvisionBusy(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (error && !data) return <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>;
  if (!data) return null;

  const { organization: org, wallet, superAdmin, userCounts, activity } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/organizations" className="text-sm text-slate-500 hover:underline">
            ← Organizations
          </Link>
          <h1 className="text-xl font-semibold text-slate-900 mt-1">{org.name}</h1>
        </div>
        <span className="inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">{org.status.replace(/_/g, " ")}</span>
      </div>

      {notice && <div className="rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{notice}</div>}
      {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium text-slate-900">Organization Information</h2>
            {!editing && (
              <button onClick={() => setEditing(true)} className="text-sm text-brand-600 hover:underline">
                Edit
              </button>
            )}
          </div>
          {!editing ? (
            <dl className="text-sm space-y-2">
              <Row label="Contact email" value={org.contactEmail} />
              <Row label="Contact phone" value={org.contactPhone} />
              <Row label="GSTIN" value={org.gstin || "-"} />
              <Row label="Address" value={org.address || "-"} />
              <Row label="Created" value={new Date(org.createdAt).toLocaleString()} />
            </dl>
          ) : (
            <form onSubmit={handleSaveEdit} className="space-y-3">
              <Field label="Name" value={editForm.name} onChange={(v) => setEditForm((f) => ({ ...f, name: v }))} />
              <Field label="Contact email" type="email" value={editForm.contactEmail} onChange={(v) => setEditForm((f) => ({ ...f, contactEmail: v }))} />
              <Field label="Contact phone" value={editForm.contactPhone} onChange={(v) => setEditForm((f) => ({ ...f, contactPhone: v }))} />
              <Field label="GSTIN" value={editForm.gstin} onChange={(v) => setEditForm((f) => ({ ...f, gstin: v }))} />
              <Field label="Address" value={editForm.address} onChange={(v) => setEditForm((f) => ({ ...f, address: v }))} />
              <div className="flex gap-2">
                <button disabled={savingEdit} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                  {savingEdit ? "Saving..." : "Save"}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="text-sm text-slate-500 hover:underline">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {canChangeStatus && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-4">Status Management</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                disabled={statusBusy || s === org.status}
                onClick={() => handleStatusChange(s)}
                className="text-xs rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
              >
                {s.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Changing status away from ACTIVE immediately blocks this organization's users from authenticating or using protected APIs.
          </p>
        </div>
        )}

        {canChangeStatus && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-4">E-Stamp Service</h2>
          <p className="text-sm text-slate-600 mb-4">
            Currently <span className={`font-medium ${org.isEstampServiceEnabled ? "text-green-700" : "text-red-700"}`}>{org.isEstampServiceEnabled ? "Enabled" : "Disabled"}</span> for this organization.
          </p>
          <button
            disabled={estampBusy}
            onClick={() => handleToggleEstampService(!org.isEstampServiceEnabled)}
            className={`text-sm rounded-lg px-4 py-2 font-medium disabled:opacity-50 ${
              org.isEstampServiceEnabled ? "border border-red-300 text-red-700 hover:bg-red-50" : "bg-brand-600 hover:bg-brand-700 text-white"
            }`}
          >
            {estampBusy ? "Saving..." : org.isEstampServiceEnabled ? "Disable E-Stamp Service" : "Enable E-Stamp Service"}
          </button>
          <p className="text-xs text-slate-500 mt-3">
            Until this is enabled, users in this organization cannot create E-Stamp requests.
          </p>
        </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-4">Super Admin</h2>
          {superAdmin ? (
            <dl className="text-sm space-y-2">
              <Row label="Name" value={superAdmin.name} />
              <Row label="Email" value={superAdmin.email} />
              <Row label="Status" value={superAdmin.isActive ? "Active" : "Inactive"} />
              {user?.role === "MASTER_ADMIN" && superAdmin._id && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Password</dt>
                  <dd>
                    <TemporaryPasswordCell userId={superAdmin._id} passwordState={superAdmin.passwordState} setByLabel="Set by user" label={`password for ${superAdmin.email}`} />
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <div>
              <p className="text-sm text-slate-500 mb-3">No Super Admin has been provisioned yet.</p>
              {!showProvision && !provisionResult && (
                <button onClick={() => setShowProvision(true)} className="text-sm text-brand-600 hover:underline">
                  Provision initial Super Admin
                </button>
              )}
              {showProvision && !provisionResult && (
                <form onSubmit={handleProvisionSuperAdmin} className="space-y-3 mt-2">
                  {provisionError && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{provisionError}</div>}
                  <Field label="Name" value={provisionForm.name} onChange={(v) => setProvisionForm((f) => ({ ...f, name: v }))} />
                  <Field label="Email" type="email" value={provisionForm.email} onChange={(v) => setProvisionForm((f) => ({ ...f, email: v }))} />
                  <Field label="Phone (optional)" value={provisionForm.phone} onChange={(v) => setProvisionForm((f) => ({ ...f, phone: v }))} />
                  <button disabled={provisionBusy} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                    {provisionBusy ? "Provisioning..." : "Provision Super Admin"}
                  </button>
                </form>
              )}
              {provisionResult && (
                <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2 space-y-1">
                  <p>Super Admin created. Share this temporary password securely - it will not be shown again:</p>
                  <p className="font-mono font-semibold">
                    {provisionResult.tempPassword}
                    <CopyButton value={provisionResult.tempPassword} label="temporary password" />
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-4">Users</h2>
          <dl className="text-sm space-y-2">
            <Row label="Super Admins" value={userCounts.SUPER_ADMIN} />
            <Row label="Admins" value={userCounts.ADMIN} />
            <Row label="Users" value={userCounts.USER} />
            <Row label="Total active" value={userCounts.totalActive} />
            <Row label="Total users" value={userCounts.totalUsers} />
          </dl>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-4">Wallet</h2>
          {wallet ? (
            <>
              <p className="text-xs text-slate-500">Available</p>
              <p className="text-2xl font-semibold text-slate-900">{formatCurrency(wallet.availableBalance ?? wallet.balance)}</p>
              {wallet.reservedBalance !== undefined && (
                <dl className="text-sm space-y-2 mt-3">
                  <Row label="Balance" value={formatCurrency(wallet.balance)} />
                  <Row label="Reserved (requests in window)" value={formatCurrency(wallet.reservedBalance)} />
                </dl>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">No wallet found.</p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-4">Assigned assistant</h2>
          {canChangeStatus ? (
            <form onSubmit={handleAssign} className="space-y-3">
              {assignError && (
                <div role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
                  {assignError}
                </div>
              )}
              <p className="text-sm text-slate-600">
                Current: <span className="font-medium text-slate-900">{data.assignedAssistant ? `${data.assignedAssistant.name} (${data.assignedAssistant.email})` : "None"}</span>
              </p>
              <AssignedAssistantSelect value={assistantChoice} onChange={setAssistantChoice} disabled={assignBusy} label="Change assigned assistant" />
              <button disabled={assignBusy || assistantChoice === (data.assignedAssistant?._id || "")} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                {assignBusy ? "Saving..." : "Save assignment"}
              </button>
            </form>
          ) : (
            <p className="text-sm text-slate-900">{data.assignedAssistant ? `${data.assignedAssistant.name} (${data.assignedAssistant.email})` : "None"}</p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-4">E-Stamp Activity</h2>
          <dl className="text-sm space-y-2">
            <Row label="E-Stamp requests" value={activity.estampRequestCount} />
            <Row label="Orders" value={activity.orderCount} />
          </dl>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900 font-medium">{value}</dd>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  const id = `org-field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-700 mb-1">
        {label}
      </label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
    </div>
  );
}
