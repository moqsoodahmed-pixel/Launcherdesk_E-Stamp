import axios from "axios";
// Never hard-code secrets here - only public API base URL.
// VITE_API_BASE_URL is baked in at BUILD time. In production a missing value
// is a deployment mistake: main.jsx renders a configuration error page
// instead of silently calling localhost from the user's browser.
const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;
export const API_CONFIG_MISSING = import.meta.env.PROD && !configuredBaseUrl;
export const API_BASE_URL = configuredBaseUrl || "http://localhost:5000/api/v1";
export const REQUEST_TIMEOUT_MS = 20000;

export const apiClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
});
apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem("ld_access_token");
    if (token)
        config.headers.Authorization = `Bearer ${token}`;
    return config;
});

// Requests whose 401 means "bad credentials / bad code", never "access token
// expired" - refreshing on these would loop or mask the real error.
const NO_REFRESH_PATHS = ["/auth/login", "/auth/refresh", "/auth/logout", "/auth/forgot-password", "/auth/reset-password"];
function isAuthEndpoint(url = "") {
    const path = url.replace(API_BASE_URL, "").split("?")[0];
    return NO_REFRESH_PATHS.some((p) => path === p || path.startsWith(`${p}/`)) || path.includes("otp");
}

// Single-flight refresh: when several requests 401 at once (e.g. the four
// dashboard panels after the 15-minute access token expires), they all wait
// on ONE shared refresh call and are replayed with the new token. The refresh
// token rotates on every use, so two parallel refresh calls would invalidate
// each other - hence exactly one in flight at a time.
let refreshPromise = null;
function refreshAccessToken() {
    if (!refreshPromise) {
        refreshPromise = (async () => {
            const refreshToken = localStorage.getItem("ld_refresh_token");
            if (!refreshToken)
                throw new Error("No refresh token");
            // Plain axios (not apiClient) so this call never re-enters the
            // interceptor below.
            const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken }, { timeout: REQUEST_TIMEOUT_MS });
            localStorage.setItem("ld_access_token", data.data.accessToken);
            localStorage.setItem("ld_refresh_token", data.data.refreshToken);
            return data.data.accessToken;
        })().finally(() => {
            refreshPromise = null;
        });
    }
    return refreshPromise;
}

function endSession() {
    localStorage.removeItem("ld_access_token");
    localStorage.removeItem("ld_refresh_token");
    const { pathname, search } = window.location;
    if (!pathname.startsWith("/login")) {
        const next = encodeURIComponent(`${pathname}${search}`);
        window.location.href = `/login?sessionExpired=1&next=${next}`;
    }
}

apiClient.interceptors.response.use((res) => res, async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || !original || original._retry || isAuthEndpoint(original.url)) {
        return Promise.reject(error);
    }
    original._retry = true;
    let token;
    try {
        token = await refreshAccessToken();
    }
    catch (refreshError) {
        // A 429 on refresh is temporary - keep the session and surface the
        // rate-limit message instead of logging the user out.
        if (refreshError?.response?.status === 429)
            return Promise.reject(refreshError);
        endSession();
        return Promise.reject(error);
    }
    original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
    return apiClient(original);
});
