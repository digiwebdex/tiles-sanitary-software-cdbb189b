import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { productService } from "@/services/productService";
import ProductForm from "@/modules/products/ProductForm";
import type { ProductFormValues } from "@/modules/products/productSchema";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CreateProductPageProps {
  dealerId: string;
}

const CreateProductPage = ({ dealerId }: CreateProductPageProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      await productService.create({
        sku: values.sku,
        name: values.name,
        category: values.category,
        dealer_id: dealerId,
        unit_type: values.unit_type,
        cost_price: values.cost_price ?? 0,
        default_sale_rate: values.default_sale_rate,
        reorder_level: values.reorder_level,
        active: values.active,
        brand: values.brand || null,
        size: values.size || null,
        color: values.color || null,
        per_box_sft: values.per_box_sft ?? null,
        material: (values as any).material || null,
        weight: (values as any).weight || null,
        warranty: (values as any).warranty || null,
        ...((values as any).image_url ? { image_url: (values as any).image_url } : {}),
        // V2 Sprint 2 — Product Master taxonomy (all optional)
        series: (values as any).series || null,
        collection_name: (values as any).collection_name || null,
        tile_type: (values as any).tile_type || null,
        finish: (values as any).finish || null,
        surface: (values as any).surface || null,
        shade_family: (values as any).shade_family || null,
        caliber_spec: (values as any).caliber_spec || null,
        thickness_mm: (values as any).thickness_mm ?? null,
        country_of_origin: (values as any).country_of_origin || null,
        default_rack: (values as any).default_rack || null,
      } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product created");
      navigate("/products");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/products")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold text-foreground">New Product</h1>
      </div>
      <ProductForm
        onSubmit={async (v) => { await mutation.mutateAsync(v); }}
        isLoading={mutation.isPending}
        dealerId={dealerId}
      />
    </div>
  );
};

export default CreateProductPage;
