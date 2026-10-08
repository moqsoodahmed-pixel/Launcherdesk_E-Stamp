import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import DashboardLayout from "./DashboardLayout";
import { useAuth } from "../context/AuthContext";
import { apiClient } from "../api/client";
import { PERMISSIONS } from "../utils/permissions";

// DashboardLayout renders GlobalSearch + NotificationBell as part of its
// header, so both are exercised here too - this test focuses on the layout
// shell itself: active nav highlighting (Phase 21's "longest matching
// prefix" rule) and the mobile drawer (open/close via hamburger, backdrop,
// and Escape), none of which had a dedicated test before.
vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));
vi.mock("../api/client", () => ({
  apiClient: { get: vi.fn() },
}));

function masterAdmin() {
  return { user: { role: "MASTER_ADMIN", email: "admin@example.test", permissions: Object.values(PERMISSIONS) }, logout: vi.fn() };
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/organizations" element={<div>Organizations Page</div>} />
          <Route path="/organizations/:id" element={<div>Organization Detail Page</div>} />
          <Route path="/users" element={<div>Users Page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue(masterAdmin());
  apiClient.get.mockImplementation((url) => {
    if (url === "/notifications/unread-count") return Promise.resolve({ data: { data: { unreadCount: 0 } } });
    return Promise.resolve({ data: { data: { items: [] } } });
  });
});

describe("DashboardLayout - active nav state", () => {
  it("highlights the Organizations sidebar link on its own list route", () => {
    renderAt("/organizations");
    const link = screen.getAllByRole("link", { name: "Clients / Organizations" })[0];
    expect(link).toHaveClass("bg-brand-50");
  });

  it("still highlights the Organizations sidebar link on a nested detail route (/organizations/:id), via the longest-prefix rule", () => {
    renderAt("/organizations/abc123");
    const link = screen.getAllByRole("link", { name: "Clients / Organizations" })[0];
    expect(link).toHaveClass("bg-brand-50");
  });

  it("does not highlight an unrelated sidebar link (Users) while on the Organizations route", () => {
    renderAt("/organizations");
    const usersLink = screen.getAllByRole("link", { name: "Users" })[0];
    expect(usersLink).not.toHaveClass("bg-brand-50");
  });
});

describe("DashboardLayout - mobile drawer", () => {
  it("opens the mobile drawer from the hamburger button and closes it again on the close button", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderAt("/organizations");

    const openButton = screen.getByLabelText("Open menu");
    expect(openButton).toHaveAttribute("aria-expanded", "false");
    await user.click(openButton);
    expect(openButton).toHaveAttribute("aria-expanded", "true");

    // "Close menu" renders once in the desktop rail and once in the mobile
    // drawer (both share the same sidebarBody markup) - the drawer's own
    // copy is the one a mobile user can actually reach/see.
    const closeButtons = screen.getAllByLabelText("Close menu");
    await user.click(closeButtons[closeButtons.length - 1]);
    expect(openButton).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the mobile drawer on Escape", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderAt("/organizations");

    const openButton = screen.getByLabelText("Open menu");
    await user.click(openButton);
    expect(openButton).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    expect(openButton).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the mobile drawer on navigation (clicking a sidebar link)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderAt("/organizations");

    await user.click(screen.getByLabelText("Open menu"));
    expect(screen.getByLabelText("Open menu")).toHaveAttribute("aria-expanded", "true");

    // Two "Users" links exist (desktop rail + mobile drawer) - the mobile
    // drawer's copy is the second one rendered.
    const usersLinks = screen.getAllByRole("link", { name: "Users" });
    await user.click(usersLinks[usersLinks.length - 1]);

    expect(await screen.findByText("Users Page")).toBeInTheDocument();
    expect(screen.getByLabelText("Open menu")).toHaveAttribute("aria-expanded", "false");
  });
});
