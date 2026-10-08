import axios from "axios";
// Never hard-code secrets here - only public API base URL.
export const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/v1",
});
apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem("ld_access_token");
    if (token)
        config.headers.Authorization = `Bearer ${token}`;
    return config;
});
// Basic 401 handling: attempt a silent refresh once, else force logout.
let isRefreshing = false;
apiClient.interceptors.response.use((res) => res, async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && !isRefreshing) {
        original._retry = true;
        isRefreshing = true;
        try {
            const refreshToken = localStorage.getItem("ld_refresh_token");
            if (!refreshToken)
                throw new Error("No refresh token");
            const { data } = await apiClient.post("/auth/refresh", { refreshToken });
            localStorage.setItem("ld_access_token", data.data.accessToken);
            localStorage.setItem("ld_refresh_token", data.data.refreshToken);
            isRefreshing = false;
            return apiClient(original);
        }
        catch {
            isRefreshing = false;
            localStorage.removeItem("ld_access_token");
            localStorage.removeItem("ld_refresh_token");
            if (!window.location.pathname.startsWith("/login")) {
                window.location.href = "/login?sessionExpired=1";
            }
        }
    }
    return Promise.reject(error);
});
