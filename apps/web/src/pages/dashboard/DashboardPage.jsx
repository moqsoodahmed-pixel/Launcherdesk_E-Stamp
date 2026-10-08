import { useAuth } from "../../context/AuthContext";
import MasterAdminDashboard from "./MasterAdminDashboard";
import AssistantDashboard from "./AssistantDashboard";
import SuperAdminDashboard from "./SuperAdminDashboard";
import AdminDashboard from "./AdminDashboard";
import UserDashboard from "./UserDashboard";

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
    default:
      return <UserDashboard />;
  }
}
