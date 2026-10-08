import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotificationBell from "./NotificationBell";
import { apiClient } from "../api/client";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../api/client", () => ({
  apiClient: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockImplementation((url) => {
    if (url === "/notifications/unread-count") return Promise.resolve({ data: { data: { unreadCount: 2 } } });
    if (url === "/notifications") return Promise.resolve({ data: { data: { items: [], unreadCount: 2 } } });
    return Promise.reject(new Error(`unhandled ${url}`));
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NotificationBell - unread count polling", () => {
  it("polls unread-count every 30s and cleans up the interval on unmount (no leaked timer, no duplicate polling)", async () => {
    vi.useFakeTimers();
    const { unmount } = renderBell();

    await vi.waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/notifications/unread-count"));
    const callsAfterMount = apiClient.get.mock.calls.filter((c) => c[0] === "/notifications/unread-count").length;
    expect(callsAfterMount).toBe(1);

    await vi.advanceTimersByTimeAsync(30000);
    expect(apiClient.get.mock.calls.filter((c) => c[0] === "/notifications/unread-count").length).toBe(2);

    unmount();
    await vi.advanceTimersByTimeAsync(60000);
    // No further polling after unmount - the interval was actually cleared.
    expect(apiClient.get.mock.calls.filter((c) => c[0] === "/notifications/unread-count").length).toBe(2);
  });

  it("renders the server-provided unread count and caps the badge at 99+", async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === "/notifications/unread-count") return Promise.resolve({ data: { data: { unreadCount: 150 } } });
      return Promise.resolve({ data: { data: { items: [], unreadCount: 150 } } });
    });
    renderBell();
    expect(await screen.findByText("99+")).toBeInTheDocument();
  });
});

describe("NotificationBell - panel and navigation", () => {
  it("shows a View all link to the Notification Center", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderBell();
    await user.click(screen.getByLabelText("Notifications"));
    expect(await screen.findByText("View all")).toHaveAttribute("href", "/notifications");
  });

  it("marks a clicked unread notification as read via the backend and navigates only for a known entityType", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockImplementation((url) => {
      if (url === "/notifications/unread-count") return Promise.resolve({ data: { data: { unreadCount: 1 } } });
      return Promise.resolve({
        data: { data: { items: [{ _id: "n1", title: "Order ready", message: "m", isRead: false, createdAt: new Date().toISOString(), entityType: "EStampOrder", entityId: "order1" }], unreadCount: 1 } },
      });
    });
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderBell();
    await user.click(screen.getByLabelText("Notifications"));
    await user.click(await screen.findByText("Order ready"));
    expect(apiClient.patch).toHaveBeenCalledWith("/notifications/n1/read");
    expect(mockNavigate).toHaveBeenCalledWith("/orders/order1");
  });

  it("never navigates to an arbitrary/unknown entityType - the panel stays open with no redirect", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockImplementation((url) => {
      if (url === "/notifications/unread-count") return Promise.resolve({ data: { data: { unreadCount: 1 } } });
      return Promise.resolve({
        data: { data: { items: [{ _id: "n2", title: "Weird event", message: "m", isRead: false, createdAt: new Date().toISOString(), entityType: "SomethingUnmapped", entityId: "x" }], unreadCount: 1 } },
      });
    });
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderBell();
    await user.click(screen.getByLabelText("Notifications"));
    await user.click(await screen.findByText("Weird event"));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
