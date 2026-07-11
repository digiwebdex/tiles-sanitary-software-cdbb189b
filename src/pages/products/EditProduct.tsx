import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { productService } from "@/services/productService";
import { logAudit } from "@/services/auditService";
import { useAuth } from "@/contexts/AuthContext";
import ProductForm from "@/modules/products/ProductForm";
import type { ProductFormValues } from "@/modules/products/productSchema";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const EditProductPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile, user } = useAuth();

  if (!id) {
    return <p className="p-6 text-destructive">Invalid product ID</p>;
  }

  const { data: product, isLoading } = useQuery({
    queryKey: ["product", id],
    queryFn: () => productService.getById(id!, profile?.dealer_id ?? undefined),
    enabled: !!id,
  });

  const mutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const updatePayload = {
        ...values,
        brand: values.brand || null,
        size: values.size || null,
        color: values.color || null,
        per_box_sft: values.per_box_sft ?? null,
        material: (values as any).material || null,
        weight: (values as any).weight || null,
        warranty: (values as any).warranty || null,
        image_url: (values as any).image_url || null,
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
      } as any;
      await productService.update(id!, updatePayload);

      // Detect price change
      const action = product && product.default_sale_rate !== values.default_sale_rate
        ? "price_change"
        : "product_edit";

      await logAudit({
        dealer_id: profile?.dealer_id ?? "",
        user_id: user?.id,
        action,
        table_name: "products",
        record_id: id!,
        old_data: product ? {
          name: product.name, sku: product.sku, default_sale_rate: product.default_sale_rate,
          brand: product.brand, size: product.size, color: product.color, active: product.active,
        } : null,
        new_data: {
          name: values.name, sku: values.sku, default_sale_rate: values.default_sale_rate,
          brand: values.brand, size: values.size, color: values.color, active: values.active,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product updated");
      navigate("/products");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!product) return <p className="p-6 text-destructive">Product not found</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/products")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Edit Product</h1>
      </div>
      <ProductForm
        defaultValues={{
          sku: product.sku,
          name: product.name,
          brand: product.brand ?? "",
          category: product.category,
          size: product.size ?? "",
          color: product.color ?? "",
          unit_type: product.unit_type,
          per_box_sft: product.per_box_sft,
          default_sale_rate: product.default_sale_rate,
          reorder_level: product.reorder_level,
          active: product.active,
          material: (product as any).material ?? "",
          weight: (product as any).weight ?? "",
          warranty: (product as any).warranty ?? "",
          image_url: (product as any).image_url ?? "",
          // V2 Sprint 2 — Product Master taxonomy (all optional)
          series: (product as any).series ?? "",
          collection_name: (product as any).collection_name ?? "",
          tile_type: (product as any).tile_type ?? "",
          finish: (product as any).finish ?? "",
          surface: (product as any).surface ?? "",
          shade_family: (product as any).shade_family ?? "",
          caliber_spec: (product as any).caliber_spec ?? "",
          thickness_mm: (product as any).thickness_mm ?? null,
          country_of_origin: (product as any).country_of_origin ?? "",
          default_rack: (product as any).default_rack ?? "",
        }}
        onSubmit={async (v) => { await mutation.mutateAsync(v); }}
        isLoading={mutation.isPending}
        productId={id}
        dealerId={profile?.dealer_id ?? ""}
      />
    </div>
  );
};

export default EditProductPage;
