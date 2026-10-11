import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/auth/LoginPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import DashboardLayout from "./layouts/DashboardLayout";
import DashboardPage from "./pages/dashboard/DashboardPage";
import NewRequestPage from "./pages/estamps/NewRequestPage";
import RequestsListPage from "./pages/estamps/RequestsListPage";
import RequestDetailPage from "./pages/estamps/RequestDetailPage";
import BulkEStampPage from "./pages/estamps/BulkEStampPage";
import BulkUploadWizard from "./pages/estamps/BulkUploadWizard";
import BulkBatchDetailPage from "./pages/estamps/BulkBatchDetailPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import OrganizationsListPage from "./pages/organizations/OrganizationsListPage";
import CreateOrganizationPage from "./pages/organizations/CreateOrganizationPage";
import OrganizationDetailPage from "./pages/organizations/OrganizationDetailPage";
import ArticlesPage from "./pages/articles/ArticlesPage";
import WalletPage from "./pages/wallet/WalletPage";
import OrdersListPage from "./pages/orders/OrdersListPage";
import OrderDetailPage from "./pages/orders/OrderDetailPage";
import EStampProviderPage from "./pages/provider/EStampProviderPage";
import PaymentsListPage from "./pages/wallet/PaymentsListPage";
import PaymentDetailPage from "./pages/wallet/PaymentDetailPage";
import UsersListPage from "./pages/users/UsersListPage";
import CreateUserPage from "./pages/users/CreateUserPage";
import EditUserPage from "./pages/users/EditUserPage";
import ReportsPage from "./pages/reports/ReportsPage";
import NotificationsPage from "./pages/notifications/NotificationsPage";
import AuditLogsPage from "./pages/audit/AuditLogsPage";
import MyActivityPage from "./pages/audit/MyActivityPage";
import PolicyPage from "./pages/policies/PolicyPage";
import PolicyAdminPage from "./pages/policies/PolicyAdminPage";
import SystemSettingsPage from "./pages/settings/SystemSettingsPage";
import ProtectedRoute from "./routes/ProtectedRoute";
import RequireAccess from "./routes/RequireAccess";
import NotFoundPage from "./pages/NotFoundPage";
import ChangePasswordPage from "./pages/auth/ChangePasswordPage";
import { PERMISSIONS as P } from "./utils/permissions";
import AboutPage from "./pages/about/AboutPage";
import ProfilePage from "./pages/profile/ProfilePage";
import CompanyProfilePage from "./pages/organizations/CompanyProfilePage";
import EStampsPage from "./pages/estamps/EStampsPage";
import AssistantAdminsPage from "./pages/assistants/AssistantAdminsPage";

const INTERNAL = ["MASTER_ADMIN", "ASSISTANT_MASTER_ADMIN"];
// Creating requests/batches charges the caller's own organization wallet;
// internal roles have no organization, so the API rejects them.
const TENANT = ["SUPER_ADMIN", "ADMIN", "USER"];
// Wrap a page in the same permission/role check its sidebar link uses.
const guard = (element, permission, roles) => <RequireAccess permission={permission} roles={roles}>{element}</RequireAccess>;
export default function App() {
    return (<Routes>
      <Route path="/login" element={<LoginPage />}/>
      <Route path="/forgot-password" element={<ForgotPasswordPage />}/>
      <Route path="/reset-password" element={<ResetPasswordPage />}/>

      <Route element={<ProtectedRoute />}>
        {/* Outside DashboardLayout: a forced password change shows no app navigation. */}
        <Route path="/change-password" element={<ChangePasswordPage />}/>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />}/>

          <Route path="/estamps/requests" element={guard(<RequestsListPage />, P.ESTAMP_VIEW)}/>
          <Route path="/estamps/requests/new" element={guard(<NewRequestPage />, P.ESTAMP_CREATE, TENANT)}/>
          <Route path="/estamps/requests/:id" element={guard(<RequestDetailPage />, P.ESTAMP_VIEW)}/>
          <Route path="/estamps/bulk" element={guard(<BulkEStampPage />, P.ESTAMP_BULK_CREATE)}/>
          <Route path="/estamps/bulk/new" element={guard(<BulkUploadWizard />, P.ESTAMP_BULK_CREATE, TENANT)}/>
          <Route path="/estamps/bulk/:batchId" element={guard(<BulkBatchDetailPage />, P.ESTAMP_BULK_CREATE)}/>
          <Route path="/estamps" element={guard(<PlaceholderPage title="E-Stamps"/>, P.ESTAMP_VIEW)}/>

          <Route path="/organizations" element={guard(<OrganizationsListPage />, P.CLIENT_VIEW, INTERNAL)}/>
          <Route path="/organizations/new" element={guard(<CreateOrganizationPage />, P.CLIENT_MANAGE, INTERNAL)}/>
          <Route path="/organizations/:id" element={guard(<OrganizationDetailPage />, P.CLIENT_VIEW, INTERNAL)}/>
          <Route path="/assistant-admins" element={guard(<PlaceholderPage title="Assistant Master Admins"/>, null, ["MASTER_ADMIN"])}/>
          <Route path="/users" element={guard(<UsersListPage />, P.USER_VIEW)}/>
          <Route path="/users/new" element={guard(<CreateUserPage />, P.USER_CREATE)}/>
          <Route path="/users/:id" element={guard(<EditUserPage />, P.USER_VIEW)}/>
          <Route path="/orders" element={guard(<OrdersListPage />, P.ORDER_VIEW)}/>
          <Route path="/orders/:id" element={guard(<OrderDetailPage />, P.ORDER_VIEW)}/>
          <Route path="/estamp-provider" element={guard(<EStampProviderPage />, P.ESTAMP_PROVIDER_VIEW)}/>
          <Route path="/articles" element={guard(<ArticlesPage />, P.ARTICLE_VIEW)}/>
          <Route path="/payments" element={guard(<PaymentsListPage />, P.PAYMENT_VIEW)}/>
          <Route path="/payments/:id" element={guard(<PaymentDetailPage />, P.PAYMENT_VIEW)}/>
          <Route path="/wallet" element={guard(<WalletPage />, P.WALLET_VIEW)}/>
          <Route path="/reports" element={guard(<ReportsPage />, P.REPORT_VIEW)}/>
          <Route path="/notifications" element={<NotificationsPage />}/>
          <Route path="/audit" element={guard(<AuditLogsPage />, P.AUDIT_VIEW)}/>
          <Route path="/audit/mine" element={<MyActivityPage />}/>
          <Route path="/policies" element={<PolicyPage />}/>
          <Route path="/policies/manage" element={guard(<PolicyAdminPage />, P.POLICY_VIEW)}/>
          <Route path="/settings" element={guard(<SystemSettingsPage />, P.SETTINGS_VIEW)}/>
          <Route path="/files/upload" element={guard(<PlaceholderPage title="Upload"/>, P.ESTAMP_UPLOAD)}/>
          <Route path="/files/download" element={guard(<PlaceholderPage title="Download"/>, P.ESTAMP_DOWNLOAD)}/>
          <Route path="/organization/profile" element={<PlaceholderPage title="Company Profile"/>}/>
          <Route path="/about" element={<PlaceholderPage title="About"/>}/>
          <Route path="/profile" element={<PlaceholderPage title="Profile"/>}/>
          <Route path="/estamps" element={<EStampsPage />} />
          <Route path="/assistant-admins" element={<AssistantAdminsPage />} />
          <Route path="/organization/profile" element={<CompanyProfilePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace/>}/>
      <Route path="*" element={<NotFoundPage />}/>
    </Routes>);
}
