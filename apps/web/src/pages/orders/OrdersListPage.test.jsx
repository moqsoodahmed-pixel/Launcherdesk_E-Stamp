import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import OrdersListPage from "./OrdersListPage";
import OrderDetailPage from "./OrderDetailPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
let mockUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const order = { _id: "o1", orderNumber: "ORD-1", eStampStatus: "PROCESSING", status: "PAID", amount: 500, stateCode: "KA", createdAt: new Date().toISOString() };
const SUMMARY = { total: 1, CREATED: 0, SUBMITTING: 0, SUBMITTED: 0, PROCESSING: 1, ISSUED: 0, FAILED: 0 };
const ok = (data) => Promise.resolve({ data: { data } });

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { role: "SUPER_ADMIN", permissions: ["order.view"] };
});

const renderList = () =>
  render(
    <MemoryRouter>
      <OrdersListPage />
    </MemoryRouter>
  );

describe("OrdersListPage", () => {
  it("still shows the table when only the summary request fails", async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === "/orders") return ok({ items: [order], total: 1 });
      if (url === "/orders/summary") return Promise.reject({ response: { status: 500, data: {} } });
      return ok([]);
    });
    renderList();
    expect((await screen.findAllByText("ORD-1")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Failed to load orders.")).not.toBeInTheDocument();
  });

  it("clicking a status card filters the table by that status", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.get.mockImplementation((url) => (url === "/orders/summary" ? ok(SUMMARY) : url === "/orders" ? ok({ items: [order], total: 1 }) : ok([])));
    renderList();
    await u.click(await screen.findByRole("button", { name: /Processing/ }));
    await waitFor(() => {
      const last = apiClient.get.mock.calls.filter(([url]) => url === "/orders").at(-1);
      expect(last[1].params.eStampStatus).toBe("PROCESSING");
    });
  });

  it("shows a list failure with Retry", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    let fail = true;
    apiClient.get.mockImplementation((url) => {
      if (url === "/orders") return fail ? Promise.reject({ response: { status: 500, data: { message: "Orders down" } } }) : ok({ items: [order], total: 1 });
      return url === "/orders/summary" ? ok(SUMMARY) : ok([]);
    });
    renderList();
    expect(await screen.findByText("Orders down")).toBeInTheDocument();
    fail = false;
    await u.click(screen.getByRole("button", { name: "Retry" }));
    expect((await screen.findAllByText("ORD-1")).length).toBeGreaterThan(0);
  });
});

describe("OrderDetailPage", () => {
  it("offers Retry when the order fails to load", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 500, data: { message: "Order down" } } });
    render(
      <MemoryRouter initialEntries={["/orders/o1"]}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText("Order down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
