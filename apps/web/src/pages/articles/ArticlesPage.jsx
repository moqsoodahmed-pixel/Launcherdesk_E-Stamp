import StatusChip from "../../components/ui/StatusChip";
import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/errors";
import { useApi } from "../../hooks/useApi";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import PageHeader from "../../components/common/PageHeader";
import ErrorState from "../../components/common/ErrorState";

// Only rule types this form can fully configure. The API also accepts SLAB
// and CUSTOM, but those need slab rows this form doesn't have - saving one
// without them would calculate a stamp duty of 0.
const RULE_TYPES = ["FIXED", "PERCENTAGE"];
const EMPTY_VERSION_FORM = { ruleType: "FIXED", fixedAmount: "", percentage: "", minAmount: "", maxAmount: "", effectiveFrom: "" };

export default function ArticlesPage() {
  const { user } = useAuth();
  // Write endpoints need ARTICLE_MANAGE and only internal roles can hold it.
  const canManage = (user?.role === "MASTER_ADMIN" || user?.role === "ASSISTANT_MASTER_ADMIN") && hasPermission(user, PERMISSIONS.ARTICLE_MANAGE);

  const [stateCode, setStateCode] = useState("");
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ stateCode: "", articleCode: "", title: "", description: "", ruleType: "FIXED", fixedAmount: "", percentage: "", minAmount: "", maxAmount: "" });
  const [creating, setCreating] = useState(false);

  const [versionArticleId, setVersionArticleId] = useState(null);
  const [versionForm, setVersionForm] = useState({ ruleType: "FIXED", fixedAmount: "", percentage: "", minAmount: "", maxAmount: "", effectiveFrom: "" });
  const [savingVersion, setSavingVersion] = useState(false);

  // Debounce typed filters so each keystroke doesn't fire a request; useApi
  // aborts any superseded request so a stale response can't win.
  const [filters, setFilters] = useState({ stateCode: "", search: "" });
  useEffect(() => {
    const t = setTimeout(() => setFilters({ stateCode: stateCode.trim(), search: search.trim() }), 300);
    return () => clearTimeout(t);
  }, [stateCode, search]);

  const { data, loading, error, refetch: load } = useApi(
    (signal) =>
      apiClient
        .get("/articles", { params: { stateCode: filters.stateCode || undefined, search: filters.search || undefined }, signal })
        .then((res) => {
          const payload = res.data.data;
          return Array.isArray(payload) ? payload : payload?.items || [];
        }),
    [filters.stateCode, filters.search],
    { errorMessage: "Failed to load articles." }
  );
  const items = data || [];

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
    setActionError(null);
    setNotice(null);
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
      setActionError(getErrorMessage(err, "Failed to create article."));
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleStatus(article) {
    const next = !article.isActive;
    if (!window.confirm(`${next ? "Activate" : "Deactivate"} "${article.title}"? ${!next ? "It will no longer be selectable for new E-Stamp requests." : ""}`)) return;
    setActionError(null);
    setNotice(null);
    try {
      await apiClient.patch(`/articles/${article._id}/status`, { isActive: next });
      setNotice(`Article ${next ? "activated" : "deactivated"}.`);
      load();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to change status."));
    }
  }

  async function handleAddVersion(e) {
    e.preventDefault();
    setSavingVersion(true);
    setActionError(null);
    setNotice(null);
    try {
      await apiClient.post(`/articles/${versionArticleId}/versions`, {
        calculationRule: buildRule(versionForm),
        effectiveFrom: versionForm.effectiveFrom || undefined,
      });
      setNotice("New calculation rule version created.");
      setVersionArticleId(null);
      load();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to create new version."));
    } finally {
      setSavingVersion(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Articles"
        actions={
          canManage && (
            <button onClick={() => setShowCreate((v) => !v)} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700">
              {showCreate ? "Cancel" : "+ New Article"}
            </button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input aria-label="State code" placeholder="State code (e.g. KA)" value={stateCode} onChange={(e) => setStateCode(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <input aria-label="Search articles" placeholder="Search by title..." value={search} onChange={(e) => setSearch(e.target.value)} className="input w-full sm:w-64" />
        <button onClick={load} className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
          Refresh
        </button>
      </div>

      {notice && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">{notice}</div>}
      {actionError && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{actionError}</div>}
      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}

      {canManage && showCreate && (
        <form onSubmit={handleCreate} className="card p-6 space-y-4 mb-6">
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
          <button disabled={creating} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50">
            {creating ? "Creating..." : "Create article"}
          </button>
        </form>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">State</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Code</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Title</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Version</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Status</th>
              {canManage && <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold"></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-4 py-10 text-center text-slate-500">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-4 py-10 text-center text-slate-500">
                  No articles found.
                </td>
              </tr>
            )}
            {!loading && items.map((a) => (
              <tr key={a._id} className="border-t border-slate-100">
                <td className="px-4 py-3">{a.stateCode}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{a.articleCode}</td>
                <td className="px-4 py-3">{a.title}</td>
                <td className="px-4 py-3 text-slate-500">v{a.currentVersion}</td>
                <td className="px-4 py-3">
                  <StatusChip kind="account" status={a.isActive ? "ACTIVE" : "INACTIVE"} label={a.isActive ? "Active" : "Inactive"} />
                </td>
                {canManage && (
                  <td className="px-4 py-3 space-x-3">
                    <button
                      onClick={() => {
                        setVersionForm(EMPTY_VERSION_FORM);
                        setVersionArticleId(a._id);
                      }}
                      className="font-medium text-brand-700 hover:underline">
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
      </div>

      {versionArticleId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleAddVersion} className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
            <h2 className="font-medium text-slate-900">New calculation rule version</h2>
            <RuleFields form={versionForm} setForm={setVersionForm} />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-800">Effective from (optional - leave blank for immediate)</span>
              <input type="datetime-local" value={versionForm.effectiveFrom} onChange={(e) => setVersionForm((f) => ({ ...f, effectiveFrom: e.target.value }))} className="input" />
              <span className="block text-xs text-slate-500 mt-1">A future date won't apply until then - existing requests are never recalculated.</span>
            </label>
            <div className="flex gap-2">
              <button disabled={savingVersion} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50">
                {savingVersion ? "Saving..." : "Create version"}
              </button>
              <button type="button" onClick={() => setVersionArticleId(null)} className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
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
        <span className="mb-1.5 block text-sm font-medium text-slate-800">Calculation type</span>
        <select value={form.ruleType} onChange={(e) => setForm((f) => ({ ...f, ruleType: e.target.value }))} className="input">
          {RULE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {form.ruleType === "FIXED" && <TextField label="Fixed amount (₹)" type="number" required min="0" value={form.fixedAmount} onChange={(v) => setForm((f) => ({ ...f, fixedAmount: v }))} />}
      {form.ruleType === "PERCENTAGE" && <TextField label="Percentage (%)" type="number" required min="0" step="any" value={form.percentage} onChange={(v) => setForm((f) => ({ ...f, percentage: v }))} />}
      <div className="grid grid-cols-2 gap-4">
        <TextField label="Min amount (optional)" type="number" value={form.minAmount} onChange={(v) => setForm((f) => ({ ...f, minAmount: v }))} />
        <TextField label="Max amount (optional)" type="number" value={form.maxAmount} onChange={(v) => setForm((f) => ({ ...f, maxAmount: v }))} />
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, type = "text", ...inputProps }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-800">{label}</span>
      <input type={type} {...inputProps} value={value} onChange={(e) => onChange(e.target.value)} className="input" />
    </label>
  );
}
