import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import EStampsPage from "./EStampsPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn() } }));
let mockUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const ISSUED = { _id: "o1", orderNumber: "ORD-1", stateCode: "KA", amount: 500, issuedAt: "2026-09-01T00:00:00Z", downloadStatus: "AVAILABLE" };
const PENDING_CERT = { ...ISSUED, _id: "o2", orderNumber: "ORD-2", downloadStatus: "NOT_AVAILABLE" };
const ok = (data) => Promise.resolve({ data: { data } });

function mockApi(ordersImpl) {
  apiClient.get.mockImplementation((url, config) => {
    if (url === "/articles/states") return ok(["KA", "MH"]);
    if (url === "/orders") return ordersImpl(config);
    if (url === "/files/estamp/o1/download") return ok({ url: "https://signed.example/x", filename: "ORD-1.pdf" });
    return ok([]);
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <EStampsPage />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { role: "SUPER_ADMIN", permissions: ["estamp.view", "estamp.download"] };
});
afterEach(() => vi.unstubAllGlobals());

describe("EStampsPage", () => {
  it("lists only ISSUED orders with a link, and Download only when a certificate exists", async () => {
    mockApi(() => ok({ items: [ISSUED, PENDING_CERT], total: 2 }));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
    expect(await screen.findByRole("link", { name: "ORD-1" })).toHaveAttribute("href", "/orders/o1");
    const ordersCall = apiClient.get.mock.calls.find(([url]) => url === "/orders");
    expect(ordersCall[1].params.eStampStatus).toBe("ISSUED");
    expect(screen.getByRole("button", { name: "Download certificate for ORD-1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download certificate for ORD-2" })).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing has been issued", async () => {
    mockApi(() => ok({ items: [], total: 0 }));
    renderPage();
    expect(await screen.findByText("No issued E-Stamps yet")).toBeInTheDocument();
  });

  it("shows an error with Retry", async () => {
    let calls = 0;
    mockApi(() => (++calls === 1 ? Promise.reject({ response: { status: 500, data: {} } }) : ok({ items: [ISSUED], total: 1 })));
    renderPage();
    expect(await screen.findByText("Failed to load E-Stamps.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "ORD-1" })).toBeInTheDocument();
  });

  it("downloads via the signed URL as a blob saved under the API filename", async () => {
    mockApi(() => ok({ items: [ISSUED], total: 1 }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["pdf"])) });
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Download certificate for ORD-1" }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("https://signed.example/x");
    expect(clickSpy.mock.contexts[0].download).toBe("ORD-1.pdf");
    clickSpy.mockRestore();
  });

  it("hides Download without estamp.download and sends the state filter", async () => {
    mockUser = { role: "MASTER_ADMIN", permissions: ["estamp.view"] };
    mockApi(() => ok({ items: [ISSUED], total: 1 }));
    renderPage();
    await screen.findByRole("link", { name: "ORD-1" });
    expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText("State"), "MH");
    await waitFor(() => {
      const last = apiClient.get.mock.calls.filter(([url]) => url === "/orders").at(-1);
      expect(last[1].params.stateCode).toBe("MH");
      expect(last[1].params.page).toBe(1);
    });
  });
});
