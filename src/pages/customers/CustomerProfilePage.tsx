import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDealerId } from "@/hooks/useDealerId";
import { customerService } from "@/services/customerService";
import { collectionsService } from "@/services/collectionsService";
import { pricingTierService } from "@/services/pricingTierService";
import { formatCurrency } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  retailer: "Retailer", customer: "Regular", project: "Project",
  dealer: "Dealer", contractor: "Contractor", builder: "Builder", corporate: "Corporate",
};

const AGING_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  current: { label: "Current", variant: "secondary" },
  "30+": { label: "30+ days", variant: "outline" },
  "60+": { label: "60+ days", variant: "default" },
  "90+": { label: "90+ days", variant: "destructive" },
};

/**
 * V2 Sprint 4A — Customer Profile: a read-only "Customer Ledger Summary"
 * view distinct from the edit FORM and the full Statement page. Reuses
 * existing read endpoints only (customerService.getById,
 * collectionsService.getCustomerOutstanding, pricingTierService.listTiers);
 * links out to the existing full Statement page rather than duplicating it.
 */
const CustomerProfilePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dealerId = useDealerId();

  const { data: customer, isLoading } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => customerService.getById(id!),
    enabled: !!id,
  });
  const { data: outstanding } = useQuery({
    queryKey: ["customer-outstanding", dealerId, id],
    queryFn: () => collectionsService.getCustomerOutstanding(dealerId, id!),
    enabled: !!dealerId && !!id,
  });
  const { data: tiers = [] } = useQuery({
    queryKey: ["price-tiers", dealerId],
    queryFn: () => pricingTierService.listTiers(dealerId),
    enabled: !!dealerId,
  });

  if (isLoading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!customer) return <p className="p-6 text-destructive">Customer not found</p>;

  const tier = tiers.find((t) => t.id === customer.price_tier_id);
  const aging = outstanding ? AGING_LABEL[outstanding.agingBucket] : null;

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/customers")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {customer.name}
              <Badge variant={customer.status === "active" ? "default" : "secondary"}>{customer.status}</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              {TYPE_LABELS[customer.type] ?? customer.type}
              {customer.customer_group && ` · ${customer.customer_group}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(`/customers/${id}/statement`)}>
            <BookOpen className="h-4 w-4 mr-2" /> Full Statement
          </Button>
          <Button onClick={() => navigate(`/customers/${id}/edit`)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Due Balance</p>
          <p className="text-xl font-bold text-destructive">{formatCurrency(outstanding?.outstanding ?? 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Credit Limit</p>
          <p className="text-xl font-bold">{customer.credit_limit > 0 ? formatCurrency(customer.credit_limit) : "No limit"}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Aging</p>
          {aging ? <Badge variant={aging.variant} className="mt-1">{aging.label}</Badge> : <p className="text-xl font-bold">—</p>}
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Price Level</p>
          <p className="text-xl font-bold">{tier?.name ?? "Default rates"}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Contact & Address</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Phone</p><p>{customer.phone || "—"}</p></div>
          <div><p className="text-muted-foreground">Email</p><p>{customer.email || "—"}</p></div>
          <div><p className="text-muted-foreground">Reference</p><p>{customer.reference_name || "—"}</p></div>
          <div><p className="text-muted-foreground">Tax ID (BIN/TIN)</p><p>{customer.tax_id || "—"}</p></div>
          <div className="col-span-2"><p className="text-muted-foreground">Address</p><p>{customer.address || "—"}</p></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Ledger Summary</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Opening Balance</p><p>{formatCurrency(customer.opening_balance)}</p></div>
          <div><p className="text-muted-foreground">Total Sales</p><p>{formatCurrency(outstanding?.total_sales ?? 0)}</p></div>
          <div><p className="text-muted-foreground">Total Paid</p><p>{formatCurrency(outstanding?.total_paid ?? 0)}</p></div>
          <div><p className="text-muted-foreground">Last Payment</p><p>{outstanding?.last_payment_date ? new Date(outstanding.last_payment_date).toLocaleDateString() : "—"}</p></div>
          {customer.default_discount_type && (
            <div className="col-span-2">
              <p className="text-muted-foreground">Default Discount Policy</p>
              <p>{customer.default_discount_type === "percent" ? `${customer.default_discount_value}%` : formatCurrency(customer.default_discount_value)}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CustomerProfilePage;
