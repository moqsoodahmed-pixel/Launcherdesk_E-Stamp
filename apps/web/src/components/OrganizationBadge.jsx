import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiClient } from "../api/client";
import OrganizationLogo from "./common/OrganizationLogo";

// Only a tenant role actually belongs to one organization (Master Admin/
// Assistant Master Admin oversee every organization, not one; Vendor has
// none at all - organizationId is always null for both, per User model).
const TENANT_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "USER"]);

// Sits at the far right of the dashboard's top bar (see DashboardLayout.jsx)
// showing the logged-in user's own organization logo + name - the one
// platform-wide place every Super Admin/Admin/User sees their own branding,
// not just Company Profile. Renders nothing for roles with no single
// organization of their own.
export default function OrganizationBadge() {
  const { user } = useAuth();
  const [org, setOrg] = useState(null);

  useEffect(() => {
    if (!user || !TENANT_ROLES.has(user.role)) {
      setOrg(null);
      return undefined;
    }
    let cancelled = false;
    apiClient
      .get("/profile/organization")
      .then((res) => {
        if (!cancelled) setOrg(res.data.data);
      })
      .catch(() => {
        if (!cancelled) setOrg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.role, user?.organizationId]);

  if (!user || !TENANT_ROLES.has(user.role) || !org) return null;

  return (
    <div className="flex items-center gap-2 pl-3 sm:border-l border-white/40" title={org.name}>
      <OrganizationLogo logoUrl={org.logoUrl} name={org.name} size={32} />
      <span className="hidden sm:block text-sm font-medium text-slate-700 max-w-[160px] truncate">{org.name}</span>
    </div>
  );
}
