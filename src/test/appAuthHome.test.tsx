import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppAuthHomePage from "@/pages/AppAuthHomePage";
import type { PlanFeaturesMap } from "@/config/navConfig";

const allFeatures: PlanFeaturesMap = {
  hrmEnabled: true,
  campaignsEnabled: true,
  portalEnabled: true,
  advancedFinanceEnabled: true,
  advancedReportsEnabled: true,
  posEnabled: true,
  leadsEnabled: true,
  projectsEnabled: true,
  quotationsEnabled: true,
  backordersEnabled: true,
};

const authState = {
  accessLevel: "full" as string,
  isSuperAdmin: false,
  isSaEmployee: false,
  isDealerAdmin: true,
  menuMode: "advanced" as const,
  planFeatures: allFeatures as PlanFeaturesMap | null,
};

const permState = { isManager: false, isAccountant: false, isSalesman: false };

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => permState,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/appauth-home"]}>
      <AppAuthHomePage />
    </MemoryRouter>,
  );
}

describe("AppAuthHomePage (/appauth-home)", () => {
  beforeEach(() => {
    authState.accessLevel = "full";
    authState.isDealerAdmin = true;
    authState.menuMode = "advanced";
    authState.planFeatures = allFeatures;
    permState.isManager = false;
    permState.isAccountant = false;
    permState.isSalesman = false;
  });

  it("renders every module for an owner on a full-feature plan", () => {
    renderPage();
    for (const title of [
      "Customer & CRM", "Accounting", "Purchase", "Sales",
      "HRM", "SMS & Notification", "Settings",
    ]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Supplier Payables")).toBeInTheDocument();
    expect(screen.getByText("POS Sales")).toBeInTheDocument();
  });

  it("hides owner-only and plan-gated items from a salesman on a basic plan", () => {
    authState.isDealerAdmin = false;
    permState.isSalesman = true;
    authState.planFeatures = { ...allFeatures, hrmEnabled: false, campaignsEnabled: false, advancedFinanceEnabled: false };
    renderPage();
    expect(screen.queryByText("Supplier Payables")).not.toBeInTheDocument();
    expect(screen.queryByText("Journal Voucher")).not.toBeInTheDocument();
    expect(screen.queryByText("HRM")).not.toBeInTheDocument();
    expect(screen.getByText("Sales Entry")).toBeInTheDocument();
  });

  it("disables non-readonly items when access is readonly", () => {
    authState.accessLevel = "readonly";
    renderPage();
    const dashboard = screen.getByRole("button", { name: /Dashboard/ });
    expect(dashboard).toBeEnabled();
    const salesEntry = screen.getByRole("button", { name: /Sales Entry/ });
    expect(salesEntry).toBeDisabled();
  });

  it("filters items by search query, including Bengali labels", () => {
    renderPage();
    const input = screen.getByPlaceholderText(/Search menu/);
    fireEvent.change(input, { target: { value: "ক্যাশ বই" } });
    expect(screen.getByText("Cashbook")).toBeInTheDocument();
    expect(screen.queryByText("Sales Entry")).not.toBeInTheDocument();
  });
});
