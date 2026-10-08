import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { PERMISSIONS, hasPermission } from "../../utils/permissions";
import { formatCurrency, errorMessage } from "../../utils/format";
import KpiCard from "../../components/dashboard/KpiCard";
import { KpiSkeleton } from "../../components/dashboard/LoadingSkeleton";
import RecentActivityTable from "../../components/dashboard/RecentActivityTable";
import QuickActionButton from "../../components/dashboard/QuickActionButton";

// Phase 21 - USER's dashboard: deliberately the smallest of the five. USER
// does not hold REPORT_VIEW by default, so this never calls /reports/* -
// only the plain estamp-request/order list endpoints it already has
// ESTAMP_VIEW/ORDER_VIEW for. GET /estamps (the API path - NOT the frontend
// route /estamps/requests, which is a different thing) already auto-scopes
// to `createdBy: req.user.id` for the USER role server-side (see
// estamp-request.controller.js's listRequests) - "my requests" here is
// genuinely this user's own, not the whole organization's.
export default function UserDashboard() {
  const { user } = useAuth();
  const canCreate = hasPermission(user, PERMISSIONS.ESTAMP_CREATE);
  const canViewRequests = hasPermission(user, PERMISSIONS.ESTAMP_VIEW);
  const canViewOrders = hasPermission(user, PERMISSIONS.ORDER_VIEW);

  const [requests, setRequests] = useState(null);
  const [requestsErr, setRequestsErr] = useState(null);
  const [requestsLoading, setRequestsLoading] = useState(canViewRequests);

  const [orders, setOrders] = useState(null);
  const [ordersErr, setOrdersErr] = useState(null);
  const [ordersLoading, setOrdersLoading] = useState(canViewOrders);

  const loadRequests = useCallback(() => {
    if (!canViewRequests) return;
    setRequestsLoading(true);
    apiClient
      .get("/estamps", { params: { limit: 5 } })
      .then((r) => setRequests(r.data.data))
      .catch((err) => setRequestsErr(errorMessage(err, "Failed to load your requests.")))
      .finally(() => setRequestsLoading(false));
  }, [canViewRequests]);

  const loadOrders = useCallback(() => {
    if (!canViewOrders) return;
    setOrdersLoading(true);
    apiClient
      .get("/orders", { params: { limit: 5 } })
      .then((r) => setOrders(r.data.data))
      .catch((err) => setOrdersErr(errorMessage(err, "Failed to load orders.")))
      .finally(() => setOrdersLoading(false));
  }, [canViewOrders]);

  useEffect(() => {
    loadRequests();
    loadOrders();
  }, [loadRequests, loadOrders]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Welcome back, {user?.name}</h1>
        <p className="text-sm text-slate-500">Your E-Stamping activity</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {canCreate && <QuickActionButton to="/estamps/requests/new" label="Create E-Stamp Request" icon="✍️" />}
        {canViewRequests && <QuickActionButton to="/estamps/requests" label="My Requests" icon="📄" />}
        {canViewOrders && <QuickActionButton to="/orders" label="My Orders" icon="📦" />}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {requestsLoading && <KpiSkeleton count={canViewOrders ? 2 : 1} />}
        {!requestsLoading && canViewRequests && requests && <KpiCard label="My requests" value={requests.total} />}
        {!ordersLoading && canViewOrders && orders && <KpiCard label="Orders" value={orders.total} />}
      </div>

      {canViewRequests && (
        <RecentActivityTable
          title="My recent requests"
          loading={requestsLoading}
          error={requestsErr}
          rows={requests?.items}
          rowLinkPrefix="/estamps/requests"
          emptyText="You haven't created any E-Stamp requests yet."
          columns={[
            { key: "requestNumber", label: "Request #" },
            { key: "status", label: "Status" },
            { key: "calculatedStampDuty", label: "Value", render: (r) => formatCurrency(r.calculatedStampDuty) },
            { key: "createdAt", label: "Created", render: (r) => new Date(r.createdAt).toLocaleDateString() },
          ]}
        />
      )}

      {canViewOrders && (
        <RecentActivityTable
          title="Recent orders"
          loading={ordersLoading}
          error={ordersErr}
          rows={orders?.items}
          rowLinkPrefix="/orders"
          emptyText="No orders yet."
          columns={[
            { key: "orderNumber", label: "Order #" },
            { key: "eStampStatus", label: "Status" },
            { key: "amount", label: "Amount", render: (r) => formatCurrency(r.amount) },
          ]}
        />
      )}
    </div>
  );
}
