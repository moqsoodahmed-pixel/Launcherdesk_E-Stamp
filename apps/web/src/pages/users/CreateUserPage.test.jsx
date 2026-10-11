import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CreateUserPage from "./CreateUserPage";

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
