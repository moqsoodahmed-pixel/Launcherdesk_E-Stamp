import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SidebarBalance from "./SidebarBalance";
import { apiClient } from "../api/client";
import { useAuth } from "../context/AuthContext";

vi.mock("../api/client", () => ({ apiClient: { get: vi.fn() } }));
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("SidebarBalance", () => {
  it("shows red color and low/zero indicator with amount when available balance is 0 for Super Admin", async () => {
    useAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN", organizationId: "org-1" },
    });
    apiClient.get.mockResolvedValue({
      data: { data: { availableBalance: 0, balance: 0, reservedBalance: 0 } },
    });

    render(
      <MemoryRouter>
        <SidebarBalance item={{ to: "/wallet", label: "Available Balance" }} active={false} />
      </MemoryRouter>
    );

    expect(screen.getByText("Available Balance")).toBeInTheDocument();
    expect(await screen.findByText("₹0")).toBeInTheDocument();
    const amountSpan = screen.getByText("₹0");
    expect(amountSpan).toHaveClass("text-red-600");
  });

  it("shows green color when available balance is positive", async () => {
    useAuth.mockReturnValue({
      user: { role: "ADMIN", organizationId: "org-1" },
    });
    apiClient.get.mockResolvedValue({
      data: { data: { availableBalance: 5000, balance: 5000, reservedBalance: 0 } },
    });

    render(
      <MemoryRouter>
        <SidebarBalance item={{ to: "/wallet", label: "Available Balance" }} active={true} />
      </MemoryRouter>
    );

    expect(screen.getByText("Available Balance")).toBeInTheDocument();
    expect(await screen.findByText("₹5,000")).toBeInTheDocument();
    const amountSpan = screen.getByText("₹5,000");
    expect(amountSpan).toHaveClass("text-emerald-700");
  });

  it("updates balance when ld:balance_refresh is triggered", async () => {
    useAuth.mockReturnValue({
      user: { role: "USER", organizationId: "org-1" },
    });
    apiClient.get
      .mockResolvedValueOnce({
        data: { data: { availableBalance: 0, balance: 0 } },
      })
      .mockResolvedValueOnce({
        data: { data: { availableBalance: 3500, balance: 3500 } },
      });

    render(
      <MemoryRouter>
        <SidebarBalance item={{ to: "/wallet", label: "Available Balance" }} active={false} />
      </MemoryRouter>
    );

    expect(await screen.findByText("₹0")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("ld:balance_refresh"));
    });

    expect(await screen.findByText("₹3,500")).toBeInTheDocument();
  });
});
