import ClientBalanceCard from "../../components/dashboard/ClientBalanceCard";
import { FilePlus2, Files, Users, BarChart3, FileText, Package, BadgeCheck, XCircle, Timer, Hourglass, Wallet, BadgeIndianRupee, Clock } from "lucide-react";
import DashboardHeader, { inWindowCount } from "../../components/dashboard/DashboardHeader";
import StatusBadge from "../../components/estamps/StatusBadge";
import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { PERMISSIONS, hasPermission } from "../../utils/permissions";
import { formatCurrency, errorMessage } from "../../utils/format";
import KpiCard from "../../components/dashboard/KpiCard";
import { KpiSkeleton } from "../../components/dashboard/LoadingSkeleton";
import ChartCard from "../../components/dashboard/ChartCard";
import DateRangeFilter from "../../components/dashboard/DateRangeFilter";
import RecentActivityTable from "../../components/dashboard/RecentActivityTable";
import AttentionPanel from "../../components/dashboard/AttentionPanel";
import ErrorState from "../../components/common/ErrorState";
import QuickActionButton from "../../components/dashboard/QuickActionButton";
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CHART_COLORS, STATUS_COLORS, gridProps, axisProps, yAxisProps, tooltipProps, barProps, lineProps } from "../../components/dashboard/chartTheme";

// Phase 21 - Admin's dashboard: an organization-scoped composition, same
// shape as Super Admin's, MINUS the financial section - ADMIN does not hold
// REPORT_FINANCIAL_VIEW by default (see packages/shared/src/permissions.js's
// own explicit note: it deliberately also lacks PAYMENT_VIEW/WALLET_VIEW, so
// granting REPORT_FINANCIAL_VIEW here would be a real scope increase, not a
// natural extension). `canFinancial` is still checked (not hardcoded false)
// so a future/edited permission grant is respected automatically.
// Bar colours follow the status they show (issued, being prepared, failed).
const ORDER_STATUS_FILLS = [STATUS_COLORS.issued, STATUS_COLORS.preparing, STATUS_COLORS.failed];

export default function AdminDashboard() {
  const { user } = useAuth();
  const canFinancial = hasPermission(user, PERMISSIONS.REPORT_FINANCIAL_VIEW);

  const [preset, setPreset] = useState("last30days");
  const [summary, setSummary] = useState(null);
  const [summaryErr, setSummaryErr] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [requests, setRequests] = useState(null);
  const [requestsErr, setRequestsErr] = useState(null);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [activity, setActivity] = useState(null);
  const [activityErr, setActivityErr] = useState(null);
  const [activityLoading, setActivityLoading] = useState(true);

  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    setSummaryErr(null);
    apiClient
      .get("/reports/dashboard")
      .then((r) => setSummary(r.data.data))
      .catch((err) => setSummaryErr(errorMessage(err, "Failed to load summary.")))
      .finally(() => setSummaryLoading(false));
  }, []);

  const loadRequests = useCallback(() => {
    setRequestsLoading(true);
    setRequestsErr(null);
    apiClient
      .get("/reports/requests", { params: { preset } })
      .then((r) => setRequests(r.data.data))
      .catch((err) => setRequestsErr(errorMessage(err, "Failed to load request analytics.")))
      .finally(() => setRequestsLoading(false));
  }, [preset]);

  const loadActivity = useCallback(() => {
    setActivityLoading(true);
    setActivityErr(null);
    apiClient
      .get("/reports/recent-activity", { params: { limit: 5 } })
      .then((r) => setActivity(r.data.data))
      .catch((err) => setActivityErr(errorMessage(err, "Failed to load recent activity.")))
      .finally(() => setActivityLoading(false));
  }, []);

  useEffect(() => {
    loadSummary();
    loadActivity();
  }, [loadSummary, loadActivity]);
  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const alerts = [];
  if (summary && summary.orders.failed > 0) {
    alerts.push({ level: "warning", text: `${summary.orders.failed} order(s) have failed processing.` });
  }

  return (
    <div className="space-y-6">
      <DashboardHeader
        name={user?.name}
        subtitle="Organization overview"
        actions={
          <>
            {hasPermission(user, PERMISSIONS.ESTAMP_CREATE) && <QuickActionButton to="/estamps/requests/new" label="New E-Stamp Request" icon={FilePlus2} primary />}
            {hasPermission(user, PERMISSIONS.ESTAMP_BULK_CREATE) && <QuickActionButton to="/estamps/bulk" label="Bulk Request" icon={Files} />}
            {hasPermission(user, PERMISSIONS.USER_VIEW) && <QuickActionButton to="/users" label="Users" icon={Users} />}
            {hasPermission(user, PERMISSIONS.REPORT_VIEW) && <QuickActionButton to="/reports" label="Full Reports" icon={BarChart3} />}
          </>
        }
      />

      {/* GET /wallet/balance is open to request-creating roles; the wallet
          page itself needs WALLET_VIEW, which ADMIN does not hold by default. */}
      {hasPermission(user, PERMISSIONS.ESTAMP_CREATE) && (
        <ClientBalanceCard canAddMoney={hasPermission(user, PERMISSIONS.PAYMENT_MANAGE)} showLedgerLink={hasPermission(user, PERMISSIONS.WALLET_VIEW)} />
      )}

      {summaryErr && <ErrorState message={summaryErr} onRetry={loadSummary} />}
      {summaryLoading && <KpiSkeleton count={4} />}
      {!summaryLoading && summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="In the 20-minute window" value={inWindowCount(summary)} icon={Timer} tone="blue" />
          <KpiCard label="Being prepared" value={summary.orders.processing} icon={Hourglass} tone="violet" />
          {summary.orders.issuedThisMonth !== undefined && <KpiCard label="Issued this month" value={summary.orders.issuedThisMonth} icon={BadgeCheck} tone="emerald" />}
              {summary.payments && <KpiCard label="Awaiting balance update" value={summary.payments.awaitingBalanceUpdate} icon={Clock} tone="marigold" />}
              <KpiCard label="Issued orders" value={summary.orders.issued} icon={BadgeCheck} tone="emerald" />
          <KpiCard label="Failed orders" value={summary.orders.failed} icon={XCircle} tone="vermilion" />
          <KpiCard label="Total requests" value={summary.requests.total} icon={FileText} tone="grey" />
          <KpiCard label="Total orders" value={summary.orders.total} icon={Package} tone="grey" />
          {canFinancial && summary.financial && <KpiCard label="Successful payments" value={formatCurrency(summary.financial.successfulPaymentsAmount)} icon={BadgeIndianRupee} tone="emerald" />}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard
          title="Requests over time"
          action={<DateRangeFilter value={preset} onChange={setPreset} />}
          loading={requestsLoading}
          error={requestsErr} onRetry={loadRequests}
          empty={!requests?.dailyTrend?.length}
          emptyText="No requests in this range."
        >
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={requests?.dailyTrend || []}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} />
              <YAxis allowDecimals={false} {...yAxisProps} />
              <Tooltip {...tooltipProps} />
              <Line {...lineProps} dataKey="count" name="Requests" stroke={CHART_COLORS[0]} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Order status" loading={summaryLoading} error={summaryErr} onRetry={loadSummary} empty={!summary || summary.orders.total === 0} emptyText="No orders yet.">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={
                summary
                  ? [
                      { status: "Issued", count: summary.orders.issued },
                      { status: "Being prepared", count: summary.orders.processing },
                      { status: "Failed", count: summary.orders.failed },
                    ]
                  : []
              }
            >
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="status" {...axisProps} />
              <YAxis allowDecimals={false} {...yAxisProps} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="count" name="Orders" {...barProps}>
                {ORDER_STATUS_FILLS.map((fill) => (
                  <Cell key={fill} fill={fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <AttentionPanel alerts={alerts} loading={summaryLoading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentActivityTable
          title="Recent requests"
          loading={activityLoading}
          error={activityErr} onRetry={loadActivity}
          rows={activity?.requests}
          rowLinkPrefix="/estamps/requests"
          columns={[
            { key: "requestNumber", label: "Request #", render: (r) => <span className="font-medium text-slate-900">{r.requestNumber}</span> },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} remainingSeconds={typeof r.windowRemainingSeconds === "number" ? r.windowRemainingSeconds : undefined} deadline={r.windowExpiresAt || r.modificationDeadline} /> },
            { key: "calculatedStampDuty", label: "Value", render: (r) => <span className="tabular-nums">{formatCurrency(r.calculatedStampDuty)}</span> },
          ]}
        />
        <RecentActivityTable
          title="Recent orders"
          loading={activityLoading}
          error={activityErr} onRetry={loadActivity}
          rows={activity?.orders}
          rowLinkPrefix="/orders"
          columns={[
            { key: "orderNumber", label: "Order #", render: (r) => <span className="font-medium text-slate-900">{r.orderNumber}</span> },
            { key: "eStampStatus", label: "Status", render: (r) => <StatusBadge status={r.eStampStatus} /> },
            { key: "amount", label: "Amount", render: (r) => <span className="tabular-nums">{formatCurrency(r.amount)}</span> },
          ]}
        />
      </div>
    </div>
  );
}
