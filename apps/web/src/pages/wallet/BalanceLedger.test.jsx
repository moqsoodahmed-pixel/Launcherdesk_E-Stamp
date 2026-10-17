// Ledger-flow UI: available vs reserved balance, credit status per payment,
// the assigned-assistant picker and the dashboard credit cards.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WalletPage from "./WalletPage";
import BalanceStatusBadge, { balanceStatusOf } from "../../components/payments/BalanceStatusBadge";
import PaymentCreditsCard from "../../components/dashboard/PaymentCreditsCard";
import ClientBalanceCard from "../../components/dashboard/ClientBalanceCard";
import OrganizationDetailPage from "../organizations/OrganizationDetailPage";
import CreateOrganizationPage from "../organizations/CreateOrganizationPage";
import { getFlatSidebarItems } from "../../layouts/sidebarConfig";
import { PERMISSIONS } from "../../utils/permissions";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
let mockUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const ok = (data) => Promise.resolve({ data: { data } });
const ASSISTANTS = [{ _id: "a1", name: "Ravi", email: "ravi@ld.local" }];

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { role: "SUPER_ADMIN", organizationId: "org-1", permissions: ["wallet.view", "payment.view", "payment.manage"] };
});

describe("balance status", () => {
  it("maps pending, credited and legacy payments", () => {
    expect(balanceStatusOf({ status: "SUCCESS", balanceStatus: "PENDING_CREDIT" })).toBe("PENDING_CREDIT");
    expect(balanceStatusOf({ status: "SUCCESS", balanceStatus: "CREDITED" })).toBe("CREDITED");
    expect(balanceStatusOf({ status: "SUCCESS" })).toBe("CREDITED"); // legacy auto-credited
    expect(balanceStatusOf({ status: "CREATED" })).toBeNull();
    render(<BalanceStatusBadge payment={{ status: "SUCCESS", balanceStatus: "PENDING_CREDIT" }} />);
    expect(screen.getByText("Awaiting balance update")).toBeInTheDocument();
  });
});

describe("WalletPage ledger view", () => {
  it("shows Available as the main number, the Reserved amount with its hint, and labelled ledger rows", async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === "/wallet/balance") return ok({ balance: 2000, reservedBalance: 500, availableBalance: 1500 });
      if (url === "/wallet/transactions")
        return ok({
          items: [
            { _id: "t1", type: "CREDIT", amount: 2000, balanceAfter: 2000, description: "Balance added, payment pay_XYZ" },
            { _id: "t2", type: "DEBIT", amount: 500, balanceAfter: 1500, description: "E-Stamp request LDE-REQ-9" },
          ],
        });
      if (url === "/payments") return ok({ items: [{ _id: "p1", amount: 2000, status: "SUCCESS", balanceStatus: "PENDING_CREDIT", createdAt: new Date().toISOString() }] });
      return ok({});
    });
    render(
      <MemoryRouter>
        <WalletPage />
      </MemoryRouter>
    );
    expect(await screen.findByText("₹1,500")).toBeInTheDocument();
    expect(screen.getByText("held for requests in their 20-minute window")).toBeInTheDocument();
    expect(screen.getByText("Balance added, payment pay_XYZ")).toBeInTheDocument();
    expect(screen.getByText("E-Stamp request LDE-REQ-9")).toBeInTheDocument();
    expect(await screen.findByText("Awaiting balance update")).toBeInTheDocument();
    expect(screen.getByText(/balance is updated after LauncherDesk confirms the payment/)).toBeInTheDocument();
  });
});

describe("dashboard cards", () => {
  it("Master Admin card shows received, credited and pending per organization", async () => {
    apiClient.get.mockReturnValue(
      ok({ totalReceived: 5000, totalCredited: 3500, pendingAmount: 1500, pendingCount: 2, pendingByOrganization: [{ organizationId: "o1", organizationName: "Acme", pendingAmount: 1500, pendingCount: 2 }] })
    );
    render(
      <MemoryRouter>
        <PaymentCreditsCard variant="master" />
      </MemoryRouter>
    );
    expect(await screen.findByText("₹5,000")).toBeInTheDocument();
    expect(screen.getByText("₹3,500")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/payments/credit-summary", expect.anything());
  });

  it("assistant card shows the pending count and amount, with Retry on error", async () => {
    apiClient.get.mockRejectedValueOnce({ response: { status: 500, data: {} } }).mockReturnValueOnce(ok({ pendingCount: 3, pendingAmount: 900 }));
    render(
      <MemoryRouter>
        <PaymentCreditsCard variant="assistant" />
      </MemoryRouter>
    );
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("₹900")).toBeInTheDocument();
  });

  it("client balance card shows available and reserved", async () => {
    apiClient.get.mockReturnValue(ok({ balance: 1000, reservedBalance: 300, availableBalance: 700 }));
    render(
      <MemoryRouter>
        <ClientBalanceCard />
      </MemoryRouter>
    );
    expect(await screen.findByText("₹700")).toBeInTheDocument();
    expect(screen.getByText("₹300")).toBeInTheDocument();
  });
});

describe("assigned assistant", () => {
  const detail = {
    organization: { _id: "o1", name: "Acme Corp", contactEmail: "c@acme.test", contactPhone: "9999999999", status: "ACTIVE", createdAt: new Date().toISOString() },
    wallet: { balance: 5000, reservedBalance: 1000, availableBalance: 4000, currency: "INR" },
    assignedAssistant: null,
    superAdmin: null,
    userCounts: { SUPER_ADMIN: 0, ADMIN: 0, USER: 0, totalActive: 0, totalUsers: 0 },
    activity: { estampRequestCount: 0, orderCount: 0 },
  };

  it("Master Admin assigns an assistant on the organization detail page", async () => {
    mockUser = { role: "MASTER_ADMIN", permissions: Object.values(PERMISSIONS) };
    apiClient.get.mockImplementation((url) => (url === "/users" ? ok({ items: ASSISTANTS }) : ok(detail)));
    apiClient.patch.mockReturnValue(ok({}));
    render(
      <MemoryRouter initialEntries={["/organizations/o1"]}>
        <Routes>
          <Route path="/organizations/:id" element={<OrganizationDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText("₹4,000")).toBeInTheDocument(); // available
    const select = await screen.findByLabelText("Change assigned assistant");
    await screen.findByRole("option", { name: /Ravi/ });
    await userEvent.selectOptions(select, "a1");
    await userEvent.click(screen.getByRole("button", { name: "Save assignment" }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/organizations/o1/assigned-assistant", { assistantId: "a1" }));
    const usersCall = apiClient.get.mock.calls.find(([u]) => u === "/users");
    expect(usersCall[1].params).toMatchObject({ role: "ASSISTANT_MASTER_ADMIN", status: "active" });
  });

  it("an assistant sees the assignment read-only", async () => {
    mockUser = { role: "ASSISTANT_MASTER_ADMIN", permissions: [PERMISSIONS.CLIENT_VIEW] };
    apiClient.get.mockReturnValue(ok({ ...detail, assignedAssistant: { _id: "a1", name: "Ravi", email: "ravi@ld.local" } }));
    render(
      <MemoryRouter initialEntries={["/organizations/o1"]}>
        <Routes>
          <Route path="/organizations/:id" element={<OrganizationDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText("Ravi (ravi@ld.local)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Change assigned assistant")).not.toBeInTheDocument();
  });

  it("Master Admin can set the assistant when creating an organization", async () => {
    mockUser = { role: "MASTER_ADMIN", permissions: Object.values(PERMISSIONS) };
    apiClient.get.mockReturnValue(ok({ items: ASSISTANTS }));
    apiClient.post.mockReturnValue(ok({ organization: { _id: "new1", name: "New Co", status: "ACTIVE", isEstampServiceEnabled: true }, superAdmin: { email: "n@new.test" }, tempPassword: "Tmp-1", emailSent: true }));
    render(
      <MemoryRouter>
        <CreateOrganizationPage />
      </MemoryRouter>
    );
    await userEvent.type(screen.getByLabelText("Organization name"), "New Co");
    await userEvent.type(screen.getByLabelText("Contact email"), "n@new.test");
    await userEvent.type(screen.getByLabelText("Contact phone"), "9999999999");
    const logoFile = new File(["fake-image-bytes"], "logo.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/Company logo/), logoFile);
    await userEvent.type(screen.getByLabelText("Super Admin name"), "New Owner");
    await screen.findByRole("option", { name: /Ravi/ });
    await userEvent.selectOptions(screen.getByLabelText("Assigned assistant"), "a1");
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/organizations", expect.objectContaining({ name: "New Co", assignedAssistantId: "a1" })));
  });
});

describe("sidebar", () => {
  it("Payments to credit appears for Master Admin and for an assistant holding wallet.manage only", () => {
    expect(getFlatSidebarItems("MASTER_ADMIN", Object.values(PERMISSIONS)).map((i) => i.to)).toContain("/payments/credit-queue");
    expect(getFlatSidebarItems("ASSISTANT_MASTER_ADMIN", [PERMISSIONS.WALLET_MANAGE]).map((i) => i.to)).toContain("/payments/credit-queue");
    expect(getFlatSidebarItems("ASSISTANT_MASTER_ADMIN", [PERMISSIONS.WALLET_VIEW]).map((i) => i.to)).not.toContain("/payments/credit-queue");
    expect(getFlatSidebarItems("SUPER_ADMIN", Object.values(PERMISSIONS)).map((i) => i.to)).not.toContain("/payments/credit-queue");
  });
});
