import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CompanyProfilePage from "./CompanyProfilePage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn() } }));

const ORG = {
  name: "Acme Pvt Ltd",
  status: "ACTIVE",
  contactEmail: "ops@acme.test",
  contactPhone: "9876543210",
  gstin: "29ABCDE1234F1Z5",
  address: "1 MG Road, Bengaluru",
  isEstampServiceEnabled: true,
  createdAt: "2026-01-15T00:00:00.000Z",
};

beforeEach(() => vi.clearAllMocks());

describe("CompanyProfilePage", () => {
  it("loads GET /profile/organization and shows the details read-only", async () => {
    apiClient.get.mockResolvedValue({ data: { data: ORG } });
    render(<CompanyProfilePage />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
    expect(await screen.findByText("Acme Pvt Ltd")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/profile/organization", expect.anything());
    expect(screen.getByText("29ABCDE1234F1Z5")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText(/To change company details contact support/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows an error with Retry", async () => {
    apiClient.get.mockRejectedValueOnce({ response: { status: 500, data: {} } }).mockResolvedValueOnce({ data: { data: ORG } });
    render(<CompanyProfilePage />);
    expect(await screen.findByText("Failed to load your company profile.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Acme Pvt Ltd")).toBeInTheDocument();
  });

  it("shows an empty state when the account has no organization (404)", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 404, data: {} } });
    render(<CompanyProfilePage />);
    expect(await screen.findByText("No company linked")).toBeInTheDocument();
  });
});
