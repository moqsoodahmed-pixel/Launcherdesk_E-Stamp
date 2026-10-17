import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CompanyProfilePage from "./CompanyProfilePage";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));

const ORG = {
  name: "Acme Pvt Ltd",
  status: "ACTIVE",
  contactEmail: "ops@acme.test",
  contactPhone: "9876543210",
  gstin: "29ABCDE1234F1Z5",
  address: "1 MG Road, Bengaluru",
  isEstampServiceEnabled: true,
  logoUrl: null,
  createdAt: "2026-01-15T00:00:00.000Z",
};

function asRole(role) {
  useAuth.mockReturnValue({ user: { role } });
}

beforeEach(() => {
  vi.clearAllMocks();
  asRole("SUPER_ADMIN");
});

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

  it("a Super Admin sees the Upload logo control", async () => {
    apiClient.get.mockResolvedValue({ data: { data: ORG } });
    render(<CompanyProfilePage />);
    expect(await screen.findByRole("button", { name: "Upload logo" })).toBeInTheDocument();
  });

  it("an Admin (not Super Admin) never sees an upload control, only the logo itself", async () => {
    asRole("ADMIN");
    apiClient.get.mockResolvedValue({ data: { data: ORG } });
    render(<CompanyProfilePage />);
    await screen.findByText("Acme Pvt Ltd");
    expect(screen.queryByRole("button", { name: /upload logo/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask your Super Admin to add one/)).toBeInTheDocument();
  });

  it("uploading a logo posts multipart to /profile/organization/logo and updates the shown logo", async () => {
    apiClient.get.mockResolvedValue({ data: { data: ORG } });
    apiClient.post.mockResolvedValue({ data: { data: { logoUrl: "https://cdn.example/org-logo.png" } } });
    render(<CompanyProfilePage />);
    await screen.findByText("Acme Pvt Ltd");

    const file = new File(["fake-image-bytes"], "logo.png", { type: "image/png" });
    const input = screen.getByLabelText("Upload company logo");
    await userEvent.upload(input, file);

    expect(apiClient.post).toHaveBeenCalledWith(
      "/profile/organization/logo",
      expect.any(FormData),
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "multipart/form-data" }) })
    );
    expect(await screen.findByRole("button", { name: "Change logo" })).toBeInTheDocument();
  });

  it("rejects a non-PNG/JPEG file client-side without ever calling the API", async () => {
    apiClient.get.mockResolvedValue({ data: { data: ORG } });
    render(<CompanyProfilePage />);
    await screen.findByText("Acme Pvt Ltd");

    const file = new File(["not an image"], "logo.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText("Upload company logo");
    // userEvent.upload() filters files against the input's own accept=
    // attribute before firing change - fireEvent bypasses that so this test
    // actually exercises the component's own (redundant, defense-in-depth)
    // mimetype check rather than the browser's file picker filter.
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("Logo must be a PNG or JPEG image.")).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("removing a logo calls DELETE and reverts to the initials fallback", async () => {
    apiClient.get.mockResolvedValue({ data: { data: { ...ORG, logoUrl: "https://cdn.example/org-logo.png" } } });
    apiClient.delete.mockResolvedValue({ data: { data: { logoUrl: null } } });
    render(<CompanyProfilePage />);
    await screen.findByText("Acme Pvt Ltd");

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(apiClient.delete).toHaveBeenCalledWith("/profile/organization/logo");
    expect(await screen.findByRole("button", { name: "Upload logo" })).toBeInTheDocument();
  });
});
