import { lazy } from "react";
import { useAuth } from "../../context/AuthContext";
import UserDashboard from "./UserDashboard";

// Chart dashboards load on demand (they carry Recharts); each role only
// downloads its own. The layout's Suspense shows the skeleton meanwhile.
const MasterAdminDashboard = lazy(() => import("./MasterAdminDashboard"));
const AssistantDashboard = lazy(() => import("./AssistantDashboard"));
const SuperAdminDashboard = lazy(() => import("./SuperAdminDashboard"));
const AdminDashboard = lazy(() => import("./AdminDashboard"));
import VendorDashboard from "../vendor/VendorDashboard";

// Phase 21 - replaces the single generic dashboard (one /reports/summary
// call + 3 stat cards for every role) with a genuine role-specific
// composition. Each role component independently fetches real,
// tenant-scoped backend data (report.service.js's existing endpoints, plus
// the new bounded /reports/recent-activity) - nothing here is fabricated.
export default function DashboardPage() {
  const { user } = useAuth();
  switch (user?.role) {
    case "MASTER_ADMIN":
      return <MasterAdminDashboard />;
    case "ASSISTANT_MASTER_ADMIN":
      return <AssistantDashboard />;
    case "SUPER_ADMIN":
      return <SuperAdminDashboard />;
    case "ADMIN":
      return <AdminDashboard />;
    case "VENDOR":
      return <VendorDashboard />;
    default:
      return <UserDashboard />;
  }
}
