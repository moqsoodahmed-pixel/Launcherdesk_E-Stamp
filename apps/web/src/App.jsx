import { lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/auth/LoginPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import DashboardLayout from "./layouts/DashboardLayout";
import DashboardPage from "./pages/dashboard/DashboardPage";
const NewRequestPage = lazy(() => import("./pages/estamps/NewRequestPage"));
const RequestsListPage = lazy(() => import("./pages/estamps/RequestsListPage"));
const RequestDetailPage = lazy(() => import("./pages/estamps/RequestDetailPage"));
const BulkEStampPage = lazy(() => import("./pages/estamps/BulkEStampPage"));
const BulkUploadWizard = lazy(() => import("./pages/estamps/BulkUploadWizard"));
const BulkBatchDetailPage = lazy(() => import("./pages/estamps/BulkBatchDetailPage"));
const OrganizationsListPage = lazy(() => import("./pages/organizations/OrganizationsListPage"));
const CreateOrganizationPage = lazy(() => import("./pages/organizations/CreateOrganizationPage"));
const OrganizationDetailPage = lazy(() => import("./pages/organizations/OrganizationDetailPage"));
const ArticlesPage = lazy(() => import("./pages/articles/ArticlesPage"));
const WalletPage = lazy(() => import("./pages/wallet/WalletPage"));
const OrdersListPage = lazy(() => import("./pages/orders/OrdersListPage"));
const OrderDetailPage = lazy(() => import("./pages/orders/OrderDetailPage"));
const FulfilQueuePage = lazy(() => import("./pages/orders/FulfilQueuePage"));
import ProviderOnly from "./routes/ProviderOnly";
const EStampProviderPage = lazy(() => import("./pages/provider/EStampProviderPage"));
const PaymentsListPage = lazy(() => import("./pages/wallet/PaymentsListPage"));
const PaymentDetailPage = lazy(() => import("./pages/wallet/PaymentDetailPage"));
const CreditQueuePage = lazy(() => import("./pages/wallet/CreditQueuePage"));
const UsersListPage = lazy(() => import("./pages/users/UsersListPage"));
const CreateUserPage = lazy(() => import("./pages/users/CreateUserPage"));
const EditUserPage = lazy(() => import("./pages/users/EditUserPage"));
const ReportsPage = lazy(() => import("./pages/reports/ReportsPage"));
const NotificationsPage = lazy(() => import("./pages/notifications/NotificationsPage"));
const AuditLogsPage = lazy(() => import("./pages/audit/AuditLogsPage"));
const MyActivityPage = lazy(() => import("./pages/audit/MyActivityPage"));
const PolicyPage = lazy(() => import("./pages/policies/PolicyPage"));
const PolicyAdminPage = lazy(() => import("./pages/policies/PolicyAdminPage"));
const SystemSettingsPage = lazy(() => import("./pages/settings/SystemSettingsPage"));
import ProtectedRoute from "./routes/ProtectedRoute";
import RequireAccess from "./routes/RequireAccess";
import NotFoundPage from "./pages/NotFoundPage";
import ChangePasswordPage from "./pages/auth/ChangePasswordPage";
import { PERMISSIONS as P } from "./utils/permissions";
const AboutPage = lazy(() => import("./pages/about/AboutPage"));
const ProfilePage = lazy(() => import("./pages/profile/ProfilePage"));
const CompanyProfilePage = lazy(() => import("./pages/organizations/CompanyProfilePage"));
const EStampsPage = lazy(() => import("./pages/estamps/EStampsPage"));
const AssistantAdminsPage = lazy(() => import("./pages/assistants/AssistantAdminsPage"));
const VendorOrdersPage = lazy(() => import("./pages/vendor/VendorOrdersPage"));
const VendorOrderDetailPage = lazy(() => import("./pages/vendor/VendorOrderDetailPage"));
const DispatchPage = lazy(() => import("./pages/orders/DispatchPage"));
const VendorReviewPage = lazy(() => import("./pages/orders/VendorReviewPage"));
const VendorsPage = lazy(() => import("./pages/vendors/VendorsPage"));

const INTERNAL = ["MASTER_ADMIN", "ASSISTANT_MASTER_ADMIN"];
// Creating requests/batches charges the caller's own organization wallet;
// internal roles have no organization, so the API rejects them.
const TENANT = ["SUPER_ADMIN", "ADMIN", "USER"];
const VENDOR = ["VENDOR"];
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
          <Route path="/estamps" element={guard(<EStampsPage />, P.ESTAMP_VIEW)}/>

          <Route path="/organizations" element={guard(<OrganizationsListPage />, P.CLIENT_VIEW, INTERNAL)}/>
          <Route path="/organizations/new" element={guard(<CreateOrganizationPage />, P.CLIENT_MANAGE, INTERNAL)}/>
          <Route path="/organizations/:id" element={guard(<OrganizationDetailPage />, P.CLIENT_VIEW, INTERNAL)}/>
          <Route path="/assistant-admins" element={guard(<AssistantAdminsPage />, null, ["MASTER_ADMIN"])}/>
          <Route path="/users" element={guard(<UsersListPage />, P.USER_VIEW)}/>
          <Route path="/users/new" element={guard(<CreateUserPage />, P.USER_CREATE)}/>
          <Route path="/users/:id" element={guard(<EditUserPage />, P.USER_VIEW)}/>
          <Route path="/orders" element={guard(<OrdersListPage />, P.ORDER_VIEW)}/>
          <Route path="/orders/fulfil" element={guard(<FulfilQueuePage />, P.ORDER_MANAGE, INTERNAL)}/>
          <Route path="/orders/dispatch" element={guard(<DispatchPage />, P.ORDER_MANAGE, INTERNAL)}/>
          <Route path="/orders/vendor-review" element={guard(<VendorReviewPage />, P.ORDER_MANAGE, INTERNAL)}/>
          <Route path="/vendors" element={guard(<VendorsPage />, null, ["MASTER_ADMIN"])}/>
          <Route path="/vendor/orders" element={guard(<VendorOrdersPage />, null, VENDOR)}/>
          <Route path="/vendor/orders/:id" element={guard(<VendorOrderDetailPage />, null, VENDOR)}/>
          <Route path="/orders/:id" element={guard(<OrderDetailPage />, P.ORDER_VIEW)}/>
          <Route path="/estamp-provider" element={guard(<ProviderOnly><EStampProviderPage /></ProviderOnly>, P.ESTAMP_PROVIDER_VIEW)}/>
          <Route path="/articles" element={guard(<ArticlesPage />, P.ARTICLE_VIEW)}/>
          <Route path="/payments" element={guard(<PaymentsListPage />, P.PAYMENT_VIEW)}/>
          <Route path="/payments/credit-queue" element={guard(<CreditQueuePage />, P.WALLET_MANAGE, INTERNAL)}/>
          <Route path="/payments/:id" element={guard(<PaymentDetailPage />, P.PAYMENT_VIEW)}/>
          <Route path="/wallet" element={guard(<WalletPage />, P.WALLET_VIEW)}/>
          <Route path="/reports" element={guard(<ReportsPage />, P.REPORT_VIEW)}/>
          <Route path="/notifications" element={<NotificationsPage />}/>
          <Route path="/audit" element={guard(<AuditLogsPage />, P.AUDIT_VIEW)}/>
          <Route path="/audit/mine" element={<MyActivityPage />}/>
          <Route path="/policies" element={<PolicyPage />}/>
          <Route path="/policies/manage" element={guard(<PolicyAdminPage />, P.POLICY_VIEW)}/>
          <Route path="/settings" element={guard(<SystemSettingsPage />, P.SETTINGS_VIEW)}/>
          <Route path="/organization/profile" element={guard(<CompanyProfilePage />, null, ["SUPER_ADMIN"])}/>
          <Route path="/about" element={<AboutPage />}/>
          <Route path="/profile" element={<ProfilePage />}/>
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace/>}/>
      <Route path="*" element={<NotFoundPage />}/>
    </Routes>);
}
