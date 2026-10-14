import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { formatCurrency } from "../../utils/format";
import { getErrorMessage } from "../../utils/errors";

// Master-Admin-only: a single scrollable list of every organization with its
// current e-Stamp procurement fee (platform default, or this organization's
// own override), and an inline control to set/clear that override - the
// "scroll to find the organization, then change the amount" flow, without
// having to open each organization's full detail page just for this one
// setting. The backend endpoint (PATCH /organizations/:id/procurement-fee)
// and the per-organization card on OrganizationDetailPage already existed;
// this is the same feature, surfaced as its own dedicated page.
export default function ProcurementFeesPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Per-row editable draft, keyed by organization id, so typing in one row
  // never disturbs another - cleared back to the server value after a save.
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [rowErrors, setRowErrors] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .get("/organizations", { params: { page, limit, search: search || undefined } })
      .then((res) => {
        setItems(res.data.data.items);
        setTotal(res.data.data.total);
      })
      .catch((err) => setError(getErrorMessage(err, "Failed to load organizations.")))
      .finally(() => setLoading(false));
  }, [page, limit, search]);

  useEffect(() => {
    load();
  }, [load]);

  function draftFor(org) {
    return Object.prototype.hasOwnProperty.call(drafts, org._id) ? drafts[org._id] : org.procurementFeeOverride ?? "";
  }

  function setDraft(orgId, value) {
    setDrafts((d) => ({ ...d, [orgId]: value }));
  }

  async function save(org) {
    setSavingId(org._id);
    setRowErrors((e) => ({ ...e, [org._id]: null }));
    setNotice(null);
    try {
      const raw = String(draftFor(org)).trim();
      const procurementFee = raw === "" ? null : Number(raw);
      if (procurementFee !== null && (!Number.isFinite(procurementFee) || procurementFee < 0)) {
        throw new Error("Enter a non-negative number, or leave blank for the platform default.");
      }
      await apiClient.patch(`/organizations/${org._id}/procurement-fee`, { procurementFee });
      setNotice(procurementFee === null ? `${org.name} reverted to the platform default procurement fee.` : `${org.name}'s procurement fee set to ${formatCurrency(procurementFee)}.`);
      setDrafts((d) => {
        const { [org._id]: _removed, ...rest } = d;
        return rest;
      });
      load();
    } catch (err) {
      setRowErrors((e) => ({ ...e, [org._id]: err.response ? getErrorMessage(err, "Failed to save the procurement fee.") : err.message }));
    } finally {
      setSavingId(null);
    }
  }

  function clear(org) {
    setDraft(org._id, "");
    save({ ...org, procurementFeeOverride: null });
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Procurement Fees</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        The flat procurement charge in each organization's e-Stamp price summary. Leave an organization blank to keep it on the platform default; set an amount to override it for that
        organization only.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          aria-label="Search organizations"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button onClick={load} className="text-sm text-slate-500 hover:underline">
          Refresh
        </button>
      </div>

      {notice && <div className="mb-4 rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{notice}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Organization</th>
                <th className="text-left px-4 py-3">Current Fee</th>
                <th className="text-left px-4 py-3">Override Amount (₹)</th>
                <th className="text-left px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && !error && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    No organizations found.
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((org) => (
                  <tr key={org._id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3 font-medium text-slate-900">{org.name}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {org.procurementFeeOverride != null ? (
                        <span>
                          {formatCurrency(org.procurementFeeOverride)} <span className="text-xs text-slate-400">(override)</span>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Platform default</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        aria-label={`Procurement fee override for ${org.name}`}
                        placeholder="Platform default"
                        value={draftFor(org)}
                        onChange={(e) => setDraft(org._id, e.target.value)}
                        className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      {rowErrors[org._id] && <div className="text-xs text-red-600 mt-1">{rowErrors[org._id]}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          disabled={savingId === org._id}
                          onClick={() => save(org)}
                          className="text-brand-600 hover:underline disabled:opacity-50 disabled:no-underline text-xs font-medium"
                        >
                          {savingId === org._id ? "Saving..." : "Save"}
                        </button>
                        {org.procurementFeeOverride != null && (
                          <button disabled={savingId === org._id} onClick={() => clear(org)} className="text-slate-500 hover:underline text-xs">
                            Clear
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
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
    </div>
  );
}
