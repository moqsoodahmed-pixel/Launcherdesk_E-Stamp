import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FulfilQueuePage, { formatAge } from "./FulfilQueuePage";
import OrderDetailPage from "./OrderDetailPage";
import OrdersListPage from "./OrdersListPage";
import RequestDetailPage from "../estamps/RequestDetailPage";
import ProviderOnly from "../../routes/ProviderOnly";
import { getFlatSidebarItems } from "../../layouts/sidebarConfig";
import { PERMISSIONS } from "../../utils/permissions";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
let mockUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const ok = (data) => Promise.resolve({ data: { data } });
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { role: "ASSISTANT_MASTER_ADMIN", fulfilmentMode: "manual", permissions: [PERMISSIONS.ORDER_VIEW, PERMISSIONS.ORDER_MANAGE] };
});

describe("FulfilQueuePage", () => {
  const ROW = { _id: "o1", orderNumber: "LDE-ORD-1", organizationName: "Acme", stateCode: "KA", articleTitle: "Rental Agreement", amount: 500, lockedAt: hoursAgo(3), eStampStatus: "CREATED" };
  const renderQueue = () =>
    render(
      <MemoryRouter>
        <FulfilQueuePage />
      </MemoryRouter>
    );

  it("loads the fulfil queue oldest first and links each order", async () => {
    apiClient.get.mockReturnValue(ok({ items: [ROW], total: 1 }));
    renderQueue();
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
    expect(await screen.findByText("LDE-ORD-1")).toBeInTheDocument();
    expect(screen.getByText("Rental Agreement")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText(/^3 h/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open order LDE-ORD-1" })).toHaveAttribute("href", "/orders/o1");
    expect(apiClient.get.mock.calls[0][1].params).toMatchObject({ queue: "fulfil", sortBy: "createdAt", sortDir: "asc" });
  });

  it("shows the empty state, and an error with Retry", async () => {
    apiClient.get.mockRejectedValueOnce({ response: { status: 500, data: {} } }).mockReturnValueOnce(ok({ items: [], total: 0 }));
    renderQueue();
    expect(await screen.findByText("Failed to load orders to fulfil.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Nothing to fulfil")).toBeInTheDocument();
  });

  it("formats ages", () => {
    const now = Date.now();
    expect(formatAge(new Date(now - 5 * 60000), now)).toBe("5 m");
    expect(formatAge(new Date(now - 125 * 60000), now)).toBe("2 h 05 m");
    expect(formatAge(new Date(now - 50 * 3600000), now)).toBe("2 d 2 h");
  });
});

describe("Order detail - fulfilment panel", () => {
  const detail = (overrides = {}) => ({
    fulfilmentMode: "manual",
    order: { _id: "o1", orderNumber: "LDE-ORD-1", status: "ONGOING", eStampStatus: "CREATED", amount: 500, createdAt: hoursAgo(1), updatedAt: hoursAgo(1) },
    request: { _id: "r1", requestNumber: "REQ-1", status: "LOCKED", stateCode: "KA", articleTitle: "Rental Agreement", firstParty: "Alice", secondParty: "Bob", descriptionOfDocument: "Rent", considerationPrice: 0, calculatedStampDuty: 500, stampDutyPaidBy: "Alice", numberOfEStamps: 1 },
    certificateAvailable: false,
    document: null,
    timeline: [{ label: "Submitted", at: hoursAgo(2) }, { label: "Window ends", at: hoursAgo(1) }, { label: "Queued", at: hoursAgo(1) }],
    availableActions: { start: true, fulfil: true, fail: true, process: false, sync: false },
    ...overrides,
  });
  const renderDetail = () =>
    render(
      <MemoryRouter initialEntries={["/orders/o1"]}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

  it("shows the request details to copy and Start work posts after confirmation", async () => {
    apiClient.get.mockReturnValue(ok(detail()));
    apiClient.post.mockReturnValue(ok({}));
    renderDetail();
    const panel = await screen.findByRole("region", { name: "Fulfilment" });
    expect(within(panel).getAllByText("Alice", { selector: "p" })).toHaveLength(2); // first party + paid by
    expect(within(panel).getByText("Bob", { selector: "p" })).toBeInTheDocument();
    expect(within(panel).getByText("Rental Agreement")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Copy First party" })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Start work" }));
    expect(apiClient.post).not.toHaveBeenCalled();
    await userEvent.click(within(panel).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/orders/o1/start"));
    expect(await screen.findByText(/Work started. The order is now in progress/)).toBeInTheDocument();
  });

  it("upload: needs a file and a stamp reference, sends multipart, and shows a server error without changing anything", async () => {
    apiClient.get.mockReturnValue(ok(detail()));
    apiClient.post.mockRejectedValueOnce({ response: { status: 409, data: { message: "This order has already been issued" } } }).mockReturnValueOnce(ok({}));
    renderDetail();
    const panel = await screen.findByRole("region", { name: "Fulfilment" });
    const submit = within(panel).getByRole("button", { name: "Upload certificate and mark issued" });
    expect(submit).toBeDisabled();
    await userEvent.upload(within(panel).getByLabelText(/Certificate file/), new File(["%PDF-1.4"], "stamp.pdf", { type: "application/pdf" }));
    await userEvent.type(within(panel).getByLabelText("Stamp reference"), "KA-0001");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await userEvent.click(within(panel).getByRole("button", { name: "Upload and issue" }));
    expect(await within(panel).findByText("This order has already been issued")).toBeInTheDocument();
    const [url, body] = apiClient.post.mock.calls[0];
    expect(url).toBe("/orders/o1/fulfil");
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("stampReference")).toBe("KA-0001");
    expect(body.get("file").name).toBe("stamp.pdf");
    await userEvent.click(within(panel).getByRole("button", { name: "Upload and issue" }));
    expect(await screen.findByText(/marked issued/)).toBeInTheDocument();
  });

  it("mark failed sends the reason and the refund choice exactly as chosen", async () => {
    apiClient.get.mockReturnValue(ok(detail()));
    apiClient.post.mockReturnValue(ok({ refund: { amount: 500 } }));
    renderDetail();
    const panel = await screen.findByRole("region", { name: "Fulfilment" });
    const button = within(panel).getByRole("button", { name: "Mark failed" });
    expect(button).toBeDisabled();
    await userEvent.type(within(panel).getByLabelText(/Reason/), "Registrar office closed");
    await userEvent.click(within(panel).getByLabelText(/Also reverse the charge to the client's balance/));
    await userEvent.click(button);
    expect(within(panel).getByRole("alertdialog")).toHaveTextContent(/return ₹500 to the client's balance/);
    await userEvent.click(within(within(panel).getByRole("alertdialog")).getByRole("button", { name: "Mark failed" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/orders/o1/fail", { reason: "Registrar office closed", refundBalance: true }));
    expect(await screen.findByText(/₹500 returned to the client's balance/)).toBeInTheDocument();
  });

  it("a client sees plain wording, the manual timeline, and no fulfilment panel or provider details", async () => {
    mockUser = { role: "SUPER_ADMIN", fulfilmentMode: "manual", permissions: [PERMISSIONS.ORDER_VIEW, PERMISSIONS.ESTAMP_DOWNLOAD] };
    apiClient.get.mockReturnValue(ok(detail({ availableActions: { start: false, fulfil: false, fail: false } })));
    renderDetail();
    expect(await screen.findByText("Being prepared by LauncherDesk")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Fulfilment" })).not.toBeInTheDocument();
    expect(screen.getByText("Stamp details")).toBeInTheDocument();
    expect(screen.getByText("Stamp reference")).toBeInTheDocument();
    expect(screen.queryByText(/provider/i)).not.toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
  });

  it("navigates back to Orders to fulfil when opened from the fulfilment queue", async () => {
    apiClient.get.mockReturnValue(ok(detail()));
    render(
      <MemoryRouter initialEntries={[{ pathname: "/orders/o1", state: { from: "/orders/fulfil", label: "Orders to fulfil" } }]}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole("link", { name: "← Orders to fulfil" })).toHaveAttribute("href", "/orders/fulfil");
  });
});

describe("Order detail - certificate View and Download", () => {
  const issuedDetail = (overrides = {}) => ({
    fulfilmentMode: "manual",
    order: { _id: "o1", orderNumber: "LDE-ORD-1", status: "COMPLETED", eStampStatus: "ISSUED", amount: 500, createdAt: hoursAgo(3), updatedAt: hoursAgo(1) },
    request: { _id: "r1", requestNumber: "REQ-1", status: "DOWNLOAD_AVAILABLE", stateCode: "KA", articleTitle: "Rental Agreement", firstParty: "Alice", secondParty: "Bob", descriptionOfDocument: "Rent", considerationPrice: 0, calculatedStampDuty: 500, stampDutyPaidBy: "Alice", numberOfEStamps: 1 },
    certificateAvailable: true,
    document: { filename: "LDE-ORD-1.pdf", fileSize: 2048, createdAt: hoursAgo(1) },
    timeline: [{ label: "Submitted", at: hoursAgo(3) }, { label: "Issued", at: hoursAgo(1) }],
    availableActions: {},
    ...overrides,
  });
  const renderDetail = () =>
    render(
      <MemoryRouter initialEntries={["/orders/o1"]}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

  beforeEach(() => {
    mockUser = { role: "SUPER_ADMIN", fulfilmentMode: "manual", permissions: [PERMISSIONS.ORDER_VIEW, PERMISSIONS.ESTAMP_DOWNLOAD] };
    URL.createObjectURL = vi.fn(() => "blob:fake-object-url");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows both View Certificate and Download Certificate, never a plain link to the signed storage URL", async () => {
    apiClient.get.mockReturnValue(ok(issuedDetail()));
    renderDetail();
    expect(await screen.findByRole("button", { name: "View Certificate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Certificate" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /certificate/i })).not.toBeInTheDocument();
    expect(screen.getByText(/never sent by email/)).toBeInTheDocument();
  });

  it("View Certificate fetches the authenticated endpoint and opens an in-portal viewer, not a new tab", async () => {
    apiClient.get.mockImplementation((url) =>
      url === "/orders/o1" ? ok(issuedDetail()) : ok({ url: "https://signed.example/cert", filename: "LDE-ORD-1.pdf", contentType: "application/pdf" })
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["%PDF"], { type: "application/pdf" })) });
    vi.stubGlobal("fetch", fetchMock);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "View Certificate" }));

    expect(await screen.findByRole("dialog", { name: "Certificate viewer" })).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/files/estamp/o1/download");
    expect(fetchMock).toHaveBeenCalledWith("https://signed.example/cert");
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByTitle("E-Stamp certificate")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Certificate viewer" })).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-object-url");
  });

  it("Download Certificate still saves a file under the server's filename, independent of View", async () => {
    apiClient.get.mockImplementation((url) =>
      url === "/orders/o1" ? ok(issuedDetail()) : ok({ url: "https://signed.example/cert", filename: "LDE-ORD-1.pdf", contentType: "application/pdf" })
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["%PDF"])) }));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Download Certificate" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(clickSpy.mock.contexts[0].download).toBe("LDE-ORD-1.pdf");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    clickSpy.mockRestore();
  });

  it("without ESTAMP_DOWNLOAD, neither View nor Download is offered", async () => {
    mockUser = { role: "SUPER_ADMIN", fulfilmentMode: "manual", permissions: [PERMISSIONS.ORDER_VIEW] };
    apiClient.get.mockReturnValue(ok(issuedDetail()));
    renderDetail();
    await screen.findByText("Certificate Available");
    expect(screen.queryByRole("button", { name: "View Certificate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download Certificate" })).not.toBeInTheDocument();
    expect(screen.getByText(/do not have permission to view or download/)).toBeInTheDocument();
  });

  it("a failed View shows an inline error instead of a blank/broken viewer", async () => {
    apiClient.get.mockImplementation((url) => (url === "/orders/o1" ? ok(issuedDetail()) : Promise.reject({ response: { status: 500, data: {} } })));
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "View Certificate" }));
    expect(await screen.findByText("Certificate could not be opened. Please try again.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("client wording elsewhere", () => {
  it("orders list says Stamp reference in manual mode", async () => {
    mockUser = { role: "SUPER_ADMIN", fulfilmentMode: "manual", permissions: [PERMISSIONS.ORDER_VIEW] };
    apiClient.get.mockImplementation((url) => (url === "/orders" ? ok({ items: [], total: 0 }) : ok(url === "/orders/summary" ? {} : [])));
    render(
      <MemoryRouter>
        <OrdersListPage />
      </MemoryRouter>
    );
    expect(await screen.findByText("Stamp reference")).toBeInTheDocument();
    expect(screen.queryByText("Provider reference")).not.toBeInTheDocument();
  });

  it("request timeline: Submitted, Window ends, Queued, In progress, Issued (Download)", async () => {
    mockUser = { role: "SUPER_ADMIN", fulfilmentMode: "manual", permissions: ["estamp.view", "order.view"] };
    apiClient.get.mockImplementation((url) =>
      url === "/estamps/r1"
        ? ok({ _id: "r1", requestNumber: "REQ-1", status: "DOWNLOAD_AVAILABLE", orderId: "o1", firstParty: "A", secondParty: "B", descriptionOfDocument: "D", stampDutyPaidBy: "A", stateCode: "KA", numberOfEStamps: 1, considerationPrice: 0, calculatedStampDuty: 500, createdAt: hoursAgo(5), modificationDeadline: hoursAgo(4), lockedAt: hoursAgo(4) })
        : ok({ order: { _id: "o1", eStampStatus: "ISSUED", startedAt: hoursAgo(3), issuedAt: hoursAgo(2) }, document: { filename: "c.pdf" } })
    );
    render(
      <MemoryRouter initialEntries={["/estamps/requests/r1"]}>
        <Routes>
          <Route path="/estamps/requests/:id" element={<RequestDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    for (const label of ["Submitted", "Window ends", "Queued", "In progress", "Issued (Download)"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText(/provider/i)).not.toBeInTheDocument();
  });
});

describe("provider screens in manual mode", () => {
  it("the provider page explains manual fulfilment instead of rendering", () => {
    render(
      <ProviderOnly>
        <p>provider page body</p>
      </ProviderOnly>
    );
    expect(screen.getByText(/Manual fulfilment is enabled/)).toBeInTheDocument();
    expect(screen.queryByText("provider page body")).not.toBeInTheDocument();
    mockUser = { ...mockUser, fulfilmentMode: "provider" };
  });

  it("renders the provider page in provider mode", () => {
    mockUser = { role: "MASTER_ADMIN", fulfilmentMode: "provider", permissions: [] };
    render(
      <ProviderOnly>
        <p>provider page body</p>
      </ProviderOnly>
    );
    expect(screen.getByText("provider page body")).toBeInTheDocument();
  });

  it("sidebar: Orders to fulfil in manual mode, E-Stamp Provider only in provider mode", () => {
    const all = Object.values(PERMISSIONS);
    const manual = getFlatSidebarItems("MASTER_ADMIN", all, "manual").map((i) => i.to);
    expect(manual).toContain("/orders/fulfil");
    expect(manual).not.toContain("/estamp-provider");
    const provider = getFlatSidebarItems("MASTER_ADMIN", all, "provider").map((i) => i.to);
    expect(provider).toContain("/estamp-provider");
    expect(provider).not.toContain("/orders/fulfil");
    expect(getFlatSidebarItems("ASSISTANT_MASTER_ADMIN", [PERMISSIONS.ORDER_MANAGE], "manual").map((i) => i.to)).toContain("/orders/fulfil");
    expect(getFlatSidebarItems("SUPER_ADMIN", all, "manual").map((i) => i.to)).not.toContain("/orders/fulfil");
  });
});
