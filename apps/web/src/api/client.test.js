import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import axios from "axios";
import { apiClient } from "./client";

// Fake network: a custom axios adapter shared by apiClient and the plain
// axios instance used for /auth/refresh.
let refreshCalls;
let refreshResult;
function adapter(config) {
  const url = config.url;
  const auth = config.headers?.Authorization || config.headers?.get?.("Authorization");
  const respond = (status, data) => {
    const res = { status, data, headers: {}, config, statusText: String(status) };
    if (status >= 400) {
      const err = new axios.AxiosError("fail", "ERR_BAD_RESPONSE", config, null, res);
      return Promise.reject(err);
    }
    return Promise.resolve(res);
  };
  if (url.endsWith("/auth/refresh")) {
    refreshCalls += 1;
    return new Promise((r) => setTimeout(r, 10)).then(() => refreshResult());
  }
  if (url.endsWith("/auth/login")) return respond(401, { message: "Invalid credentials" });
  return auth === "Bearer fresh" ? respond(200, { data: { url } }) : respond(401, { message: "expired" });
}

const originalLocation = window.location;
beforeEach(() => {
  refreshCalls = 0;
  localStorage.setItem("ld_access_token", "stale");
  localStorage.setItem("ld_refresh_token", "r1");
  apiClient.defaults.adapter = adapter;
  axios.defaults.adapter = adapter;
  delete window.location;
  window.location = { pathname: "/dashboard", search: "?x=1", href: "" };
});
afterEach(() => {
  window.location = originalLocation;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("apiClient - single-flight token refresh", () => {
  it("refreshes ONCE for parallel 401s and replays every request with the new token", async () => {
    refreshResult = () => ({ status: 200, data: { data: { accessToken: "fresh", refreshToken: "r2" } }, headers: {}, config: {} });
    const results = await Promise.all(["/a", "/b", "/c", "/d"].map((u) => apiClient.get(u)));
    expect(refreshCalls).toBe(1);
    expect(results.map((r) => r.data.data.url)).toEqual(["/a", "/b", "/c", "/d"]);
    expect(localStorage.getItem("ld_refresh_token")).toBe("r2");
  });

  it("logs out (once) and keeps the attempted URL when the refresh fails", async () => {
    refreshResult = () => Promise.reject(new axios.AxiosError("bad", "ERR", {}, null, { status: 401, data: {} }));
    const results = await Promise.allSettled([apiClient.get("/a"), apiClient.get("/b")]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(localStorage.getItem("ld_access_token")).toBeNull();
    expect(window.location.href).toBe(`/login?sessionExpired=1&next=${encodeURIComponent("/dashboard?x=1")}`);
  });

  it("keeps the session when the refresh is rate-limited (429)", async () => {
    refreshResult = () => Promise.reject(new axios.AxiosError("slow down", "ERR", {}, null, { status: 429, data: {} }));
    await expect(apiClient.get("/a")).rejects.toMatchObject({ response: { status: 429 } });
    expect(localStorage.getItem("ld_refresh_token")).toBe("r1");
    expect(window.location.href).toBe("");
  });

  it("never tries to refresh when the login call itself returns 401", async () => {
    await expect(apiClient.post("/auth/login", {})).rejects.toMatchObject({ response: { status: 401 } });
    expect(refreshCalls).toBe(0);
  });

  it("does not bounce a public auth page (reset password) to login when a stale session fails to refresh", async () => {
    window.location = { pathname: "/reset-password", search: "?token=t", href: "" };
    refreshResult = () => Promise.reject(new axios.AxiosError("bad", "ERR", {}, null, { status: 401, data: {} }));
    await expect(apiClient.get("/a")).rejects.toBeTruthy();
    expect(window.location.href).toBe("");
    expect(localStorage.getItem("ld_access_token")).toBeNull();
  });

  it("has a request timeout", () => {
    expect(apiClient.defaults.timeout).toBeGreaterThan(0);
  });
});
