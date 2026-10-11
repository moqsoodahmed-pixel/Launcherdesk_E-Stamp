import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
// Route-level guard for UX purposes ONLY. The backend re-enforces every
// one of these checks independently - this component is not the security
// boundary, it just avoids showing the wrong UI.
export default function ProtectedRoute() {
    const { user, loading } = useAuth();
    const location = useLocation();
    if (loading)
        return <div className="p-8 text-center text-slate-500">Loading...</div>;
    if (!user)
        // Remember where the user was going; LoginPage sends them back there.
        return <Navigate to="/login" replace state={{ from: { pathname: location.pathname, search: location.search } }}/>;
    return <Outlet />;
}
