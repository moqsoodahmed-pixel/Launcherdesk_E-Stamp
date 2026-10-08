import { createContext, useContext, useState, useEffect } from "react";
import { apiClient } from "../api/client";
const AuthContext = createContext(undefined);
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const token = localStorage.getItem("ld_access_token");
        if (!token) {
            setLoading(false);
            return;
        }
        apiClient
            .get("/auth/me")
            .then(({ data }) => setUser(data.data))
            .catch(() => {
            localStorage.removeItem("ld_access_token");
            localStorage.removeItem("ld_refresh_token");
        })
            .finally(() => setLoading(false));
    }, []);
    async function loginStep1(email, password) {
        const { data } = await apiClient.post("/auth/login", { email, password });
        if (data.data.requiresOtp) {
            return { requiresOtp: true, challengeToken: data.data.challengeToken };
        }
        persistSession(data.data);
        return { requiresOtp: false };
    }
    async function verifyOtp(challengeToken, code) {
        const { data } = await apiClient.post("/auth/login/verify-otp", { otpToken: challengeToken, code });
        persistSession(data.data);
    }
    async function forgotPassword(email) {
        const { data } = await apiClient.post("/auth/forgot-password", { email });
        return data.data; // { challengeToken, message } - challengeToken absent/irrelevant if email unknown
    }
    async function resetPassword(resetToken, code, newPassword) {
        const { data } = await apiClient.post("/auth/reset-password", { resetToken, code, newPassword });
        return data.data;
    }
    function persistSession(payload) {
        localStorage.setItem("ld_access_token", payload.accessToken);
        localStorage.setItem("ld_refresh_token", payload.refreshToken);
        setUser(payload.user);
    }
    async function logout() {
        const refreshToken = localStorage.getItem("ld_refresh_token");
        try {
            await apiClient.post("/auth/logout", { refreshToken });
        }
        finally {
            localStorage.removeItem("ld_access_token");
            localStorage.removeItem("ld_refresh_token");
            setUser(null);
        }
    }
    return (<AuthContext.Provider value={{ user, loading, loginStep1, verifyOtp, logout, forgotPassword, resetPassword }}>{children}</AuthContext.Provider>);
}
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx)
        throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
