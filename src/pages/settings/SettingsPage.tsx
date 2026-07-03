import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useDealerId } from "@/hooks/useDealerId";
import { vpsAuthedFetch, vpsAuthApi } from "@/lib/vpsAuthClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Settings, AlertTriangle, Package, ShieldCheck, Calculator, Tags, ArrowRight, FileSpreadsheet, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { planHasAdvancedMenu } from "@/config/navConfig";
import { ApprovalSettingsCard } from "@/components/approval/ApprovalSettingsCard";
import { DemandPlanningSettingsCard } from "@/components/DemandPlanningSettingsCard";
import WhatsAppSettingsCard from "@/components/whatsapp/WhatsAppSettingsCard";
import { SmtpSettingsCard } from "@/components/settings/SmtpSettingsCard";

type DealerSettingsRow = {
  id: string;
  name: string;
  allow_backorder: boolean;
  default_wastage_pct: number;
  dual_unit_enabled: boolean;
  vat_enabled: boolean;
  default_vat_rate: number;
  tax_id: string | null;
  menu_mode: "simple" | "advanced";
};

async function fetchDealerSettings(dealerId: string): Promise<DealerSettingsRow> {
  const res = await vpsAuthedFetch(`/api/dealer-settings?dealerId=${encodeURIComponent(dealerId)}`);
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (body as any)?.error || `Failed to load settings (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return (body as any).dealer as DealerSettingsRow;
}

async function patchDealerSettings(
  dealerId: string,
  patch: Partial<Pick<DealerSettingsRow, "allow_backorder" | "default_wastage_pct" | "dual_unit_enabled" | "vat_enabled" | "default_vat_rate" | "menu_mode">>,
): Promise<DealerSettingsRow> {
  const res = await vpsAuthedFetch(`/api/dealer-settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealerId, ...patch }),
  });
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (body as any)?.error || `Failed to save settings (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return (body as any).dealer as DealerSettingsRow;
}

const SettingsPage = () => {
  const { isDealerAdmin } = usePermissions();
  const { planFeatures, isSuperAdmin } = useAuth();
  const backordersEnabled = isSuperAdmin || !!(planFeatures?.backordersEnabled);
  // The Simple/Advanced toggle only appears for packages that include the
  // advanced menu (Business / Premium Custom). Other packages are standard-only.
  const showMenuMode = isSuperAdmin || planHasAdvancedMenu(planFeatures);
  const dealerId = useDealerId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: dealer, isLoading } = useQuery({
    queryKey: ["dealer-settings", dealerId],
    queryFn: () => fetchDealerSettings(dealerId),
    enabled: !!dealerId,
  });

  const [wastageInput, setWastageInput] = useState<string>("10");
  const [vatRateInput, setVatRateInput] = useState<string>("15");
  useEffect(() => {
    if (dealer?.default_wastage_pct != null) {
      setWastageInput(String(dealer.default_wastage_pct));
    }
  }, [dealer?.default_wastage_pct]);
  useEffect(() => {
    if (dealer?.default_vat_rate != null) {
      setVatRateInput(String(dealer.default_vat_rate));
    }
  }, [dealer?.default_vat_rate]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dealer-settings"] });
    queryClient.invalidateQueries({ queryKey: ["dealer-info"] });
  };

  const setMenuMode = useMutation({
    mutationFn: (mode: "simple" | "advanced") => patchDealerSettings(dealerId, { menu_mode: mode }),
    onSuccess: async (_, mode) => {
      invalidate();
      // Refresh the auth payload so the sidebar re-filters immediately.
      await vpsAuthApi.me().catch(() => {});
      window.dispatchEvent(new Event("vps-auth-change"));
      toast.success(
        mode === "simple"
          ? "Simple menu enabled — only core daily modules are shown"
          : "Advanced menu enabled — all modules are visible",
      );
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleBackorder = useMutation({
    mutationFn: (enabled: boolean) => patchDealerSettings(dealerId, { allow_backorder: enabled }),
    onSuccess: (_, enabled) => {
      invalidate();
      toast.success(enabled ? "Backorder mode enabled" : "Backorder mode disabled");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const saveWastage = useMutation({
    mutationFn: (pct: number) => {
      if (!Number.isFinite(pct) || pct < 0 || pct > 25) {
        throw new Error("Default wastage must be between 0 and 25");
      }
      return patchDealerSettings(dealerId, { default_wastage_pct: pct });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Default wastage saved");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleDualUnit = useMutation({
    mutationFn: (enabled: boolean) => patchDealerSettings(dealerId, { dual_unit_enabled: enabled }),
    onSuccess: (_, enabled) => {
      invalidate();
      toast.success(enabled ? "Dual-unit (Box + Pc) mode enabled" : "Dual-unit mode disabled");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleVat = useMutation({
    mutationFn: (enabled: boolean) => patchDealerSettings(dealerId, { vat_enabled: enabled }),
    onSuccess: (_, enabled) => {
      invalidate();
      toast.success(enabled ? "VAT enabled on new sales & purchases" : "VAT disabled");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const saveVatRate = useMutation({
    mutationFn: (rate: number) => {
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        throw new Error("VAT rate must be between 0 and 100");
      }
      return patchDealerSettings(dealerId, { default_vat_rate: rate });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Default VAT rate saved");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!isDealerAdmin) {
    return (
      <div className="container mx-auto max-w-4xl p-6">
        <p className="text-destructive">Access denied. Dealer admin only.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-2">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          {/* Menu Mode — Simple vs Advanced (only for packages with the advanced menu) */}
          {showMenuMode && (
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <LayoutGrid className="h-4 w-4" />
                Menu Mode
              </CardTitle>
              <CardDescription>
                Choose how many modules your team sees. Start <strong>Simple</strong> for daily
                operations; switch to <strong>Advanced</strong> to unlock growth, HRM and advanced finance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => dealer?.menu_mode !== "simple" && setMenuMode.mutate("simple")}
                  disabled={setMenuMode.isPending}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    dealer?.menu_mode === "simple"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold">Simple</span>
                    {dealer?.menu_mode === "simple" && (
                      <Badge variant="default" className="text-[10px]">Active</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Core daily work only — Sales, POS, Purchase, Inventory, Collections,
                    Ledger, VAT, Reports.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => dealer?.menu_mode !== "advanced" && setMenuMode.mutate("advanced")}
                  disabled={setMenuMode.isPending}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    dealer?.menu_mode === "advanced"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold">Advanced</span>
                    {dealer?.menu_mode === "advanced" && (
                      <Badge variant="default" className="text-[10px]">Active</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Everything — adds Leads, Projects, Quotations, Campaigns, HRM,
                    EMI, Directors, Journal and more.
                  </p>
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                This applies to your whole team. Staff also only see screens relevant to their role.
              </p>
            </CardContent>
          </Card>
          )}

          {/* Stock & Backorder Settings — Pro+ plan only */}
          {backordersEnabled && <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Stock & Backorder Settings
              </CardTitle>
              <CardDescription>
                Control how the system handles sales when stock is insufficient.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="allow-backorder" className="text-sm font-medium">
                    Allow Sale Below Stock (Backorder Mode)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    When enabled, salesmen can create invoices for quantities exceeding current stock.
                    The system will track shortages and auto-allocate when new stock arrives.
                  </p>
                </div>
                <Switch
                  id="allow-backorder"
                  checked={dealer?.allow_backorder === true}
                  onCheckedChange={(checked) => toggleBackorder.mutate(checked)}
                  disabled={toggleBackorder.isPending}
                />
              </div>

              {dealer?.allow_backorder && (
                <div className="rounded-md border border-warning/40 bg-warning-muted p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    <span className="text-sm font-medium text-warning">Backorder Mode is Active</span>
                  </div>
                  <ul className="text-xs text-warning space-y-1 list-disc pl-5">
                    <li>Sales can be created for quantities above current stock</li>
                    <li>Shortage quantities are tracked as "Backordered"</li>
                    <li>New purchases auto-allocate to oldest pending backorders (FIFO)</li>
                    <li>Partial deliveries are supported for backorder sales</li>
                    <li>All backorder activity is logged in audit trail</li>
                  </ul>
                </div>
              )}

              <Separator />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={`rounded-md border p-4 ${!dealer?.allow_backorder ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold">Strict Stock Mode</span>
                    {!dealer?.allow_backorder && (
                      <Badge variant="default" className="text-[10px]">Active</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Sales are blocked when requested quantity exceeds available stock.
                  </p>
                </div>
                <div className={`rounded-md border p-4 ${dealer?.allow_backorder ? "border-warning/40 bg-warning-muted" : "border-border"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Package className="h-4 w-4 text-warning" />
                    <span className="text-sm font-semibold">Backorder Mode</span>
                    {dealer?.allow_backorder && (
                      <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">Active</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Allows billing even when stock is insufficient.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>}

          {/* VAT / Mushak */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                VAT / Mushak (Bangladesh)
              </CardTitle>
              <CardDescription>
                Enable VAT on new sales and purchases. Dealer BIN is set by super-admin; customer and supplier BIN/TIN are on their profiles.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {dealer?.tax_id && (
                <p className="text-xs text-muted-foreground">
                  Dealer BIN: <span className="font-mono text-foreground">{dealer.tax_id}</span>
                </p>
              )}
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="vat-enabled" className="text-sm font-medium">
                    Enable VAT on documents
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Adds VAT at the default rate to taxable amount on new sales and purchases. Existing documents are unchanged.
                  </p>
                </div>
                <Switch
                  id="vat-enabled"
                  checked={dealer?.vat_enabled === true}
                  onCheckedChange={(checked) => toggleVat.mutate(checked)}
                  disabled={toggleVat.isPending}
                />
              </div>
              <div className="flex items-end gap-3">
                <div>
                  <Label htmlFor="default-vat-rate" className="text-sm font-medium">
                    Default VAT rate (%)
                  </Label>
                  <Input
                    id="default-vat-rate"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={vatRateInput}
                    onChange={(e) => setVatRateInput(e.target.value)}
                    className="mt-1 max-w-[140px]"
                    disabled={!dealer?.vat_enabled}
                  />
                </div>
                <Button
                  onClick={() => saveVatRate.mutate(Number(vatRateInput))}
                  disabled={saveVatRate.isPending || !dealer?.vat_enabled}
                >
                  Save rate
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Dual-Unit (Box + Piece) Stock Mode */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Dual-Unit Stock Mode (Box + Piece)
              </CardTitle>
              <CardDescription>
                Track and bill stock in both Box and individual Piece units. Each product uses its{" "}
                <span className="font-medium text-foreground">Pieces per Box</span> value to convert.
                Stock displays as <span className="font-mono">X box Y pcs</span>. Phase 1 ships the schema; Purchase/Sale forms switch to Box + Pc inputs in the next phase.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="dual-unit" className="text-sm font-medium">
                    Enable Dual-Unit Mode
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Off by default. When enabled, Purchase, Sale, Return and Reservation forms will accept separate Box Qty and Piece Qty fields for this dealer.
                  </p>
                </div>
                <Switch
                  id="dual-unit"
                  checked={dealer?.dual_unit_enabled === true}
                  onCheckedChange={(checked) => toggleDualUnit.mutate(checked)}
                  disabled={toggleDualUnit.isPending}
                />
              </div>
            </CardContent>
          </Card>

          {/* Area Calculator Defaults */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calculator className="h-4 w-4" />
                Area Calculator Defaults
              </CardTitle>
              <CardDescription>
                Default wastage % used when a salesman opens the Area Calculator. They can still override per calculation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label htmlFor="default-wastage" className="text-sm font-medium">
                    Default Wastage % (0–25)
                  </Label>
                  <Input
                    id="default-wastage"
                    type="number"
                    min={0}
                    max={25}
                    step={1}
                    value={wastageInput}
                    onChange={(e) => setWastageInput(e.target.value)}
                    className="mt-1 max-w-[140px]"
                  />
                </div>
                <Button
                  onClick={() => saveWastage.mutate(Number(wastageInput))}
                  disabled={saveWastage.isPending}
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Industry standard for tile cuts is 10%. Salesman overrides are recorded in the measurement snapshot.
              </p>
            </CardContent>
          </Card>

          {/* Pricing Tiers */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Tags className="h-4 w-4" />
                Pricing Tiers
              </CardTitle>
              <CardDescription>
                Define named price levels (Retail, Wholesale, Contractor, Project) and per-product rates.
                Customers linked to a tier get those rates auto-filled in quotations and sales.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => navigate("/settings/pricing-tiers")}>
                Manage Pricing Tiers <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          {/* Data Backup & Restore */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Data Backup & Restore
              </CardTitle>
              <CardDescription>
                Export your dealer data as CSV files for safekeeping or migration. Restore later via the bulk import tools.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => navigate("/settings/data-backup")}>
                Open Backup & Restore <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          {/* Role Management */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Role Management
              </CardTitle>
              <CardDescription>
                Invite team members, assign roles (Owner, Manager, Accountant, Sales Agent), and view the permission matrix.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => navigate("/settings/roles")}>
                Manage Roles & Team <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          {/* Approval Workflow */}
          <ApprovalSettingsCard />

          {/* Demand Planning Thresholds */}
          <DemandPlanningSettingsCard />

          {/* WhatsApp Automation */}
          <WhatsAppSettingsCard />

          {/* SMTP Email Configuration */}
          <SmtpSettingsCard />
        </>
      )}
    </div>
  );
};

export default SettingsPage;
