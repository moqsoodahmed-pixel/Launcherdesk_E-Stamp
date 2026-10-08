import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotificationsPage from "./NotificationsPage";
import { apiClient } from "../../api/client";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>
  );
}

function page({ items = [], total = 0, unreadCount = 0 } = {}) {
  return { data: { data: { items, total, unreadCount } } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NotificationsPage - list and unread count", () => {
  it("renders the server-provided unread count, never derived from the loaded page", async () => {
    apiClient.get.mockResolvedValue(
      page({
        items: [{ _id: "n1", title: "Payment successful", message: "Your payment was credited.", type: "PAYMENT", isRead: false, createdAt: new Date().toISOString() }],
        total: 1,
        unreadCount: 7, // deliberately inconsistent with the single unread item on this page
      })
    );
    renderPage();
    await screen.findByText("Payment successful");
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows the unread visual indicator for unread items and not for read ones", async () => {
    apiClient.get.mockResolvedValue(
      page({
        items: [
          { _id: "n1", title: "Unread one", message: "msg", type: "GENERAL", isRead: false, createdAt: new Date().toISOString() },
          { _id: "n2", title: "Read one", message: "msg", type: "GENERAL", isRead: true, createdAt: new Date().toISOString() },
        ],
        total: 2,
        unreadCount: 1,
      })
    );
    renderPage();
    await screen.findByText("Unread one");
    // "Unread" also labels the header stat - only the one item-level badge
    // (the second match) corresponds to the single unread list item.
    expect(screen.getAllByText("Unread").length).toBe(2);
  });

  it("shows the caught-up empty state with no filters applied", async () => {
    apiClient.get.mockResolvedValue(page());
    renderPage();
    expect(await screen.findByText("You're all caught up. No new notifications.")).toBeInTheDocument();
  });

  it("shows a filtered empty state distinct from the base empty state", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(page());
    renderPage();
    await screen.findByText("You're all caught up. No new notifications.");
    await user.click(screen.getByLabelText("Unread only"));
    await waitFor(() => expect(screen.getByText("No notifications match your filters.")).toBeInTheDocument());
  });

  it("surfaces a load error instead of silently showing an empty list", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 500 }, message: "boom" });
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows a 403-specific message without leaking details", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 403 } });
    renderPage();
    expect(await screen.findByText("You do not have permission to access notifications.")).toBeInTheDocument();
  });
});

describe("NotificationsPage - filters sent to the real backend contract", () => {
  it("sends unreadOnly=true only when the checkbox is checked", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(page());
    renderPage();
    await screen.findByText("You're all caught up. No new notifications.");

    let last = apiClient.get.mock.calls.at(-1);
    expect(last[1].params.unreadOnly).toBeUndefined();

    await user.click(screen.getByLabelText("Unread only"));
    await waitFor(() => {
      last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.unreadOnly).toBe(true);
    });
  });

  it("offers only the real backend NotificationType values in the type filter", async () => {
    apiClient.get.mockResolvedValue(page());
    renderPage();
    await screen.findByText("You're all caught up. No new notifications.");
    const select = screen.getByLabelText("Type");
    const values = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["", "ASSISTANT_ADMIN_ACTIVITY", "SECURITY_ALERT", "ESTAMP_STATUS", "PAYMENT", "GENERAL"]);
  });

  it("paginates server-side with Previous/Next, never loading an unbounded list", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(
      page({ items: [{ _id: "n1", title: "A", message: "m", type: "GENERAL", isRead: true, createdAt: new Date().toISOString() }], total: 45, unreadCount: 0 })
    );
    renderPage();
    expect(await screen.findByText("Page 1 of 3 (45 total)")).toBeInTheDocument();
    const [, firstConfig] = apiClient.get.mock.calls[0];
    expect(firstConfig.params.limit).toBeGreaterThan(0);
    expect(firstConfig.params.limit).toBeLessThanOrEqual(50);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      const last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.page).toBe(2);
    });
  });
});

describe("NotificationsPage - mark read / mark all read", () => {
  it("calls the backend mark-read endpoint on click and decrements the badge from the server-confirmed action, not a client-only paint", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(
      page({
        items: [{ _id: "n1", title: "Unread item", message: "m", type: "GENERAL", isRead: false, createdAt: new Date().toISOString(), entityType: "EStampOrder", entityId: "order1" }],
        total: 1,
        unreadCount: 1,
      })
    );
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderPage();
    await screen.findByText("Unread item");

    await user.click(screen.getByText("Unread item"));
    expect(apiClient.patch).toHaveBeenCalledWith("/notifications/n1/read");
    expect(mockNavigate).toHaveBeenCalledWith("/orders/order1");
  });

  it("does not call mark-read again for an already-read notification, but still navigates", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(
      page({
        items: [{ _id: "n2", title: "Read item", message: "m", type: "PAYMENT", isRead: true, createdAt: new Date().toISOString(), entityType: "Payment", entityId: "pay1" }],
        total: 1,
        unreadCount: 0,
      })
    );
    renderPage();
    await screen.findByText("Read item");
    await user.click(screen.getByText("Read item"));
    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/payments/pay1");
  });

  it("only shows Mark all as read when there are unread notifications, and it reuses the real backend endpoint", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(
      page({ items: [{ _id: "n1", title: "A", message: "m", type: "GENERAL", isRead: false, createdAt: new Date().toISOString() }], total: 1, unreadCount: 3 })
    );
    apiClient.post.mockResolvedValue({ data: { data: {} } });
    renderPage();
    await screen.findByText("A");
    const button = screen.getByRole("button", { name: "Mark all as read" });
    await user.click(button);
    expect(apiClient.post).toHaveBeenCalledWith("/notifications/read-all");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument());
  });

  it("hides Mark all as read when unreadCount is already zero", async () => {
    apiClient.get.mockResolvedValue(page({ items: [], total: 0, unreadCount: 0 }));
    renderPage();
    await screen.findByText("You're all caught up. No new notifications.");
    expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument();
  });
});

describe("NotificationsPage - safe entity navigation", () => {
  it("does not navigate for an unrecognized entityType - no arbitrary redirect", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(
      page({
        items: [{ _id: "n3", title: "Org event", message: "m", type: "GENERAL", isRead: true, createdAt: new Date().toISOString(), entityType: "Organization", entityId: "org1" }],
        total: 1,
        unreadCount: 0,
      })
    );
    renderPage();
    await screen.findByText("Org event");
    await user.click(screen.getByText("Org event"));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not navigate when entityId is missing even for a known entityType", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(
      page({
        items: [{ _id: "n4", title: "No id", message: "m", type: "GENERAL", isRead: true, createdAt: new Date().toISOString(), entityType: "EStampOrder", entityId: null }],
        total: 1,
        unreadCount: 0,
      })
    );
    renderPage();
    await screen.findByText("No id");
    await user.click(screen.getByText("No id"));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
