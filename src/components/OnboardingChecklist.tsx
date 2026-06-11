import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, X, Rocket } from "lucide-react";

interface OnboardingCounts {
  products: number;
  customers: number;
  suppliers: number;
  purchases: number;
  sales: number;
  collections: number;
  supplier_payments: number;
  sales_returns: number;
}

interface OnboardingChecklistProps {
  dealerId: string;
}

export default function OnboardingChecklist({ dealerId }: OnboardingChecklistProps) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const key = `onboarding-dismissed-${dealerId}`;
    if (localStorage.getItem(key) === "true") setDismissed(true);
  }, [dealerId]);

  const { data: counts } = useQuery({
    queryKey: ["onboarding-counts", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/dashboard/onboarding-counts?dealerId=${dealerId}`,
      );
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error((body as any)?.error || "Failed to load");
      return {
        products: Number(body.products ?? 0),
        customers: Number(body.customers ?? 0),
        suppliers: Number(body.suppliers ?? 0),
        purchases: Number(body.purchases ?? 0),
        sales: Number(body.sales ?? 0),
        collections: Number(body.collections ?? 0),
        supplier_payments: Number(body.supplier_payments ?? 0),
        sales_returns: Number(body.sales_returns ?? 0),
      } satisfies OnboardingCounts;
    },
    enabled: !!dealerId && !dismissed,
  });

  if (dismissed || !counts) return null;

  const items = [
    { label: "Add your first product", done: counts.products > 0, path: "/products/new" },
    { label: "Add your first customer", done: counts.customers > 0, path: "/customers/new" },
    { label: "Add your first supplier", done: counts.suppliers > 0, path: "/suppliers/new" },
    { label: "Record your first purchase", done: counts.purchases > 0, path: "/purchases/new" },
    { label: "Create your first sale", done: counts.sales > 0, path: "/sales/new" },
    { label: "Collect a customer payment", done: counts.collections > 0, path: "/collections" },
    { label: "Pay a supplier bill", done: counts.supplier_payments > 0, path: "/payables/pay" },
    { label: "Process a sales return (optional)", done: counts.sales_returns > 0, path: "/sales-returns/new", optional: true },
  ];

  const requiredItems = items.filter((i) => !("optional" in i && i.optional));
  const completedRequired = requiredItems.filter((i) => i.done).length;
  if (completedRequired === requiredItems.length) return null;

  const completed = items.filter((i) => i.done).length;
  const progress = Math.round((completed / items.length) * 100);

  const handleDismiss = () => {
    localStorage.setItem(`onboarding-dismissed-${dealerId}`, "true");
    setDismissed(true);
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          Welcome! Complete your setup
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Follow the golden path — products → purchase → sale → collections → supplier payment.
        </p>
        <div className="flex items-center gap-3">
          <Progress value={progress} className="flex-1 h-2" />
          <span className="text-xs text-muted-foreground font-medium">{completed} of {items.length}</span>
        </div>
        <div className="space-y-1.5">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => !item.done && navigate(item.path)}
              className={`flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 text-sm transition-colors ${
                item.done
                  ? "text-muted-foreground"
                  : "text-foreground hover:bg-primary/10 cursor-pointer"
              }`}
              disabled={item.done}
            >
              {item.done ? (
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className={item.done ? "line-through" : ""}>
                {item.label}
                {"optional" in item && item.optional && !item.done && (
                  <span className="text-muted-foreground ml-1">(optional)</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
