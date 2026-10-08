import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

// @launcherdesk/shared is a CommonJS package Rollup's production build
// cannot statically analyze for named imports (see ReportsPage.jsx's
// identical note) - the one permission value this page needs is mirrored
// here in sync with packages/shared/src/permissions.js's
// DEFAULT_ROLE_PERMISSIONS. If that file's audit.view defaults ever change,
// update this map to match.
const AUDIT_VIEW = "audit.view";
const ROLE_HAS_AUDIT_VIEW_BY_DEFAULT = {
  MASTER_ADMIN: true, // all-permissions rule
  SUPER_ADMIN: true,
  ADMIN: true,
  USER: false,
};

function hasEffectivePermission(user, permission) {
  if (!user) return false;
  const own = user.permissions || [];
  if (user.role === "ASSISTANT_MASTER_ADMIN") return own.includes(permission);
  return !!ROLE_HAS_AUDIT_VIEW_BY_DEFAULT[user.role] || own.includes(permission);
}

// Mirrors packages/shared/src/enums.js's AuditAction values - kept as a
// plain list (not imported) for the same bundler-interop reason as above.
// Not exhaustive by necessity (a new action added server-side should still
// be selectable via free text), so this list only seeds the dropdown.
const ACTION_OPTIONS = [
  "LOGIN",
  "LOGOUT",
  "LOGIN_FAILED",
  "OTP_SENT",
  "OTP_VERIFIED",
  "OTP_FAILED",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_RESET_COMPLETED",
  "USER_CREATED",
  "USER_MODIFIED",
  "USER_DEACTIVATED",
  "ORG_CREATED",
  "ORG_MODIFIED",
  "ORG_STATUS_CHANGED",
  "BALANCE_CHANGED",
  "PAYMENT_VERIFIED",
  "ESTAMP_REQUEST_CREATED",
  "ESTAMP_REQUEST_MODIFIED",
  "ESTAMP_REQUEST_CANCELLED",
  "ESTAMP_REQUEST_LOCKED",
  "ESTAMP_UPLOADED",
  "ESTAMP_DOWNLOADED",
  "ESTAMP_ISSUED",
  "ESTAMP_PROCESSING_FAILED",
  "ORDER_MODIFIED",
  "ORDER_VIEWED",
  "SETTINGS_CHANGED",
  "BULK_BATCH_CONFIRMED",
  "BULK_BATCH_COMPLETED",
];

const DATE_PRESETS = [
  { value: "", label: "All time" },
  { value: "last7days", label: "Last 7 days" },
  { value: "last30days", label: "Last 30 days" },
  { value: "custom", label: "Custom range" },
];

function presetToRange(preset) {
  const now = new Date();
  if (preset === "last7days") {
    return { dateFrom: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), dateTo: undefined };
  }
  if (preset === "last30days") {
    return { dateFrom: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), dateTo: undefined };
  }
  return { dateFrom: undefined, dateTo: undefined };
}

function actorTypeBadgeClass(actorType) {
  return actorType === "SYSTEM" ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600";
}

export default function AuditLogsPage() {
  const { user } = useAuth();
  const canView = hasEffectivePermission(user, AUDIT_VIEW);
  const isMasterAdmin = user?.role === "MASTER_ADMIN";
  const isInternal = user?.role === "MASTER_ADMIN" || user?.role === "ASSISTANT_MASTER_ADMIN";
  // Only Master Admin may omit organizationId (genuinely global). Every
  // other actor holding audit.view - a tenant SUPER_ADMIN/ADMIN (forced to
  // their own org server-side regardless of anything supplied here) or an
  // Assistant Master Admin (who MUST supply one) - never gets a silent
  // global view.
  const orgRequiredForInternal = isInternal && !isMasterAdmin;

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [preset, setPreset] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const dateRange = preset === "custom" ? { dateFrom: customFrom || undefined, dateTo: customTo || undefined } : presetToRange(preset);
  const canLoad = !orgRequiredForInternal || !!organizationId.trim();

  const load = useCallback(() => {
    if (!canView || !canLoad) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    apiClient
      .get("/audit", {
        params: {
          page,
          limit,
          action: action || undefined,
          entityType: entityType || undefined,
          organizationId: isInternal ? organizationId.trim() || undefined : undefined,
          ...dateRange,
        },
      })
      .then((r) => {
        setItems(r.data.data.items);
        setTotal(r.data.data.total);
      })
      .catch((err) => {
        setError(err?.response?.status === 403 ? "You do not have permission to view audit logs." : err?.response?.data?.message || "Failed to load audit logs.");
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, action, entityType, organizationId, preset, customFrom, customTo, canView, canLoad]);

  useEffect(() => {
    load();
  }, [load]);

  function resetPage(setter) {
    return (value) => {
      setPage(1);
      setter(value);
    };
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (!canView) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-4">Audit Logs</h1>
        <div className="rounded-lg bg-amber-50 text-amber-700 text-sm px-3 py-2">You do not have permission to view audit logs.</div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Audit Logs</h1>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        {isInternal && (
          <input
            placeholder={orgRequiredForInternal ? "Organization ID (required)" : "Organization ID (optional filter)"}
            value={organizationId}
            onChange={(e) => resetPage(setOrganizationId)(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        )}
        <select value={action} onChange={(e) => resetPage(setAction)(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="">All actions</option>
          {ACTION_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          placeholder="Entity type (e.g. EStampOrder)"
          value={entityType}
          onChange={(e) => resetPage(setEntityType)(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select value={preset} onChange={(e) => resetPage(setPreset)(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          {DATE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {preset === "custom" && (
          <>
            <input type="date" value={customFrom} onChange={(e) => resetPage(setCustomFrom)(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <span className="text-slate-400 text-sm">to</span>
            <input type="date" value={customTo} onChange={(e) => resetPage(setCustomTo)(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </>
        )}
        <button onClick={load} className="text-sm text-slate-500 hover:underline">
          Refresh
        </button>
      </div>

      {orgRequiredForInternal && !organizationId.trim() && (
        <div className="rounded-lg bg-amber-50 text-amber-700 text-sm px-3 py-2 mb-4">
          Enter a specific organization's ID above to view its audit log - you do not hold platform-wide audit access.
        </div>
      )}

      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {canLoad && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">When</th>
                <th className="text-left px-4 py-3">Action</th>
                <th className="text-left px-4 py-3">Actor</th>
                <th className="text-left px-4 py-3">Entity</th>
                <th className="text-left px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && !error && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    No audit entries match these filters.
                  </td>
                </tr>
              )}
              {items.map((entry) => (
                <tr key={entry._id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{entry.action}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs mr-2 ${actorTypeBadgeClass(entry.actorType)}`}>{entry.actorType || "USER"}</span>
                    <span className="text-slate-500">{entry.actorRole}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {entry.entityType || "-"}
                    {entry.entityId ? ` #${entry.entityId}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelected(entry)} className="text-brand-600 hover:underline">
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canLoad && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="space-x-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
              Previous
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}

      {selected && <AuditDetailModal entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// The backend is the actual security boundary (metadata never contains
// secrets - see the Phase 15 secret-leakage sweep test) - this is a plain
// key:value rendering, not a redaction layer.
function AuditDetailModal({ entry, onClose }) {
  const metadataEntries = entry.metadata && typeof entry.metadata === "object" ? Object.entries(entry.metadata) : [];
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">Audit entry detail</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <dl className="space-y-2 text-sm">
          <Row label="Action" value={entry.action} />
          <Row label="When" value={new Date(entry.createdAt).toLocaleString()} />
          <Row label="Actor role" value={entry.actorRole} />
          <Row label="Actor type" value={entry.actorType || "USER"} />
          <Row label="Actor ID" value={entry.actorId || "(system - no human actor)"} />
          <Row label="Organization" value={entry.organizationId || "-"} />
          <Row label="Entity type" value={entry.entityType || "-"} />
          <Row label="Entity ID" value={entry.entityId || "-"} />
          <Row label="IP" value={entry.ip || "-"} />
          <Row label="User agent" value={entry.userAgent || "-"} />
        </dl>
        {metadataEntries.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Metadata</p>
            <dl className="space-y-1 text-sm">
              {metadataEntries.map(([k, v]) => (
                <Row key={k} label={k} value={typeof v === "object" ? JSON.stringify(v) : String(v)} />
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900 text-right break-all">{value}</dd>
    </div>
  );
}
