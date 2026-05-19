import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useDealerId } from "@/hooks/useDealerId";
import { purchaseService } from "@/services/purchaseService";
import PurchaseForm from "@/modules/purchases/PurchaseForm";
import type { PurchaseFormValues } from "@/modules/purchases/purchaseSchema";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const CreatePurchasePage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDealerAdmin, isSuperAdmin } = useAuth();
  const dealerId = useDealerId();
  const showOfferPrice = isDealerAdmin || isSuperAdmin;

  const mutation = useMutation({
    mutationFn: async (values: PurchaseFormValues) => {
      await purchaseService.create({
        dealer_id: dealerId,
        supplier_id: values.supplier_id,
        invoice_number: values.invoice_number || "",
        purchase_date: values.purchase_date,
        notes: values.notes,
        items: values.items as import("@/services/purchaseService").PurchaseItemInput[],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      toast.success("Purchase saved & stock updated");
      navigate("/purchases");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="container mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/purchases")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold text-foreground">New Purchase</h1>
      </div>
      <PurchaseForm
        dealerId={dealerId}
        showOfferPrice={showOfferPrice}
        enableDrafts={isDealerAdmin || isSuperAdmin}
        onSubmit={async (v) => { await mutation.mutateAsync(v); }}
        isLoading={mutation.isPending}
      />
    </div>
  );
};

export default CreatePurchasePage;
