import Toast from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/useConfirm";
import StatusChip from "../../components/ui/StatusChip";
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
import TemporaryPasswordCell from "../../components/common/TemporaryPasswordCell";

const LIMIT = 10;
const TITLES = { SUPER_ADMIN: "Super Admins", ADMIN: "Admins", USER: "Users" };

export default function UsersListPage() {
  const [confirm, confirmDialog] = useConfirm();
  const { user: me } = useAuth();
  // Temporary-password column: Master Admin only (the API enforces it too).
  const isMaster = me?.role === "MASTER_ADMIN";
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
    const ok = await confirm({
      title: `${isActive ? "Activate" : "Deactivate"} ${user.name}?`,
      confirmLabel: isActive ? "Activate user" : "Deactivate user",
      tone: isActive ? "primary" : "danger",
    });
    if (!ok) return;
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
      {confirmDialog}
      <PageHeader
        title={role ? TITLES[role] : "Users"}
        actions={
          canCreate && (
            <Link to={`/users/new?role=${createRole}`} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700">
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
          className="input w-full sm:w-64"
        />
        <select
          aria-label="Role"
          value={role}
          onChange={(e) => setFilter("role", e.target.value)}
          className="input w-auto"
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
          className="input w-auto"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button onClick={load} className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
          Refresh
        </button>
      </div>

      {notice && <Toast tone="success" className="mb-4">{notice}</Toast>}
      {actionError && <Toast tone="error" className="mb-4">{actionError}</Toast>}
      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Name</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Email</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Phone</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Role</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Status</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Created</th>
              {isMaster && <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Password</th>}
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={isMaster ? 8 : 7} className="px-4 py-10 text-center text-slate-500">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={isMaster ? 8 : 7} className="px-4 py-10 text-center text-slate-500">
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
                  <StatusChip kind="account" status={u.isActive ? "ACTIVE" : "INACTIVE"} label={u.isActive ? "Active" : "Inactive"} />
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                {isMaster && (
                  <td className="px-4 py-3">
                    {u.role === "MASTER_ADMIN" ? <span className="text-xs text-slate-400">-</span> : <TemporaryPasswordCell userId={u._id} passwordState={u.passwordState} label={`password for ${u.name}`} />}
                  </td>
                )}
                <td className="px-4 py-3 space-x-3">
                  <Link to={`/users/${u._id}`} className="font-medium text-brand-700 hover:underline">
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
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Previous
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
