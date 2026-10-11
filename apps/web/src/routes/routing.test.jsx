import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import App from "../App";
import ErrorBoundary from "../components/common/ErrorBoundary";
import { safeNextPath } from "../pages/auth/LoginPage";

vi.mock("../api/client", () => ({
  apiClient: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), patch: vi.fn() },
}));
let mockAuth;
vi.mock("../context/AuthContext", () => ({ useAuth: () => mockAuth }));

const ALL = ["user.view", "user.create", "audit.view", "order.view", "estamp.view", "report.view"];
function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockAuth = { user: { role: "SUPER_ADMIN", email: "sa@x.test", permissions: ALL }, loading: false, logout: vi.fn(), loginStep1: vi.fn(), verifyOtp: vi.fn() };
});

describe("routing", () => {
  it("shows a Not Found page for unknown URLs instead of redirecting to the dashboard", () => {
    renderAt("/this/does/not/exist");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("shows 'You don't have access' when the URL needs a permission the user lacks", () => {
    mockAuth.user = { role: "USER", email: "u@x.test", permissions: ["estamp.view"] };
    renderAt("/audit");
    expect(screen.getByRole("heading", { name: "You don't have access" })).toBeInTheDocument();
  });

  it("blocks role-restricted pages (organizations) for tenant roles", () => {
    renderAt("/organizations");
    expect(screen.getByRole("heading", { name: "You don't have access" })).toBeInTheDocument();
  });

  it("sends a signed-out user to login and back to the page they tried to open", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    mockAuth.user = null;
    mockAuth.loginStep1 = vi.fn(async () => {
      mockAuth.user = { role: "SUPER_ADMIN", email: "sa@x.test", permissions: ALL };
      return { requiresOtp: false };
    });
    const { container } = renderAt("/users?role=ADMIN");
    await u.type(container.querySelector('input[type="email"]'), "sa@x.test");
    await u.type(container.querySelector('input[type="password"]'), "Secret123!");
    await u.click(screen.getByRole("button", { name: "Sign in" }));
    // Back on the remembered page with its query string intact.
    expect(await screen.findByRole("heading", { name: "Admins" })).toBeInTheDocument();
  });

  it("an already-signed-in user landing on /login?next= goes straight to that page (no loop)", () => {
    renderAt("/login?next=%2Fthis-is-missing");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});

describe("safeNextPath", () => {
  it("allows in-app paths and rejects open redirects and /login", () => {
    expect(safeNextPath("/users?role=ADMIN")).toBe("/users?role=ADMIN");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("/login?next=/x")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});

describe("ErrorBoundary", () => {
  it("contains a crashing page and recovers on navigation", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom() {
      throw new Error("kaboom");
    }
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole("heading", { name: "This page ran into a problem" })).toBeInTheDocument();
    rerender(
      <ErrorBoundary resetKey="/b">
        <p>fine now</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("fine now")).toBeInTheDocument();
  });
});
