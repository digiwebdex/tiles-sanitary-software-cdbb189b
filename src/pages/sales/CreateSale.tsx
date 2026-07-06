import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { useDealerId } from "@/hooks/useDealerId";
import { salesService } from "@/services/salesService";
import { quotationService } from "@/services/quotationService";
import { salesOrderService } from "@/services/salesOrderService";
import { saleCommissionService } from "@/services/commissionService";
import SaleForm from "@/modules/sales/SaleForm";
import type { SaleFormValues } from "@/modules/sales/saleSchema";
import type { SaleItemInput } from "@/services/salesService";
import type { SaleCommissionDraft } from "@/components/sale/SaleCommissionSection";
import { toast } from "sonner";
import { ArrowLeft, FileSignature, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface PrefillState {
  quotation_id?: string;
  sales_order_id?: string;
  customer_name?: string;
  discount?: number;
  notes?: string;
  items?: Array<{ product_id: string; quantity: number; sale_rate: number }>;
  reservation_selections?: Record<string, Array<{ reservation_id: string; consume_qty: number }>>;
  project_id?: string | null;
  site_id?: string | null;
}

const CreateSalePage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dealerId = useDealerId();
  const location = useLocation();
  const prefill = (location.state ?? {}) as PrefillState;
  const fromQuotation = !!prefill.quotation_id;
  const fromSalesOrder = !!prefill.sales_order_id;

  const mutation = useMutation({
    mutationFn: async (values: SaleFormValues & { allow_backorder?: boolean; reservation_selections?: Record<string, Array<{ reservation_id: string; consume_qty: number }>>; commission?: SaleCommissionDraft | null }) => {
      const result = await salesService.create({
        dealer_id: dealerId,
        customer_name: values.customer_name,
        sale_date: values.sale_date,
        sale_type: values.sale_type,
        discount: values.discount,
        discount_reference: values.discount_reference || "",
        client_reference: values.client_reference || "",
        fitter_reference: values.fitter_reference || "",
        paid_amount: values.paid_amount,
        payment_mode: values.payment_mode || undefined,
        paid_account_id: values.paid_account_id ?? null,
        notes: values.notes,
        items: values.items as SaleItemInput[],
        allow_backorder: values.allow_backorder,
        reservation_selections: values.reservation_selections,
        project_id: values.project_id ?? null,
        site_id: values.site_id ?? null,
      });
      // Link back to quotation / sales order if applicable
      if (fromQuotation && prefill.quotation_id && result?.id) {
        try {
          await quotationService.linkToSale(prefill.quotation_id, result.id, dealerId);
        } catch (e) {
          toast.warning("Sale created, but failed to mark quotation as converted: " + (e as Error).message);
        }
      }
      if (fromSalesOrder && prefill.sales_order_id && result?.id) {
        try {
          await salesOrderService.linkToSale(prefill.sales_order_id, result.id, dealerId);
        } catch (e) {
          toast.warning("Sale created, but failed to mark sales order as converted: " + (e as Error).message);
        }
      }
      // Persist optional commission
      if (values.commission && values.commission.referral_source_id && result?.id) {
        const subtotal = (values.items ?? []).reduce(
          (s, it: any) => s + Number(it.quantity || 0) * Number(it.sale_rate || 0),
          0,
        );
        const base = Math.max(0, subtotal - Number(values.discount || 0));
        try {
          await saleCommissionService.upsert({
            dealer_id: dealerId,
            sale_id: result.id,
            referral_source_id: values.commission.referral_source_id,
            commission_type: values.commission.commission_type,
            commission_value: values.commission.commission_value,
            commission_base_amount: base,
            notes: values.commission.notes ?? null,
          });
        } catch (e) {
          toast.warning("Sale saved, but commission could not be recorded: " + (e as Error).message);
        }
      }
      return { id: result!.id, sale_type: values.sale_type };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      if (fromQuotation) {
        toast.success("Quotation converted to sale");
      } else if (fromSalesOrder) {
        toast.success("Sales order invoiced");
      } else if (data.sale_type === "challan_mode") {
        toast.success("Sale created in challan mode (draft)");
      } else {
        toast.success("Sale confirmed & stock updated");
      }
      navigate("/sales");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="container mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/sales")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold text-foreground">New Sale</h1>
      </div>

      {fromQuotation && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3 flex items-center gap-2 text-sm">
            <FileSignature className="h-4 w-4 text-primary" />
            <span>
              Converting from quotation. Items, customer, and discount have been prefilled. Stock, credit, and approval rules will be re-validated when you save.
            </span>
          </CardContent>
        </Card>
      )}

      {fromSalesOrder && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3 flex items-center gap-2 text-sm">
            <ClipboardList className="h-4 w-4 text-primary" />
            <span>
              Creating invoice from sales order. Items, customer, discount, and this order's stock reservations have been prefilled — review before saving.
            </span>
          </CardContent>
        </Card>
      )}

      <SaleForm
        dealerId={dealerId}
        onSubmit={async (v) => { await mutation.mutateAsync(v); }}
        isLoading={mutation.isPending}
        defaultValues={
          fromQuotation || fromSalesOrder
            ? {
                customer_name: prefill.customer_name ?? "",
                discount: prefill.discount ?? 0,
                notes: prefill.notes ?? "",
                project_id: prefill.project_id ?? null,
                site_id: prefill.site_id ?? null,
                items:
                  prefill.items && prefill.items.length > 0
                    ? prefill.items
                    : [{ product_id: "", quantity: 0, sale_rate: 0 }],
              }
            : undefined
        }
        initialReservationSelections={fromSalesOrder ? prefill.reservation_selections : undefined}
      />
    </div>
  );
};

export default CreateSalePage;
