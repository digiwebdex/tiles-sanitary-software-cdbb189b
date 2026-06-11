import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { salesReturnService } from "@/services/salesReturnService";
import SalesReturnWizard from "@/modules/sales-returns/SalesReturnWizard";
import type { SalesReturnFormValues } from "@/modules/sales-returns/salesReturnSchema";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const CreateSalesReturnPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const dealerId = profile?.dealer_id ?? "";

  const mutation = useMutation({
    mutationFn: async (values: SalesReturnFormValues) => {
      await salesReturnService.create({
        dealer_id: dealerId,
        sale_id: values.sale_id,
        product_id: values.product_id,
        qty: values.qty,
        qty_sqft: (values as any).qty_sqft,
        rate_unit: (values as any).rate_unit,
        reason: values.reason || "",
        is_broken: values.is_broken,
        refund_amount: values.refund_amount,
        return_date: values.return_date,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-returns"] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      toast.success("Return processed successfully");
      navigate("/sales-returns");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="container mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/sales-returns")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold text-foreground">New Sales Return</h1>
      </div>
      <SalesReturnWizard
        dealerId={dealerId}
        onSubmit={async (v) => { await mutation.mutateAsync(v); }}
        isLoading={mutation.isPending}
      />
    </div>
  );
};

export default CreateSalesReturnPage;
