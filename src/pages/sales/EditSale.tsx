import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useDealerId } from "@/hooks/useDealerId";
import { salesService } from "@/services/salesService";
import { saleCommissionService } from "@/services/commissionService";
import SaleForm from "@/modules/sales/SaleForm";
import type { SaleFormValues } from "@/modules/sales/saleSchema";
import type { SaleItemInput } from "@/services/salesService";
import type { SaleCommissionDraft } from "@/components/sale/SaleCommissionSection";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const EditSalePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dealerId = useDealerId();

  const { data: sale, isLoading: loading } = useQuery({
    queryKey: ["sale", id],
    queryFn: () => salesService.getById(id!),
    enabled: !!id,
  });

  const { data: existingCommission } = useQuery({
    queryKey: ["sale-commission", id],
    queryFn: () => saleCommissionService.getForSale(id!),
    enabled: !!id,
  });

  const mutation = useMutation({
    mutationFn: async (values: SaleFormValues & { commission?: SaleCommissionDraft | null }) => {
      await salesService.update(id!, {
        dealer_id: dealerId,
        customer_name: values.customer_name,
        sale_date: values.sale_date,
        discount: values.discount,
        discount_reference: values.discount_reference || "",
        client_reference: values.client_reference || "",
        fitter_reference: values.fitter_reference || "",
        paid_amount: values.paid_amount,
        payment_mode: values.payment_mode || undefined,
        paid_account_id: values.paid_account_id ?? null,
        notes: values.notes,
        items: values.items as SaleItemInput[],
      });
      // Sync commission
      const subtotal = (values.items ?? []).reduce(
        (s, it: any) => s + Number(it.quantity || 0) * Number(it.sale_rate || 0),
        0,
      );
      const base = Math.max(0, subtotal - Number(values.discount || 0));
      if (values.commission && values.commission.referral_source_id) {
        await saleCommissionService.upsert({
          dealer_id: dealerId,
          sale_id: id!,
          referral_source_id: values.commission.referral_source_id,
          commission_type: values.commission.commission_type,
          commission_value: values.commission.commission_value,
          commission_base_amount: base,
          notes: values.commission.notes ?? null,
        });
      } else if (existingCommission) {
        await saleCommissionService.removeForSale(id!, dealerId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sale", id] });
      queryClient.invalidateQueries({ queryKey: ["sale-commission", id] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      toast.success("Invoice updated successfully");
      navigate(`/sales/${id}/invoice`);
    },
    onError: (e) => toast.error(e.message),
  });

  const reverseMutation = useMutation({
    mutationFn: () => salesService.reverse(id!, dealerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sale", id] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      toast.success("Invoice reversed. Create a new sale to re-post with changes.");
      navigate("/sales");
    },
    onError: (e) => toast.error(e.message),
  });

  if (loading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!sale) return <p className="p-6 text-destructive">Sale not found</p>;

  const docStatus = (sale as any).document_status ?? "posted";
  const isImmutable = docStatus === "posted" || docStatus === "reversed";

  if (isImmutable) {
    return (
      <div className="container mx-auto max-w-2xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/sales/${id}/invoice`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Edit Invoice</h1>
          <span className="text-sm font-mono text-muted-foreground">{sale.invoice_number}</span>
        </div>
        <div className="rounded-md border border-warning/40 bg-warning-muted p-4 space-y-3">
          <p className="text-sm font-medium">
            {docStatus === "reversed"
              ? "This invoice has been reversed and cannot be edited."
              : "Posted invoices cannot be edited directly."}
          </p>
          <p className="text-xs text-muted-foreground">
            To change items or amounts, reverse this invoice and create a new sale with the correct details.
          </p>
          {docStatus === "posted" && (
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={reverseMutation.isPending}
                onClick={() => reverseMutation.mutate()}
              >
                Reverse Invoice
              </Button>
              <Button variant="outline" onClick={() => navigate("/sales/new")}>
                New Sale
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const customer = (sale as any).customers;
  const saleItems = ((sale as any).sale_items ?? []).map((si: any) => ({
    product_id: si.product_id,
    quantity: Number(si.quantity),
    sale_rate: Number(si.sale_rate),
  }));

  const defaultValues: Partial<SaleFormValues> = {
    customer_name: customer?.name ?? "",
    sale_date: sale.sale_date,
    sale_type: ((sale as any).sale_type as any) ?? "direct_invoice",
    discount: Number(sale.discount),
    discount_reference: sale.discount_reference ?? "",
    client_reference: sale.client_reference ?? "",
    fitter_reference: sale.fitter_reference ?? "",
    paid_amount: Number(sale.paid_amount),
    notes: sale.notes ?? "",
    items: saleItems,
  };

  const defaultCommission: SaleCommissionDraft | null = existingCommission
    ? {
        referral_source_id: existingCommission.referral_source_id,
        commission_type: existingCommission.commission_type,
        commission_value: Number(existingCommission.commission_value),
        notes: existingCommission.notes ?? undefined,
      }
    : null;

  return (
    <div className="container mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/sales/${id}/invoice`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Edit Invoice</h1>
        <span className="text-sm font-mono text-muted-foreground">{sale.invoice_number}</span>
      </div>
      <SaleForm
        dealerId={dealerId}
        onSubmit={async (v) => { await mutation.mutateAsync(v as any); }}
        isLoading={mutation.isPending}
        defaultValues={defaultValues}
        defaultCommission={defaultCommission}
        submitLabel="Update Invoice"
        priceLocked={Number(sale.paid_amount) > 0}
      />
    </div>
  );
};

export default EditSalePage;
