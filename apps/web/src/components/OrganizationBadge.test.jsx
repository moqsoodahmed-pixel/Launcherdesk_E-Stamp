import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import OrganizationBadge from "./OrganizationBadge";
import { apiClient } from "../api/client";
import { useAuth } from "../context/AuthContext";

vi.mock("../api/client", () => ({ apiClient: { get: vi.fn() } }));
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("OrganizationBadge", () => {
  it("fetches and shows the tenant's own organization logo and name for a Super Admin", async () => {
    useAuth.mockReturnValue({ user: { role: "SUPER_ADMIN", organizationId: "org-1" } });
    apiClient.get.mockResolvedValue({ data: { data: { name: "Acme Pvt Ltd", logoUrl: "https://cdn.example/acme-logo.png" } } });
    render(<OrganizationBadge />);
    expect(await screen.findByText("Acme Pvt Ltd")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/profile/organization");
    expect(screen.getByAltText("Acme Pvt Ltd logo")).toHaveAttribute("src", "https://cdn.example/acme-logo.png");
  });

  it("falls back to initials when no logo has been uploaded", async () => {
    useAuth.mockReturnValue({ user: { role: "ADMIN", organizationId: "org-1" } });
    apiClient.get.mockResolvedValue({ data: { data: { name: "Acme Pvt Ltd", logoUrl: null } } });
    render(<OrganizationBadge />);
    expect(await screen.findByText("Acme Pvt Ltd")).toBeInTheDocument();
    expect(screen.getByText("AP")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders nothing for Master Admin (no single organization of their own)", () => {
    useAuth.mockReturnValue({ user: { role: "MASTER_ADMIN", organizationId: null } });
    const { container } = render(<OrganizationBadge />);
    expect(container).toBeEmptyDOMElement();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("renders nothing for a Vendor (no organization)", () => {
    useAuth.mockReturnValue({ user: { role: "VENDOR", organizationId: null } });
    const { container } = render(<OrganizationBadge />);
    expect(container).toBeEmptyDOMElement();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("renders nothing if the fetch fails, rather than throwing", async () => {
    useAuth.mockReturnValue({ user: { role: "USER", organizationId: "org-1" } });
    apiClient.get.mockRejectedValue(new Error("network error"));
    const { container } = render(<OrganizationBadge />);
    await vi.waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
