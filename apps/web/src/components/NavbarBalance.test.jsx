import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NavbarBalance from "./NavbarBalance";
import { apiClient } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PERMISSIONS } from "../utils/permissions";

vi.mock("../api/client", () => ({ apiClient: { get: vi.fn() } }));
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("NavbarBalance", () => {
  it("shows red color and low/zero indicator when available balance is 0 for Super Admin", async () => {
    useAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN", organizationId: "org-1", permissions: [PERMISSIONS.WALLET_VIEW] },
    });
    apiClient.get.mockResolvedValue({
      data: { data: { availableBalance: 0, balance: 0, reservedBalance: 0 } },
    });

    render(
      <MemoryRouter>
        <NavbarBalance />
      </MemoryRouter>
    );

    expect(await screen.findByText("₹0")).toBeInTheDocument();
    const amountSpan = screen.getByText("₹0");
    expect(amountSpan).toHaveClass("text-red-600");

    // Links to /wallet for user with WALLET_VIEW
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/wallet");
  });

  it("shows green color when available balance is positive", async () => {
    useAuth.mockReturnValue({
      user: { role: "ADMIN", organizationId: "org-1", permissions: [] },
    });
    apiClient.get.mockResolvedValue({
      data: { data: { availableBalance: 2500, balance: 2500, reservedBalance: 0 } },
    });

    render(
      <MemoryRouter>
        <NavbarBalance />
      </MemoryRouter>
    );

    expect(await screen.findByText("₹2,500")).toBeInTheDocument();
    const amountSpan = screen.getByText("₹2,500");
    expect(amountSpan).toHaveClass("text-emerald-700");

    // Not a link if no WALLET_VIEW permission
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders nothing for Master Admin (no tenant organization)", () => {
    useAuth.mockReturnValue({ user: { role: "MASTER_ADMIN", organizationId: null } });
    const { container } = render(
      <MemoryRouter>
        <NavbarBalance />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("renders nothing for Vendor", () => {
    useAuth.mockReturnValue({ user: { role: "VENDOR", organizationId: null } });
    const { container } = render(
      <MemoryRouter>
        <NavbarBalance />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("updates balance when ld:balance_refresh event is dispatched", async () => {
    useAuth.mockReturnValue({
      user: { role: "USER", organizationId: "org-1", permissions: [] },
    });
    apiClient.get
      .mockResolvedValueOnce({
        data: { data: { availableBalance: 0, balance: 0 } },
      })
      .mockResolvedValueOnce({
        data: { data: { availableBalance: 5000, balance: 5000 } },
      });

    render(
      <MemoryRouter>
        <NavbarBalance />
      </MemoryRouter>
    );

    expect(await screen.findByText("₹0")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("ld:balance_refresh"));
    });

    expect(await screen.findByText("₹5,000")).toBeInTheDocument();
  });
});
