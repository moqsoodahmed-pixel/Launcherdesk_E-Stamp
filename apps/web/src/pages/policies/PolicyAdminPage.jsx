import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

// Phase 16 - internal policy management: create a new DRAFT version, publish
// it, and browse version history. A PUBLISHED/SUPERSEDED version is NEVER
// shown as editable here - the only way to change published content is to
// create a new DRAFT version and publish that (mirrors the backend's own
// server-side enforcement in policy.service.js).
//
// @launcherdesk/shared is a CommonJS package Rollup's production build
// cannot statically analyze for named imports (see AuditLogsPage.jsx's
// identical note) - the permission values this page needs are mirrored here
// in sync with packages/shared/src/permissions.js's DEFAULT_ROLE_PERMISSIONS.
const POLICY_VIEW = "policy.view";
const POLICY_MANAGE = "policy.manage";
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

const POLICY_TYPES = ["TERMS", "PRIVACY", "REFUND"];

const STATUS_BADGE = {
  DRAFT: "bg-slate-100 text-slate-600",
  PUBLISHED: "bg-green-100 text-green-700",
  SUPERSEDED: "bg-amber-100 text-amber-700",
  ARCHIVED: "bg-slate-100 text-slate-400",
};

export default function PolicyAdminPage() {
  const { user } = useAuth();
  const canView = hasEffectivePermission(user, POLICY_VIEW);
  const canManage = hasEffectivePermission(user, POLICY_MANAGE);

  const [type, setType] = useState("TERMS");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ version: "", title: "", content: "" });
  const [creating, setCreating] = useState(false);
  const [publishingId, setPublishingId] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    apiClient
      .get(`/policies/${type}/history`)
      .then((res) => setItems(res.data.data.items))
      .catch((err) => {
        setError(err?.response?.status === 403 ? "You do not have permission to view policy history." : err?.response?.data?.message || "Failed to load policy history.");
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [type, canView]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiClient.post("/policies", { type, version: form.version, title: form.title, content: form.content });
      setNotice("Draft version created.");
      setShowCreate(false);
      setForm({ version: "", title: "", content: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to create draft.");
    } finally {
      setCreating(false);
    }
  }

  async function handlePublish(item) {
    if (!window.confirm(`Publish ${type} version ${item.version}? This will supersede the currently published version, if any. This cannot be undone.`)) return;
    setPublishingId(item._id);
    setError(null);
    try {
      await apiClient.post(`/policies/${item._id}/publish`);
      setNotice(`Version ${item.version} published.`);
      load();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to publish this version.");
    } finally {
      setPublishingId(null);
    }
  }

  if (!canView && !canManage) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-4">Manage Policies</h1>
        <div className="rounded-lg bg-amber-50 text-amber-700 text-sm px-3 py-2">You do not have permission to manage policies.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Manage Policies</h1>
        {canManage && (
          <button onClick={() => setShowCreate((v) => !v)} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
            {showCreate ? "Cancel" : "+ New draft version"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {POLICY_TYPES.map((t) => (
          <button key={t} onClick={() => setType(t)} className={`rounded-lg px-3 py-2 text-sm font-medium ${type === t ? "bg-brand-600 text-white" : "bg-white border border-slate-300 text-slate-600"}`}>
            {t}
          </button>
        ))}
      </div>

      {notice && <div className="mb-4 rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{notice}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {canManage && showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 mb-6">
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
            No approved legal Terms/Privacy/Refund text has been supplied for this platform. Enter your organization's own approved legal content here - this platform does not supply or certify
            legal policy content.
          </p>
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">Version (e.g. 1.0)</span>
            <input value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">Title</span>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">Content (plain text)</span>
            <textarea
              rows={8}
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>
          <button disabled={creating} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {creating ? "Creating..." : "Create draft"}
          </button>
        </form>
      )}

      {canView && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Version</th>
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Published</th>
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
                    No versions yet for {type}.
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <tr key={item._id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{item.version}</td>
                  <td className="px-4 py-3">{item.title}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[item.status] || "bg-slate-100 text-slate-600"}`}>{item.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : "-"}</td>
                  <td className="px-4 py-3 space-x-3">
                    <button onClick={() => setViewing(item)} className="text-brand-600 hover:underline">
                      View
                    </button>
                    {canManage && item.status === "DRAFT" && (
                      <button disabled={publishingId === item._id} onClick={() => handlePublish(item)} className="text-green-600 hover:underline disabled:opacity-50">
                        {publishingId === item._id ? "Publishing..." : "Publish"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50" onClick={() => setViewing(null)}>
          <div className="bg-white rounded-2xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900">
                {viewing.title} - v{viewing.version} ({viewing.status})
              </h2>
              <button onClick={() => setViewing(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            {/* Read-only, plain text - never editable, never dangerouslySetInnerHTML. */}
            <p className="text-sm text-slate-700 whitespace-pre-wrap max-h-96 overflow-y-auto border border-slate-100 rounded-lg p-4 bg-slate-50">{viewing.content}</p>
          </div>
        </div>
      )}
    </div>
  );
}
