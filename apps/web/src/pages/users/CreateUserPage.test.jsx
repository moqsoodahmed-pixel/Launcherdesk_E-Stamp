import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CreateUserPage from "./CreateUserPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { post: vi.fn() } }));
let mockActor = { role: "SUPER_ADMIN" };
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockActor }) }));

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CreateUserPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockActor = { role: "SUPER_ADMIN" };
  apiClient.post.mockReset();
});

describe("CreateUserPage - role from the URL", () => {
  it("preselects ADMIN from ?role=ADMIN and labels the page accordingly", () => {
    renderAt("/users/new?role=ADMIN");
    expect(screen.getByRole("heading", { name: "Add Admin" })).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toHaveValue("ADMIN");
    expect(screen.getByRole("link", { name: "Back to list" })).toHaveAttribute("href", "/users?role=ADMIN");
  });

  it("an ADMIN can only create USER accounts, even if the URL asks for ADMIN", () => {
    mockActor = { role: "ADMIN" };
    renderAt("/users/new?role=ADMIN");
    const options = Array.from(screen.getByLabelText("Role").querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["USER"]);
    expect(screen.getByRole("heading", { name: "Add User" })).toBeInTheDocument();
  });
});

describe("CreateUserPage - setting a password at creation", () => {
  it("submits the password the creator typed, hidden by default, revealable via Show", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: { data: { user: { name: "Admin Test", email: "admin@x.test", role: "ADMIN" }, tempPassword: "MyChosen1Pw" } } });
    renderAt("/users/new?role=ADMIN");

    const passwordInput = screen.getByLabelText("Password (optional)");
    expect(passwordInput).toHaveAttribute("type", "password");
    await u.type(passwordInput, "MyChosen1Pw");
    await u.click(screen.getByRole("button", { name: "Show" }));
    expect(passwordInput).toHaveAttribute("type", "text");

    await u.type(screen.getByLabelText("Name"), "Admin Test");
    await u.type(screen.getByLabelText("Email"), "admin@x.test");
    await u.click(screen.getByRole("button", { name: /Create admin/ }));

    expect(apiClient.post).toHaveBeenCalledWith("/users", expect.objectContaining({ password: "MyChosen1Pw" }));
    expect(await screen.findByText("MyChosen1Pw")).toBeInTheDocument();
    // No forced first-login change with either a custom or a generated password.
    expect(screen.getByText(/no forced password change on first login|no forced change on first login/)).toBeInTheDocument();
    expect(screen.queryByText(/required to change it on first login/)).not.toBeInTheDocument();
  });

  it("left blank, the field submits as empty rather than a fabricated value - the server generates one", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: { data: { user: { name: "Gen User", email: "gen@x.test", role: "USER" }, tempPassword: "Server-Generated-1" } } });
    renderAt("/users/new?role=USER");

    await u.type(screen.getByLabelText("Name"), "Gen User");
    await u.type(screen.getByLabelText("Email"), "gen@x.test");
    await u.click(screen.getByRole("button", { name: /Create user/ }));

    expect(apiClient.post).toHaveBeenCalledWith("/users", expect.objectContaining({ password: "" }));
    expect(await screen.findByText("Server-Generated-1")).toBeInTheDocument();
  });
});
