import { useAuth } from "../context/AuthContext";
import { hasPermission } from "../utils/permissions";
import ForbiddenPage from "../pages/ForbiddenPage";

// UX-only page guard (the API enforces the same rules). Uses the same
// hasPermission check as the sidebar, so a page is reachable by URL exactly
// when its sidebar link would be shown.
export default function RequireAccess({ permission, roles, children }) {
  const { user } = useAuth();
  if (roles && !roles.includes(user?.role)) return <ForbiddenPage />;
  if (permission && !hasPermission(user, permission)) return <ForbiddenPage />;
  return children;
}
