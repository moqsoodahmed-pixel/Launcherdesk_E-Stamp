import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AboutPage from "./AboutPage";

describe("AboutPage", () => {
  it("shows the product, a support mailto link and a link to /policies", () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>
    );
    expect(screen.getByText("LauncherDesk E-Stamping")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /@/ })).toHaveAttribute("href", expect.stringMatching(/^mailto:/));
    expect(screen.getByRole("link", { name: /Terms of Service/ })).toHaveAttribute("href", "/policies");
  });
});
