import { FilePlus2, FileText, Package } from "lucide-react";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import StatusBadge from "../../components/estamps/StatusBadge";
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
    setRequestsErr(null);
    apiClient
      .get("/estamps", { params: { limit: 5 } })
      .then((r) => setRequests(r.data.data))
      .catch((err) => setRequestsErr(errorMessage(err, "Failed to load your requests.")))
      .finally(() => setRequestsLoading(false));
  }, [canViewRequests]);

  const loadOrders = useCallback(() => {
    if (!canViewOrders) return;
    setOrdersLoading(true);
    setOrdersErr(null);
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
      <DashboardHeader
        name={user?.name}
        subtitle="Your E-Stamping activity"
        actions={
          <>
            {canCreate && <QuickActionButton to="/estamps/requests/new" label="Create E-Stamp Request" icon={FilePlus2} primary />}
            {canViewRequests && <QuickActionButton to="/estamps/requests" label="My Requests" icon={FileText} />}
            {canViewOrders && <QuickActionButton to="/orders" label="My Orders" icon={Package} />}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {requestsLoading && <KpiSkeleton count={canViewOrders ? 2 : 1} />}
        {!requestsLoading && canViewRequests && requests && <KpiCard label="My requests" value={requests.total} icon={FileText} tone="blue" />}
        {!ordersLoading && canViewOrders && orders && <KpiCard label="Orders" value={orders.total} icon={Package} tone="teal" />}
      </div>

      {canViewRequests && (
        <RecentActivityTable
          title="My recent requests"
          loading={requestsLoading}
          error={requestsErr} onRetry={loadRequests}
          rows={requests?.items}
          rowLinkPrefix="/estamps/requests"
          emptyText="You haven't created any E-Stamp requests yet."
          columns={[
            { key: "requestNumber", label: "Request #", render: (r) => <span className="font-medium text-slate-900">{r.requestNumber}</span> },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} deadline={r.modificationDeadline} /> },
            { key: "calculatedStampDuty", label: "Value", render: (r) => <span className="tabular-nums">{formatCurrency(r.calculatedStampDuty)}</span> },
            { key: "createdAt", label: "Created", render: (r) => <span className="tabular-nums">{new Date(r.createdAt).toLocaleDateString()}</span> },
          ]}
        />
      )}

      {canViewOrders && (
        <RecentActivityTable
          title="Recent orders"
          loading={ordersLoading}
          error={ordersErr} onRetry={loadOrders}
          rows={orders?.items}
          rowLinkPrefix="/orders"
          emptyText="No orders yet."
          columns={[
            { key: "orderNumber", label: "Order #", render: (r) => <span className="font-medium text-slate-900">{r.orderNumber}</span> },
            { key: "eStampStatus", label: "Status", render: (r) => <StatusBadge status={r.eStampStatus} /> },
            { key: "amount", label: "Amount", render: (r) => <span className="tabular-nums">{formatCurrency(r.amount)}</span> },
          ]}
        />
      )}
    </div>
  );
}
