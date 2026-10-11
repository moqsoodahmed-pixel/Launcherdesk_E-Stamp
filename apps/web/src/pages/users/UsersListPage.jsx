import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../hooks/useApi";
import { getErrorMessage } from "../../utils/errors";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import { manageableRoles, creatableRoles, ROLE_LABELS } from "../../utils/roles";
import PageHeader from "../../components/common/PageHeader";
import ErrorState from "../../components/common/ErrorState";

const LIMIT = 10;
const TITLES = { SUPER_ADMIN: "Super Admins", ADMIN: "Admins", USER: "Users" };

export default function UsersListPage() {
  const { user: me } = useAuth();
  // The URL is the single source of truth for every filter, so the sidebar's
  // /users?role=USER vs /users?role=ADMIN links (and back/forward) always
  // drive the dropdown, the request and the title together.
  const [searchParams, setSearchParams] = useSearchParams();
  const roleOptions = manageableRoles(me?.role);
  const rawRole = searchParams.get("role") || "";
  const role = roleOptions.includes(rawRole) ? rawRole : "";
  const status = searchParams.get("status") || "";
  const search = searchParams.get("search") || "";
  const page = Math.max(1, parseInt(searchParams.get("page"), 10) || 1);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Any filter change resets to page 1; empty values are removed from the URL.
  function setFilter(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearchParams(next, { replace: key === "search" });
  }

  const { data, loading, error, refetch } = useApi(
    (signal) =>
      apiClient
        .get("/users", { params: { page, limit: LIMIT, search: search || undefined, role: role || undefined, status: status || undefined }, signal })
        .then((res) => res.data.data),
    [page, search, role, status],
    { errorMessage: "Failed to load users." }
  );
  const items = data?.items || [];
  const total = data?.total || 0;
  const limit = LIMIT;
  const load = refetch;
  const setPage = (fn) => setFilter("page", String(typeof fn === "function" ? fn(page) : fn));

  async function handleStatusChange(user, isActive) {
    const verb = isActive ? "activate" : "deactivate";
    if (!window.confirm(`${isActive ? "Activate" : "Deactivate"} ${user.name}?`)) return;
    setActionError(null);
    try {
      await apiClient.patch(`/users/${user._id}/status`, { isActive });
      setNotice(`${user.name} ${verb}d.`);
      load();
    } catch (err) {
      setActionError(getErrorMessage(err, `Failed to ${verb} user.`));
    }
  }

  const createRole = creatableRoles(me?.role).includes(role) ? role : "USER";
  const canCreate = hasPermission(me, PERMISSIONS.USER_CREATE) && creatableRoles(me?.role).length > 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <PageHeader
        title={role ? TITLES[role] : "Users"}
        actions={
          canCreate && (
            <Link to={`/users/new?role=${createRole}`} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
              + Add {ROLE_LABELS[createRole]}
            </Link>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          aria-label="Search users"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setFilter("search", e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          aria-label="Role"
          value={role}
          onChange={(e) => setFilter("role", e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All roles</option>
          {roleOptions.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setFilter("status", e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button onClick={load} className="text-sm text-slate-500 hover:underline">
          Refresh
        </button>
      </div>

      {notice && <div className="mb-4 rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{notice}</div>}
      {actionError && <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{actionError}</div>}
      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Phone</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Created</th>
              <th className="text-left px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No users found.
                </td>
              </tr>
            )}
            {!loading && items.map((u) => (
              <tr key={u._id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-900">{u.name}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-slate-600">{u.phone?.trim() ? u.phone : "-"}</td>
                <td className="px-4 py-3">
                  <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs">{u.role.replace(/_/g, " ")}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${u.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {u.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 space-x-3">
                  <Link to={`/users/${u._id}`} className="text-brand-600 hover:underline">
                    Edit
                  </Link>
                  {u.role !== "SUPER_ADMIN" &&
                    (u.isActive ? (
                      <button onClick={() => handleStatusChange(u, false)} className="text-red-600 hover:underline">
                        Deactivate
                      </button>
                    ) : (
                      <button onClick={() => handleStatusChange(u, true)} className="text-green-600 hover:underline">
                        Activate
                      </button>
                    ))}
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
