import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";
import { apiClient } from "../api/client";

vi.mock("../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

function Probe() {
  const { user, loading } = useAuth();
  return <p>{loading ? "loading" : user ? `user:${user.email}` : "signed-out"}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("ld_access_token", "a");
  localStorage.setItem("ld_refresh_token", "r");
});

describe("AuthProvider session restore", () => {
  it("keeps the stored session when /auth/me fails with a network error", async () => {
    apiClient.get.mockRejectedValue({ isAxiosError: true, request: {} });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByText("signed-out")).toBeInTheDocument());
    expect(localStorage.getItem("ld_refresh_token")).toBe("r");
  });

  it("clears the stored session when /auth/me answers 401", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 401, data: {} } });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByText("signed-out")).toBeInTheDocument());
    expect(localStorage.getItem("ld_refresh_token")).toBeNull();
  });
});
