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
export default function App() {
    return (<Routes>
      <Route path="/login" element={<LoginPage />}/>
      <Route path="/forgot-password" element={<ForgotPasswordPage />}/>
      <Route path="/reset-password" element={<ResetPasswordPage />}/>

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />}/>

          <Route path="/estamps/requests" element={<RequestsListPage />}/>
          <Route path="/estamps/requests/new" element={<NewRequestPage />}/>
          <Route path="/estamps/requests/:id" element={<RequestDetailPage />}/>
          <Route path="/estamps/bulk" element={<BulkEStampPage />}/>
          <Route path="/estamps/bulk/new" element={<BulkUploadWizard />}/>
          <Route path="/estamps/bulk/:batchId" element={<BulkBatchDetailPage />}/>
          <Route path="/estamps" element={<PlaceholderPage title="E-Stamps"/>}/>

          <Route path="/organizations" element={<OrganizationsListPage />}/>
          <Route path="/organizations/new" element={<CreateOrganizationPage />}/>
          <Route path="/organizations/:id" element={<OrganizationDetailPage />}/>
          <Route path="/assistant-admins" element={<PlaceholderPage title="Assistant Master Admins"/>}/>
          <Route path="/users" element={<UsersListPage />}/>
          <Route path="/users/new" element={<CreateUserPage />}/>
          <Route path="/users/:id" element={<EditUserPage />}/>
          <Route path="/orders" element={<OrdersListPage />}/>
          <Route path="/orders/:id" element={<OrderDetailPage />}/>
          <Route path="/estamp-provider" element={<EStampProviderPage />}/>
          <Route path="/articles" element={<ArticlesPage />}/>
          <Route path="/payments" element={<PaymentsListPage />}/>
          <Route path="/payments/:id" element={<PaymentDetailPage />}/>
          <Route path="/wallet" element={<WalletPage />}/>
          <Route path="/reports" element={<ReportsPage />}/>
          <Route path="/notifications" element={<NotificationsPage />}/>
          <Route path="/audit" element={<AuditLogsPage />}/>
          <Route path="/audit/mine" element={<MyActivityPage />}/>
          <Route path="/policies" element={<PolicyPage />}/>
          <Route path="/policies/manage" element={<PolicyAdminPage />}/>
          <Route path="/settings" element={<SystemSettingsPage />}/>
          <Route path="/files/upload" element={<PlaceholderPage title="Upload"/>}/>
          <Route path="/files/download" element={<PlaceholderPage title="Download"/>}/>
          <Route path="/organization/profile" element={<PlaceholderPage title="Company Profile"/>}/>
          <Route path="/about" element={<PlaceholderPage title="About"/>}/>
          <Route path="/profile" element={<PlaceholderPage title="Profile"/>}/>
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace/>}/>
      <Route path="*" element={<Navigate to="/dashboard" replace/>}/>
    </Routes>);
}
