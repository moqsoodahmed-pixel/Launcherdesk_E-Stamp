import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
// Route-level guard for UX purposes ONLY. The backend re-enforces every
// one of these checks independently - this component is not the security
// boundary, it just avoids showing the wrong UI.
export default function ProtectedRoute({ allowedRoles }) {
    const { user, loading } = useAuth();
    if (loading)
        return <div className="p-8 text-center text-slate-500">Loading...</div>;
    if (!user)
        return <Navigate to="/login" replace/>;
    if (allowedRoles && !allowedRoles.includes(user.role))
        return <Navigate to="/dashboard" replace/>;
    return <Outlet />;
}
