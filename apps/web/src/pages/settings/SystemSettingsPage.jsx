import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

// Phase 17 - Advanced System Settings & Configuration Management. Replaces
// the previous PlaceholderPage at /settings. This page ONLY ever talks to
// the settings API (GET /settings, PATCH /settings/:key), which structurally
// cannot return a secret since no secret/infrastructure value is ever stored
// as a SystemSetting row - see apps/api/src/config/settingsRegistry.js.
//
// @launcherdesk/shared is a CommonJS package Rollup's production build
// cannot statically analyze for named imports (see AuditLogsPage.jsx/
// PolicyAdminPage.jsx's identical note) - the permission values this page
// needs are mirrored here in sync with packages/shared/src/permissions.js's
// DEFAULT_ROLE_PERMISSIONS.
const SETTINGS_VIEW = "settings.view";
const SETTINGS_MANAGE = "settings.manage";
const ROLE_HAS_BY_DEFAULT = {
  // Only MASTER_ADMIN holds either by default (all-permissions rule) -
  // every other role, including ASSISTANT_MASTER_ADMIN, is explicit-grant-only.
  MASTER_ADMIN: true,
};

function hasEffectivePermission(user, permission) {
  if (!user) return false;
  const own = user.permissions || [];
  if (user.role === "ASSISTANT_MASTER_ADMIN") return own.includes(permission);
  return !!ROLE_HAS_BY_DEFAULT[user.role] || own.includes(permission);
}

// Settings whose change has a real, user-facing consequence - flipping a
// kill-switch or shortening/lengthening a customer-facing window. Shown with
// a from -> to confirmation dialog before submitting (Step 19). This is UX
// only - the backend's own validation/authorization is the real authority
// either way; the dialog just helps an admin avoid a surprising accidental
// change.
const HIGH_IMPACT_KEYS = new Set(["REQUEST_MODIFY_WINDOW_MINUTES", "BULK_ESTAMP_ENABLED", "REPORTS_ENABLED", "POLICY_ACKNOWLEDGEMENT_ENABLED"]);

const CATEGORY_LABELS = {
  BUSINESS: "Business Settings",
  FEATURE_FLAG: "Feature Flags",
};

// Per-key caveats for settings whose stored/displayed value is NOT actually
// what the running server enforces at the moment. BULK_ESTAMP_MAX_ROWS is
// genuinely live (bulk-estamp.service.js reads it via
// SettingsService.getBulkEstampMaxRows() on every upload), so it gets no
// caveat. BULK_ESTAMP_MAX_FILE_SIZE_MB is NOT wired the same way - multer's
// actual upload size limit (bulk-estamp.routes.js) is fixed from the
// BULK_ESTAMP_MAX_FILE_SIZE_MB *environment variable* at process start
// (config/env.js), so saving a new value here never changes what uploads the
// server actually accepts. The page's own banner below ("Changes take effect
// immediately... no cache delay") is true for every other setting but would
// be misleading for this one without this note.
const SETTING_CAVEATS = {
  BULK_ESTAMP_MAX_FILE_SIZE_MB:
    "Note: the upload size actually enforced by the server is controlled by the BULK_ESTAMP_MAX_FILE_SIZE_MB environment variable at deploy time, not by this value. Saving a change here does not change what the server accepts until that environment variable is also updated and the server restarted.",
};

function formatValue(entry) {
  if (entry.valueType === "BOOLEAN") return entry.value ? "Enabled" : "Disabled";
  if (entry.value === null || entry.value === undefined) return "Not set";
  return String(entry.value);
}

export default function SystemSettingsPage() {
  const { user } = useAuth();
  const canView = hasEffectivePermission(user, SETTINGS_VIEW);
  const canManage = hasEffectivePermission(user, SETTINGS_MANAGE);

  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [drafts, setDrafts] = useState({}); // key -> pending edited value (string/boolean)
  const [savingKey, setSavingKey] = useState(null);

  const load = useCallback(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    return apiClient
      .get("/settings")
      .then((res) => setSettings(res.data.data))
      .catch((err) => {
        setError(err?.response?.status === 403 ? "You do not have permission to view system settings." : err?.response?.data?.message || "Failed to load settings.");
        setSettings([]);
      })
      .finally(() => setLoading(false));
  }, [canView]);

  useEffect(() => {
    load();
  }, [load]);

  function draftValueFor(entry) {
    if (Object.prototype.hasOwnProperty.call(drafts, entry.key)) return drafts[entry.key];
    return entry.value;
  }

  function setDraft(key, value) {
    setDrafts((d) => ({ ...d, [key]: value }));
  }

  // Whether the drafted value actually differs from the server's current
  // value - used to keep Save disabled until there's something to save
  // (Step 9: no point submitting an unchanged value, and it keeps a stray
  // click from generating a no-op audit entry).
  function isDirty(entry) {
    if (!Object.prototype.hasOwnProperty.call(drafts, entry.key)) return false;
    const raw = drafts[entry.key];
    if (entry.valueType === "BOOLEAN") return raw !== entry.value;
    const normalized = raw === "" || raw === null ? null : entry.valueType === "INTEGER" ? parseInt(raw, 10) : parseFloat(raw);
    const current = entry.value ?? null;
    if (normalized === null || current === null) return normalized !== current;
    return Number.isNaN(normalized) || normalized !== current;
  }

  async function submitUpdate(entry, nextValue) {
    setSavingKey(entry.key);
    setError(null);
    try {
      await apiClient.patch(`/settings/${entry.key}`, { value: nextValue, expectedVersion: entry.version });
      setNotice(`${entry.key} updated.`);
      setDrafts((d) => {
        const { [entry.key]: _removed, ...rest } = d;
        return rest;
      });
      load();
    } catch (err) {
      if (err?.response?.data?.code === "SETTING_CONFLICT") {
        // load() clears `error` itself as soon as it starts (and React 18
        // batches both calls in this same tick) - setting the message AFTER
        // awaiting it, rather than before/alongside, is what actually makes
        // it survive to render instead of being instantly wiped.
        await load();
        setError("This setting was changed by someone else. The latest value has been reloaded - please try again.");
      } else {
        setError(err?.response?.data?.message || `Failed to update ${entry.key}.`);
      }
    } finally {
      setSavingKey(null);
    }
  }

  function handleSave(entry) {
    const raw = draftValueFor(entry);
    let nextValue = raw;
    if (entry.valueType === "INTEGER" || entry.valueType === "DECIMAL") {
      if (raw === "" || raw === null) {
        nextValue = entry.nullable ? null : entry.defaultValue;
      } else {
        nextValue = entry.valueType === "INTEGER" ? parseInt(raw, 10) : parseFloat(raw);
        if (Number.isNaN(nextValue)) {
          setError(`${entry.key} requires a valid number.`);
          return;
        }
      }
    }
    if (HIGH_IMPACT_KEYS.has(entry.key)) {
      const from = formatValue(entry);
      const to = entry.valueType === "BOOLEAN" ? (nextValue ? "Enabled" : "Disabled") : nextValue === null ? "Not set" : String(nextValue);
      if (!window.confirm(`Change ${entry.key} from "${from}" to "${to}"?\n\nThis affects live behavior immediately (no cache delay).`)) {
        return;
      }
    }
    submitUpdate(entry, nextValue);
  }

  if (!canView && !canManage) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-4">System Settings</h1>
        <div className="rounded-lg bg-amber-50 text-amber-700 text-sm px-3 py-2">You do not have permission to view system settings.</div>
      </div>
    );
  }

  const grouped = settings.reduce((acc, entry) => {
    (acc[entry.category] = acc[entry.category] || []).push(entry);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">System Settings</h1>
      </div>

      <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 mb-6">
        Platform-wide business settings and feature flags only - never secrets or infrastructure configuration (those remain environment-only and are never shown here). Changes take effect
        immediately on the next read; there is no cache delay.
      </p>

      {notice && <div className="mb-4 rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{notice}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {loading && <div className="text-slate-400 text-sm">Loading...</div>}

      {!loading &&
        Object.entries(CATEGORY_LABELS).map(([category, label]) => {
          const entries = grouped[category] || [];
          if (entries.length === 0) return null;
          return (
            <div key={category} className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                <h2 className="text-sm font-semibold text-slate-700">{label}</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Setting</th>
                    <th className="text-left px-4 py-2">Current value</th>
                    <th className="text-left px-4 py-2">Default</th>
                    <th className="text-left px-4 py-2">Allowed</th>
                    <th className="text-left px-4 py-2">Last updated</th>
                    {canManage && <th className="text-left px-4 py-2"></th>}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.key} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{entry.key}</div>
                        <div className="text-xs text-slate-500">{entry.description}</div>
                        {SETTING_CAVEATS[entry.key] && <div className="text-xs text-amber-600 mt-1">{SETTING_CAVEATS[entry.key]}</div>}
                      </td>
                      <td className="px-4 py-3">
                        {canManage ? (
                          entry.valueType === "BOOLEAN" ? (
                            <button
                              onClick={() => setDraft(entry.key, !draftValueFor(entry))}
                              className={`rounded-full px-3 py-1 text-xs font-medium ${draftValueFor(entry) ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}
                            >
                              {draftValueFor(entry) ? "Enabled" : "Disabled"}
                            </button>
                          ) : (
                            <input
                              type="number"
                              value={draftValueFor(entry) ?? ""}
                              min={entry.min ?? undefined}
                              max={entry.max ?? undefined}
                              placeholder={entry.nullable ? "Not set" : undefined}
                              onChange={(e) => setDraft(entry.key, e.target.value)}
                              className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                            />
                          )
                        ) : (
                          <span className="text-slate-700">{formatValue(entry)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{entry.valueType === "BOOLEAN" ? (entry.defaultValue ? "Enabled" : "Disabled") : entry.defaultValue ?? "Not set"}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {entry.valueType === "BOOLEAN"
                          ? "true / false"
                          : entry.allowedValues
                          ? entry.allowedValues.join(", ")
                          : `${entry.min ?? "-∞"} to ${entry.max ?? "+∞"}${entry.nullable ? " (or not set)" : ""}`}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : "Never (using default)"}
                      </td>
                      {canManage && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              disabled={savingKey === entry.key || !isDirty(entry)}
                              onClick={() => handleSave(entry)}
                              className="text-brand-600 hover:underline disabled:opacity-50 disabled:no-underline text-xs font-medium"
                            >
                              {savingKey === entry.key ? "Saving..." : "Save"}
                            </button>
                            {isDirty(entry) && savingKey !== entry.key && <span className="text-[10px] uppercase tracking-wide text-amber-600">Unsaved</span>}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
    </div>
  );
}
