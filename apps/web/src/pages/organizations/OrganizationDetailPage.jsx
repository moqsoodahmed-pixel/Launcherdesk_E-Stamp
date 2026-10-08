import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { formatCurrency } from "../../utils/format";

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

  const [showProvision, setShowProvision] = useState(false);
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
        setEditForm({
          name: res.data.data.organization.name,
          contactEmail: res.data.data.organization.contactEmail,
          contactPhone: res.data.data.organization.contactPhone,
          gstin: res.data.data.organization.gstin || "",
          address: res.data.data.organization.address || "",
        });
      })
      .catch((err) => setError(err?.response?.data?.message || "Failed to load organization."))
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
      setError(err?.response?.data?.message || "Failed to update organization.");
    } finally {
      setSavingEdit(false);
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
      setError(err?.response?.data?.message || "Failed to change status.");
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleProvisionSuperAdmin(e) {
    e.preventDefault();
    setProvisionBusy(true);
    setProvisionError(null);
    try {
      const { data: result } = await apiClient.post(`/organizations/${id}/super-admin`, provisionForm);
      setProvisionResult(result.data);
      load();
    } catch (err) {
      setProvisionError(err?.response?.data?.message || "Failed to provision Super Admin.");
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

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-4">Super Admin</h2>
          {superAdmin ? (
            <dl className="text-sm space-y-2">
              <Row label="Name" value={superAdmin.name} />
              <Row label="Email" value={superAdmin.email} />
              <Row label="Status" value={superAdmin.isActive ? "Active" : "Inactive"} />
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
                  <p className="font-mono font-semibold">{provisionResult.tempPassword}</p>
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
            <p className="text-2xl font-semibold text-slate-900">{formatCurrency(wallet.balance)}</p>
          ) : (
            <p className="text-sm text-slate-500">No wallet found.</p>
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
