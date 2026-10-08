import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

const RULE_TYPES = ["FIXED", "PERCENTAGE", "SLAB", "CUSTOM"];

export default function ArticlesPage() {
  const { user } = useAuth();
  const canManage = user?.role === "MASTER_ADMIN" || user?.role === "ASSISTANT_MASTER_ADMIN";

  const [items, setItems] = useState([]);
  const [stateCode, setStateCode] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ stateCode: "", articleCode: "", title: "", description: "", ruleType: "FIXED", fixedAmount: "", percentage: "", minAmount: "", maxAmount: "" });
  const [creating, setCreating] = useState(false);

  const [versionArticleId, setVersionArticleId] = useState(null);
  const [versionForm, setVersionForm] = useState({ ruleType: "FIXED", fixedAmount: "", percentage: "", minAmount: "", maxAmount: "", effectiveFrom: "" });
  const [savingVersion, setSavingVersion] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .get("/articles", { params: { stateCode: stateCode || undefined, search: search || undefined } })
      .then((res) => setItems(Array.isArray(res.data.data) ? res.data.data : res.data.data.items))
      .catch((err) => setError(err?.response?.data?.message || "Failed to load articles."))
      .finally(() => setLoading(false));
  }, [stateCode, search]);

  useEffect(() => {
    load();
  }, [load]);

  function buildRule(form) {
    const rule = { type: form.ruleType };
    if (form.ruleType === "FIXED") rule.fixedAmount = Number(form.fixedAmount);
    if (form.ruleType === "PERCENTAGE") rule.percentage = Number(form.percentage);
    if (form.minAmount) rule.minAmount = Number(form.minAmount);
    if (form.maxAmount) rule.maxAmount = Number(form.maxAmount);
    return rule;
  }

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiClient.post("/articles", {
        stateCode: createForm.stateCode.toUpperCase(),
        articleCode: createForm.articleCode,
        title: createForm.title,
        description: createForm.description || undefined,
        calculationRule: buildRule(createForm),
      });
      setNotice("Article created.");
      setShowCreate(false);
      setCreateForm({ stateCode: "", articleCode: "", title: "", description: "", ruleType: "FIXED", fixedAmount: "", percentage: "", minAmount: "", maxAmount: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to create article.");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleStatus(article) {
    const next = !article.isActive;
    if (!window.confirm(`${next ? "Activate" : "Deactivate"} "${article.title}"? ${!next ? "It will no longer be selectable for new E-Stamp requests." : ""}`)) return;
    try {
      await apiClient.patch(`/articles/${article._id}/status`, { isActive: next });
      setNotice(`Article ${next ? "activated" : "deactivated"}.`);
      load();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to change status.");
    }
  }

  async function handleAddVersion(e) {
    e.preventDefault();
    setSavingVersion(true);
    setError(null);
    try {
      await apiClient.post(`/articles/${versionArticleId}/versions`, {
        calculationRule: buildRule(versionForm),
        effectiveFrom: versionForm.effectiveFrom || undefined,
      });
      setNotice("New calculation rule version created.");
      setVersionArticleId(null);
      load();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to create new version.");
    } finally {
      setSavingVersion(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Articles</h1>
        {canManage && (
          <button onClick={() => setShowCreate((v) => !v)} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
            {showCreate ? "Cancel" : "+ New Article"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input placeholder="State code (e.g. KA)" value={stateCode} onChange={(e) => setStateCode(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <input placeholder="Search by title..." value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <button onClick={load} className="text-sm text-slate-500 hover:underline">
          Refresh
        </button>
      </div>

      {notice && <div className="mb-4 rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{notice}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {canManage && showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 mb-6">
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
            Demo/test data only. Enter your organization's verified, authoritative stamp-duty rates - this platform does not supply legal rate data.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <TextField label="State code" value={createForm.stateCode} onChange={(v) => setCreateForm((f) => ({ ...f, stateCode: v }))} />
            <TextField label="Article code" value={createForm.articleCode} onChange={(v) => setCreateForm((f) => ({ ...f, articleCode: v }))} />
          </div>
          <TextField label="Title" value={createForm.title} onChange={(v) => setCreateForm((f) => ({ ...f, title: v }))} />
          <TextField label="Description (optional)" value={createForm.description} onChange={(v) => setCreateForm((f) => ({ ...f, description: v }))} />
          <RuleFields form={createForm} setForm={setCreateForm} />
          <button disabled={creating} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {creating ? "Creating..." : "Create article"}
          </button>
        </form>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">State</th>
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-left px-4 py-3">Title</th>
              <th className="text-left px-4 py-3">Version</th>
              <th className="text-left px-4 py-3">Status</th>
              {canManage && <th className="text-left px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-4 py-6 text-center text-slate-400">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-4 py-6 text-center text-slate-400">
                  No articles found.
                </td>
              </tr>
            )}
            {items.map((a) => (
              <tr key={a._id} className="border-t border-slate-100">
                <td className="px-4 py-3">{a.stateCode}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{a.articleCode}</td>
                <td className="px-4 py-3">{a.title}</td>
                <td className="px-4 py-3 text-slate-500">v{a.currentVersion}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${a.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{a.isActive ? "Active" : "Inactive"}</span>
                </td>
                {canManage && (
                  <td className="px-4 py-3 space-x-3">
                    <button onClick={() => setVersionArticleId(a._id)} className="text-brand-600 hover:underline">
                      New version
                    </button>
                    <button onClick={() => handleToggleStatus(a)} className={a.isActive ? "text-red-600 hover:underline" : "text-green-600 hover:underline"}>
                      {a.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {versionArticleId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleAddVersion} className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
            <h2 className="font-medium text-slate-900">New calculation rule version</h2>
            <RuleFields form={versionForm} setForm={setVersionForm} />
            <label className="block">
              <span className="block text-xs font-medium text-slate-700 mb-1">Effective from (optional - leave blank for immediate)</span>
              <input type="datetime-local" value={versionForm.effectiveFrom} onChange={(e) => setVersionForm((f) => ({ ...f, effectiveFrom: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <span className="block text-xs text-slate-500 mt-1">A future date won't apply until then - existing requests are never recalculated.</span>
            </label>
            <div className="flex gap-2">
              <button disabled={savingVersion} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                {savingVersion ? "Saving..." : "Create version"}
              </button>
              <button type="button" onClick={() => setVersionArticleId(null)} className="text-sm text-slate-500 hover:underline">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function RuleFields({ form, setForm }) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="block text-xs font-medium text-slate-700 mb-1">Calculation type</span>
        <select value={form.ruleType} onChange={(e) => setForm((f) => ({ ...f, ruleType: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          {RULE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {form.ruleType === "FIXED" && <TextField label="Fixed amount (₹)" type="number" value={form.fixedAmount} onChange={(v) => setForm((f) => ({ ...f, fixedAmount: v }))} />}
      {form.ruleType === "PERCENTAGE" && <TextField label="Percentage (%)" type="number" value={form.percentage} onChange={(v) => setForm((f) => ({ ...f, percentage: v }))} />}
      <div className="grid grid-cols-2 gap-4">
        <TextField label="Min amount (optional)" type="number" value={form.minAmount} onChange={(v) => setForm((f) => ({ ...f, minAmount: v }))} />
        <TextField label="Max amount (optional)" type="number" value={form.maxAmount} onChange={(v) => setForm((f) => ({ ...f, maxAmount: v }))} />
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
    </label>
  );
}
