import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BulkUploadWizard from "./BulkUploadWizard";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), defaults: { baseURL: "" } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: { data: { balance: 1000 } } });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("BulkUploadWizard - accessibility (Phase 38)", () => {
  it("gives the file input an accessible label", async () => {
    render(
      <MemoryRouter>
        <BulkUploadWizard />
      </MemoryRouter>
    );
    expect(await screen.findByLabelText("CSV or XLSX file")).toBeInTheDocument();
  });
});
