import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import App from "../../App";
import VendorDashboard from "./VendorDashboard";
import VendorOrderDetailPage from "./VendorOrderDetailPage";
import DispatchPage from "../orders/DispatchPage";
import VendorReviewPage from "../orders/VendorReviewPage";
import VendorsPage from "../vendors/VendorsPage";
import OrdersListPage from "../orders/OrdersListPage";
import FulfilQueuePage from "../orders/FulfilQueuePage";
import { getFlatSidebarItems } from "../../layouts/sidebarConfig";
import { PERMISSIONS } from "../../utils/permissions";
import { safeRouteFor } from "../../utils/notificationRoutes";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
let mockUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser, loading: false, logout: vi.fn() }) }));

const ok = (data) => Promise.resolve({ data: { data } });
// Route GET calls by URL (+ optional params predicate).
function routeGets(table) {
  apiClient.get.mockImplementation((url, config = {}) => {
    for (const [match, value] of table) {
      if (typeof match === "function" ? match(url, config.params || {}) : url === match) return typeof value === "function" ? value(url, config.params || {}) : ok(value);
    }
    return new Promise(() => {});
  });
}
const renderAt = (ui, path = "/", route = "*") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={ui} />
      </Routes>
    </MemoryRouter>
  );

const STAFF = { role: "ASSISTANT_MASTER_ADMIN", fulfilmentMode: "manual", permissions: [PERMISSIONS.ORDER_VIEW, PERMISSIONS.ORDER_MANAGE] };
const VENDOR_ORDER = {
  _id: "o1", orderNumber: "LDE-ORD-1", bulkBatchId: "b1", bulkBatchNumber: "BULK-7", stateCode: "KA", articleTitle: "Rental Agreement",
  firstParty: "Alice", secondParty: "Bob", descriptionOfDocument: "Rent", propertyDescription: "Flat 4B", considerationPrice: 1000, stampDuty: 500,
  numberOfEStamps: 1, organizationName: "Acme", vendorStatus: "SENT", declined: false, closed: false, uploads: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mockUser = { role: "VENDOR", fulfilmentMode: "manual", permissions: [PERMISSIONS.NOTIFICATION_VIEW] };
});

describe("VENDOR routing and sidebar", () => {
  it("sidebar shows only Dashboard and My Orders", () => {
    expect(getFlatSidebarItems("VENDOR", [PERMISSIONS.NOTIFICATION_VIEW], "manual").map((i) => i.to)).toEqual(["/dashboard", "/vendor/orders"]);
  });

  it("lands on the vendor dashboard and is refused staff and client pages", async () => {
    routeGets([["/vendor/orders/summary", { SENT: 2, ACCEPTED: 1, UPLOADED: 0, REJECTED: 0, APPROVED: 4 }], ["/vendor/orders", { items: [], total: 0 }], [() => true, { items: [], total: 0 }]]);
    const { unmount } = render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByLabelText("To do count")).toHaveTextContent("2");
    unmount();
    for (const path of ["/orders/fulfil", "/orders/dispatch", "/vendors", "/wallet", "/organizations"]) {
      const r = render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      );
      expect(screen.getByRole("heading", { name: "You don't have access" })).toBeInTheDocument();
      r.unmount();
    }
  });

  it("client and staff roles cannot open vendor pages; only Master Admin gets Vendors", () => {
    mockUser = { role: "SUPER_ADMIN", permissions: [PERMISSIONS.ORDER_VIEW] };
    render(
      <MemoryRouter initialEntries={["/vendor/orders"]}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "You don't have access" })).toBeInTheDocument();
    expect(getFlatSidebarItems("MASTER_ADMIN", Object.values(PERMISSIONS), "manual").map((i) => i.to)).toEqual(expect.arrayContaining(["/vendors", "/orders/dispatch", "/orders/vendor-review"]));
    expect(getFlatSidebarItems("ASSISTANT_MASTER_ADMIN", STAFF.permissions, "manual").map((i) => i.to)).not.toContain("/vendors");
    expect(getFlatSidebarItems("ASSISTANT_MASTER_ADMIN", STAFF.permissions, "provider").map((i) => i.to)).not.toContain("/orders/dispatch");
    for (const role of ["SUPER_ADMIN", "ADMIN", "USER"]) {
      expect(getFlatSidebarItems(role, Object.values(PERMISSIONS), "manual").map((i) => i.to).join(" ")).not.toMatch(/vendor/);
    }
  });

  it("vendor notifications open the vendor order page", () => {
    expect(safeRouteFor({ type: "VENDOR_ACTIVITY", entityType: "EStampOrder", entityId: "o1" })).toBe("/vendor/orders/o1");
    expect(safeRouteFor({ type: "ESTAMP_STATUS", entityType: "EStampOrder", entityId: "o1" })).toBe("/orders/o1");
  });
});

describe("Vendor dashboard and queue", () => {
  it("shows summary cards and the queue grouped by batch; Accept and inline upload work row by row", async () => {
    const second = { ...VENDOR_ORDER, _id: "o2", orderNumber: "LDE-ORD-2", bulkBatchId: null, bulkBatchNumber: null, vendorStatus: "REJECTED", uploads: [{ _id: "u1", stampReference: "KA-1", status: "REJECTED", reviewNotes: "Blurred scan" }] };
    routeGets([["/vendor/orders/summary", { SENT: 1, ACCEPTED: 0, UPLOADED: 0, REJECTED: 1, APPROVED: 3, oldestWaitingAt: new Date().toISOString() }], ["/vendor/orders", { items: [VENDOR_ORDER, second], total: 2 }]]);
    apiClient.post.mockReturnValue(ok({}));
    renderAt(<VendorDashboard />);
    expect(await screen.findByText(/Batch BULK-7/)).toBeInTheDocument();
    expect(screen.getByText(/Single orders/)).toBeInTheDocument();
    expect(screen.getByLabelText("Needs re-upload count")).toHaveTextContent("1");
    expect(screen.getByLabelText("Approved count")).toHaveTextContent("3");
    expect(screen.getByText("Rejected: Blurred scan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy order number LDE-ORD-1" })).toBeInTheDocument();

    const row = screen.getByTestId("vendor-row-o1");
    await userEvent.click(within(row).getByRole("button", { name: "Accept" }));
    expect(apiClient.post).toHaveBeenCalledWith("/vendor/orders/o1/accept");

    const file = new File(["%PDF-1.4"], "stamp.pdf", { type: "application/pdf" });
    await userEvent.upload(within(row).getByLabelText("Certificate file for LDE-ORD-1"), file);
    await userEvent.type(within(row).getByLabelText("Stamp reference for LDE-ORD-1"), "KA-REF-9");
    await userEvent.click(within(row).getByRole("button", { name: "Upload certificate" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/vendor/orders/o1/upload", expect.any(FormData)));
    const form = apiClient.post.mock.calls.find((c) => c[0] === "/vendor/orders/o1/upload")[1];
    expect(form.get("stampReference")).toBe("KA-REF-9");
    expect(form.get("file").name).toBe("stamp.pdf");
    expect(await within(row).findByText("Uploaded for review.")).toBeInTheDocument();
  });

  it("row upload validates before sending and shows the server error", async () => {
    routeGets([["/vendor/orders/summary", {}], ["/vendor/orders", { items: [VENDOR_ORDER], total: 1 }]]);
    apiClient.post.mockRejectedValue({ response: { status: 400, data: { message: "Unsupported file type: text/csv" } } });
    renderAt(<VendorDashboard />);
    const row = await screen.findByTestId("vendor-row-o1");
    await userEvent.click(within(row).getByRole("button", { name: "Upload certificate" }));
    expect(within(row).getByRole("alert")).toHaveTextContent("Choose the certificate file");
    await userEvent.upload(within(row).getByLabelText("Certificate file for LDE-ORD-1"), new File(["x"], "a.pdf", { type: "application/pdf" }));
    await userEvent.type(within(row).getByLabelText("Stamp reference for LDE-ORD-1"), "KA-OK-1");
    await userEvent.click(within(row).getByRole("button", { name: "Upload certificate" }));
    expect(await within(row).findByText("Unsupported file type: text/csv")).toBeInTheDocument();
  });

  it("shows empty and error-with-Retry states", async () => {
    let calls = 0;
    routeGets([["/vendor/orders/summary", {}], ["/vendor/orders", () => (calls++ === 0 ? Promise.reject({ response: { status: 500, data: {} } }) : ok({ items: [], total: 0 }))]]);
    renderAt(<VendorDashboard />);
    expect(await screen.findByText("Failed to load your orders.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No orders here")).toBeInTheDocument();
  });

  it("detail page: copyable details, client documents, history with rejection reasons, and Can't process", async () => {
    const detail = { ...VENDOR_ORDER, vendorStatus: "REJECTED", documents: [{ _id: "f1", originalFileName: "deed.pdf" }], uploads: [{ _id: "u1", stampReference: "KA-1", status: "REJECTED", reviewNotes: "Wrong duty", uploadedAt: new Date().toISOString() }] };
    routeGets([["/vendor/orders/o1", detail], ["/vendor/orders/o1/files/f1", { url: "https://signed.example/doc" }]]);
    apiClient.post.mockReturnValue(ok({}));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderAt(<VendorOrderDetailPage />, "/vendor/orders/o1", "/vendor/orders/:id");
    expect(await screen.findByText("Reason: Wrong duty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy First party" })).toBeInTheDocument();
    expect(screen.getByText("Flat 4B")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download deed.pdf" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://signed.example/doc", "_blank", "noopener,noreferrer"));
    await userEvent.click(screen.getByRole("button", { name: "Can't process this order" }));
    await userEvent.type(screen.getByLabelText("Why can't you process it?"), "No stamp paper available");
    await userEvent.click(screen.getByRole("button", { name: "Hand back to LauncherDesk" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/vendor/orders/o1/cannot-process", { reason: "No stamp paper available" }));
    expect(window.confirm).toHaveBeenCalled();
    // Never any money/contact fields rendered beyond duty and consideration.
    expect(document.body.textContent).not.toMatch(/wallet|balance|email|phone/i);
  });
});

describe("Send to vendor (dispatch)", () => {
  it("selects a batch, sends to the chosen vendor and reports per-order results", async () => {
    mockUser = STAFF;
    const rows = [
      { _id: "a1", orderNumber: "LDE-A1", organizationName: "Acme", stateCode: "KA", articleTitle: "Rent", vendorStatus: "NOT_SENT" },
      { _id: "a2", orderNumber: "LDE-A2", organizationName: "Acme", stateCode: "KA", articleTitle: "Rent", vendorStatus: "NOT_SENT" },
    ];
    routeGets([
      [(u, p) => u === "/orders" && p.vendorStatus === "NOT_SENT", { items: rows, total: 2 }],
      [(u, p) => u === "/orders" && p.vendorStatus === "REJECTED", { items: [], total: 0 }],
      ["/orders/vendors", { items: [{ _id: "v1", name: "Stamp Co" }] }],
    ]);
    apiClient.post.mockReturnValue(ok({ sent: 1, failed: 1, results: [{ orderId: "a1", orderNumber: "LDE-A1", ok: true }, { orderId: "a2", orderNumber: "LDE-A2", ok: false, reason: "NOT_CHARGED" }] }));
    renderAt(<DispatchPage />);
    await screen.findByText("LDE-A1");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a vendor.");
    await userEvent.selectOptions(screen.getByLabelText("Vendor"), "v1");
    await userEvent.click(screen.getByRole("button", { name: /Select all/ }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/orders/dispatch", { orderIds: ["a1", "a2"], vendorId: "v1" }));
    const result = await screen.findByRole("region", { name: "Dispatch result" });
    expect(result).toHaveTextContent("1 sent, 1 not sent");
    expect(result).toHaveTextContent("LDE-A2: Amount not charged");
  });
});

describe("Vendor review", () => {
  const ROWS = [
    { _id: "r1", orderNumber: "LDE-R1", organizationName: "Acme", vendorName: "Stamp Co", pendingVendorUpload: { stampReference: "KA-111", uploadedAt: new Date().toISOString() } },
    { _id: "r2", orderNumber: "LDE-R2", organizationName: "Acme", vendorName: "Stamp Co", pendingVendorUpload: { stampReference: "KA-222", uploadedAt: new Date().toISOString() } },
  ];
  beforeEach(() => {
    mockUser = STAFF;
    routeGets([["/orders", { items: ROWS, total: 2 }], ["/orders/r1/vendor-upload", { url: "https://signed.example/v" }]]);
  });

  it("views the file, approves one, and rejects with a reason", async () => {
    apiClient.post.mockReturnValue(ok({}));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderAt(<VendorReviewPage />);
    expect(await screen.findByText("KA-111")).toBeInTheDocument();
    expect(apiClient.get.mock.calls[0][1].params).toMatchObject({ queue: "vendor-review" });
    await userEvent.click(screen.getByRole("button", { name: "View file for LDE-R1" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://signed.example/v", "_blank", "noopener,noreferrer"));
    await userEvent.click(screen.getByRole("button", { name: "Approve LDE-R1" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/orders/r1/vendor-approve"));
    expect(await screen.findByText("LDE-R1 approved and released.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reject LDE-R2" }));
    await userEvent.type(screen.getByLabelText("Reject reason for LDE-R2"), "Wrong stamp duty");
    await userEvent.click(screen.getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/orders/r2/vendor-reject", { reason: "Wrong stamp duty" }));
  });

  it("bulk approves the selected orders and lists failures", async () => {
    apiClient.post.mockReturnValue(ok({ approved: 1, failed: 1, results: [{ orderId: "r1", ok: true }, { orderId: "r2", orderNumber: "LDE-R2", ok: false, reason: "INVALID_STATE", message: "No upload" }] }));
    renderAt(<VendorReviewPage />);
    await screen.findByText("KA-111");
    await userEvent.click(screen.getByLabelText("Select LDE-R1"));
    await userEvent.click(screen.getByLabelText("Select LDE-R2"));
    await userEvent.click(screen.getByRole("button", { name: "Approve selected (2)" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/orders/vendor-approve-many", { orderIds: ["r1", "r2"] }));
    expect(await screen.findByText("1 approved; not approved: LDE-R2 (No upload).")).toBeInTheDocument();
  });
});

describe("Vendors page (Master Admin)", () => {
  it("creates a vendor showing the temp password once, and deactivates", async () => {
    mockUser = { role: "MASTER_ADMIN", permissions: Object.values(PERMISSIONS) };
    routeGets([["/vendors", { items: [{ _id: "v1", name: "Stamp Co", email: "s@x.com", isActive: true }] }]]);
    apiClient.post.mockReturnValue(ok({ user: { email: "new@x.com" }, tempPassword: "Tmp-Pass-123" }));
    apiClient.patch.mockReturnValue(ok({}));
    renderAt(<VendorsPage />);
    await screen.findByText("Stamp Co");
    await userEvent.type(screen.getByLabelText("Name"), "New Vendor");
    await userEvent.type(screen.getByLabelText("Email"), "new@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Create vendor" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/vendors", { name: "New Vendor", email: "new@x.com" }));
    expect(await screen.findByText("Tmp-Pass-123")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Tmp-Pass-123")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Deactivate Stamp Co" }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/vendors/v1/status", { isActive: false }));
  });
});

describe("staff fulfilment queue and client pages", () => {
  it("fulfil queue shows a With vendor badge and Recall", async () => {
    mockUser = STAFF;
    routeGets([["/orders", { items: [{ _id: "q1", orderNumber: "LDE-Q1", organizationName: "Acme", stateCode: "KA", amount: 500, eStampStatus: "PROCESSING", vendorStatus: "SENT", vendorName: "Stamp Co" }], total: 1 }]]);
    apiClient.post.mockReturnValue(ok({}));
    renderAt(<FulfilQueuePage />);
    expect(await screen.findByText("With vendor")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Recall LDE-Q1" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/orders/q1/recall"));
  });

  it("client order list never renders vendor details even if a field slipped through", async () => {
    mockUser = { role: "USER", fulfilmentMode: "manual", permissions: [PERMISSIONS.ORDER_VIEW, PERMISSIONS.ESTAMP_VIEW] };
    routeGets([
      ["/orders", { items: [{ _id: "c1", orderNumber: "LDE-C1", stateCode: "KA", amount: 500, eStampStatus: "PROCESSING", status: "ONGOING", vendorStatus: "SENT", vendorName: "Secret Stamp Co", createdAt: new Date().toISOString() }], total: 1 }],
      [() => true, { total: 1, CREATED: 0, PROCESSING: 1, ISSUED: 0, FAILED: 0 }],
    ]);
    renderAt(<OrdersListPage />);
    expect((await screen.findAllByText("LDE-C1")).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/vendor|Secret Stamp Co|With vendor|Awaiting review/i);
  });
});
