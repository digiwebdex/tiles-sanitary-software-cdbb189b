import { useMemo, useEffect } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft, Save, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { useDealerId } from "@/hooks/useDealerId";
import { customerService } from "@/services/customerService";
import { productService } from "@/services/productService";
import { pricingTierService } from "@/services/pricingTierService";
import { teamService } from "@/services/teamService";
import { salesOrderService, type SalesOrder, type SalesOrderItem } from "@/services/salesOrderService";
import { salesOrderFormSchema, type SalesOrderFormInput, type SalesOrderItemInput } from "./salesOrderSchema";
import { formatCurrency } from "@/lib/utils";
import RateSourceBadge from "@/components/RateSourceBadge";
import { ProjectSitePicker } from "@/components/project/ProjectSitePicker";
import AvailabilityCell from "@/modules/quotations/AvailabilityCell";

interface Props {
  initialOrder?: SalesOrder;
  initialItems?: SalesOrderItem[];
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const SalesOrderForm = ({ initialOrder, initialItems }: Props) => {
  const navigate = useNavigate();
  const dealerId = useDealerId();
  const isEdit = !!initialOrder;

  const { data: customersResp } = useQuery({
    queryKey: ["customers-for-sales-order", dealerId],
    queryFn: () => customerService.list(dealerId, "", "", 1),
  });
  const { data: productsResp } = useQuery({
    queryKey: ["products-for-sales-order", dealerId],
    queryFn: () => productService.list(dealerId, "", 1),
  });
  const { data: teamResp } = useQuery({
    queryKey: ["team-for-sales-order"],
    queryFn: () => teamService.list(),
  });

  const customers = customersResp?.data ?? [];
  const products = useMemo(() => (productsResp?.data ?? []).filter((p) => p.active), [productsResp]);
  const salespeople = useMemo(
    () => (teamResp?.members ?? []).filter((m) => m.status === "active" && m.role !== "accountant"),
    [teamResp],
  );

  const form = useForm<SalesOrderFormInput>({
    resolver: zodResolver(salesOrderFormSchema),
    defaultValues: {
      customer_id: initialOrder?.customer_id ?? null,
      customer_name_text: initialOrder?.customer_name_text ?? "",
      customer_phone_text: initialOrder?.customer_phone_text ?? "",
      customer_address_text: initialOrder?.customer_address_text ?? "",
      quotation_id: initialOrder?.quotation_id ?? null,
      project_id: initialOrder?.project_id ?? null,
      site_id: initialOrder?.site_id ?? null,
      salesperson_id: initialOrder?.salesperson_id ?? null,
      order_date: initialOrder?.order_date ?? todayISO(),
      discount_type: initialOrder?.discount_type ?? "flat",
      discount_value: Number(initialOrder?.discount_value ?? 0),
      planned_delivery_date: initialOrder?.planned_delivery_date ?? null,
      notes: initialOrder?.notes ?? "",
      terms_text: initialOrder?.terms_text ?? "",
      items:
        initialItems?.map((it) => ({
          id: it.id,
          product_id: it.product_id,
          product_name_snapshot: it.product_name_snapshot,
          product_sku_snapshot: it.product_sku_snapshot,
          unit_type: it.unit_type,
          per_box_sft: it.per_box_sft,
          quantity: Number(it.quantity),
          rate: Number(it.rate),
          discount_value: Number(it.discount_value),
          line_total: Number(it.line_total),
          rate_source: it.rate_source ?? "default",
          tier_id: it.tier_id ?? null,
          preferred_shade_code: it.preferred_shade_code,
          preferred_caliber: it.preferred_caliber,
          preferred_batch_no: it.preferred_batch_no,
        })) ?? [],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const watchedItems = form.watch("items");
  const watchedDiscountType = form.watch("discount_type");
  const watchedDiscountValue = form.watch("discount_value");

  const subtotal = (watchedItems ?? []).reduce(
    (s, it) => s + Math.max(0, Number(it.quantity || 0) * Number(it.rate || 0) - Number(it.discount_value || 0)),
    0,
  );
  const discountAmount =
    watchedDiscountType === "percent" ? (subtotal * Number(watchedDiscountValue || 0)) / 100 : Number(watchedDiscountValue || 0);
  const total = Math.max(0, subtotal - discountAmount);

  const customerId = form.watch("customer_id");
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const tierId = selectedCustomer?.price_tier_id ?? null;

  useEffect(() => {
    if (selectedCustomer) {
      form.setValue("customer_name_text", selectedCustomer.name);
      form.setValue("customer_phone_text", selectedCustomer.phone ?? "");
      form.setValue("customer_address_text", selectedCustomer.address ?? "");
    }
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const addProductLine = async (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const resolved = await pricingTierService.resolvePrice(dealerId, p.id, tierId);
    append({
      product_id: p.id,
      product_name_snapshot: p.name,
      product_sku_snapshot: p.sku,
      unit_type: p.unit_type as "box_sft" | "piece",
      per_box_sft: p.per_box_sft,
      quantity: 1,
      rate: resolved.rate,
      discount_value: 0,
      line_total: resolved.rate,
      rate_source: resolved.source,
      tier_id: resolved.tier_id,
      preferred_shade_code: null,
      preferred_caliber: null,
      preferred_batch_no: null,
    });
  };

  const addBlankLine = () => {
    append({
      product_id: null,
      product_name_snapshot: "",
      product_sku_snapshot: null,
      unit_type: "piece",
      per_box_sft: null,
      quantity: 1,
      rate: 0,
      discount_value: 0,
      line_total: 0,
      rate_source: "default",
      tier_id: null,
      preferred_shade_code: null,
      preferred_caliber: null,
      preferred_batch_no: null,
    });
  };

  const saveDraftMutation = useMutation({
    mutationFn: async (data: SalesOrderFormInput) => {
      if (isEdit) {
        await salesOrderService.updateDraft(initialOrder!.id, dealerId, data);
        return initialOrder!.id;
      }
      const created = await salesOrderService.createDraft(dealerId, data);
      return created.id;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Sales order updated" : "Draft saved");
      navigate("/sales-orders");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveAndConfirmMutation = useMutation({
    mutationFn: async (data: SalesOrderFormInput) => {
      let id = initialOrder?.id;
      if (isEdit) {
        await salesOrderService.updateDraft(initialOrder!.id, dealerId, data);
      } else {
        const created = await salesOrderService.createDraft(dealerId, data);
        id = created.id;
      }
      return salesOrderService.confirm(id!, dealerId);
    },
    onSuccess: ({ warnings }) => {
      if (warnings.length > 0) {
        toast.warning(warnings[0].message, {
          description: warnings.length > 1 ? `+${warnings.length - 1} more line(s) with limited stock` : undefined,
        });
      } else {
        toast.success("Sales order confirmed — stock reserved");
      }
      navigate("/sales-orders");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onSaveDraft = form.handleSubmit((data) => saveDraftMutation.mutate(data));
  const onSaveAndConfirm = form.handleSubmit((data) => saveAndConfirmMutation.mutate(data));

  const isSaving = saveDraftMutation.isPending || saveAndConfirmMutation.isPending;
  const isLockedForEdit = isEdit && initialOrder && initialOrder.status !== "draft";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/sales-orders")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-xl font-bold">{isEdit ? "Edit Sales Order" : "New Sales Order"}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onSaveDraft} disabled={isSaving || !!isLockedForEdit}>
            <Save className="h-4 w-4 mr-1" /> Save Draft
          </Button>
          <Button onClick={onSaveAndConfirm} disabled={isSaving || !!isLockedForEdit}>
            <CheckCircle2 className="h-4 w-4 mr-1" /> Save & Confirm
          </Button>
        </div>
      </div>

      {isLockedForEdit && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="text-sm py-3 text-foreground">
            This sales order is <strong>{initialOrder?.status}</strong> and cannot be edited here. Use the detail view to
            change line quantities, delivery planning, or to cancel it.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Customer & Order Info</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Customer</Label>
            <Controller
              control={form.control}
              name="customer_id"
              render={({ field }) => (
                <Select value={field.value ?? "__walkin"} onValueChange={(v) => field.onChange(v === "__walkin" ? null : v)}>
                  <SelectTrigger><SelectValue placeholder="Pick customer or walk-in" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__walkin">Walk-in (enter manually)</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.customer_id && (
              <p className="text-xs text-destructive mt-1">{form.formState.errors.customer_id.message as string}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              A registered customer is required before this order can be confirmed (stock reservations need one linked).
            </p>
          </div>
          <div>
            <Label>Walk-in / Customer Name</Label>
            <Input {...form.register("customer_name_text")} placeholder="e.g. Mr. Karim" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input {...form.register("customer_phone_text")} placeholder="01XXXXXXXXX" />
          </div>
          <div>
            <Label>Address</Label>
            <Input {...form.register("customer_address_text")} placeholder="Site / delivery address" />
          </div>
          <div>
            <Label>Order Date</Label>
            <Input type="date" {...form.register("order_date")} />
          </div>
          <div>
            <Label>Planned Delivery Date</Label>
            <Input type="date" {...form.register("planned_delivery_date")} />
          </div>
          <div>
            <Label>Salesperson</Label>
            <Controller
              control={form.control}
              name="salesperson_id"
              render={({ field }) => (
                <Select value={field.value ?? "__none"} onValueChange={(v) => field.onChange(v === "__none" ? null : v)}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Unassigned</SelectItem>
                    {salespeople.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="md:col-span-2">
            <Controller
              control={form.control}
              name="project_id"
              render={({ field: projectField }) => (
                <Controller
                  control={form.control}
                  name="site_id"
                  render={({ field: siteField }) => (
                    <ProjectSitePicker
                      dealerId={dealerId}
                      customerId={customerId ?? null}
                      projectId={projectField.value ?? null}
                      siteId={siteField.value ?? null}
                      onChange={({ projectId, siteId }) => {
                        projectField.onChange(projectId);
                        siteField.onChange(siteId);
                      }}
                      disabled={!!isLockedForEdit}
                    />
                  )}
                />
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Items</span>
            <div className="flex items-center gap-2">
              <Select onValueChange={addProductLine}>
                <SelectTrigger className="w-72"><SelectValue placeholder="Add product…" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={addBlankLine}>
                <Plus className="h-4 w-4 mr-1" /> Custom Line
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No items yet. Add a product or a custom line.</p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left text-xs text-muted-foreground uppercase">
                    <th className="py-2 pr-2">Description</th>
                    <th className="py-2 px-2 w-28">Available</th>
                    <th className="py-2 px-2 w-24">Qty</th>
                    <th className="py-2 px-2 w-28">Rate</th>
                    <th className="py-2 px-2 w-28">Line Disc.</th>
                    <th className="py-2 px-2 w-28 text-right">Total</th>
                    <th className="py-2 pl-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, idx) => {
                    const it = watchedItems?.[idx];
                    const lineTotal = it ? Math.max(0, Number(it.quantity || 0) * Number(it.rate || 0) - Number(it.discount_value || 0)) : 0;
                    return (
                      <tr key={f.id} className="border-b align-top">
                        <td className="py-2 pr-2 space-y-1">
                          <Input {...form.register(`items.${idx}.product_name_snapshot`)} placeholder="Product name" />
                          <Input {...form.register(`items.${idx}.product_sku_snapshot`)} placeholder="SKU (optional)" className="text-xs" />
                          <div className="grid grid-cols-3 gap-1">
                            <Input {...form.register(`items.${idx}.preferred_shade_code`)} placeholder="Shade" className="text-xs" />
                            <Input {...form.register(`items.${idx}.preferred_caliber`)} placeholder="Caliber" className="text-xs" />
                            <Input {...form.register(`items.${idx}.preferred_batch_no`)} placeholder="Batch" className="text-xs" />
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <AvailabilityCell productId={it?.product_id ?? null} dealerId={dealerId} />
                        </td>
                        <td className="py-2 px-2">
                          <Input type="number" step="0.01" {...form.register(`items.${idx}.quantity`)} />
                          <Controller
                            control={form.control}
                            name={`items.${idx}.unit_type`}
                            render={({ field }) => (
                              <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="piece">piece</SelectItem>
                                  <SelectItem value="box_sft">box_sft</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <Input
                            type="number"
                            step="0.01"
                            className={(it as { rate_source?: string })?.rate_source === "manual" ? "border-warning/50 bg-warning/5" : ""}
                            {...form.register(`items.${idx}.rate`, {
                              onChange: () => form.setValue(`items.${idx}.rate_source`, "manual"),
                            })}
                          />
                          <div className="mt-1 flex justify-end">
                            <RateSourceBadge source={(it as { rate_source?: string })?.rate_source ?? "default"} />
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <Input type="number" step="0.01" {...form.register(`items.${idx}.discount_value`)} />
                        </td>
                        <td className="py-2 px-2 text-right font-semibold">{formatCurrency(lineTotal)}</td>
                        <td className="py-2 pl-2">
                          <Button type="button" variant="ghost" size="icon" onClick={() => remove(idx)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {form.formState.errors.items && (
            <p className="text-xs text-destructive mt-2">{form.formState.errors.items.message as string}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Totals & Notes</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label>Notes</Label>
              <Textarea {...form.register("notes")} placeholder="Internal/customer notes" rows={3} />
            </div>
            <div>
              <Label>Terms & Conditions</Label>
              <Textarea {...form.register("terms_text")} placeholder="Validity, payment terms, delivery scope…" rows={3} />
            </div>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Discount Type</Label>
                <Controller
                  control={form.control}
                  name="discount_type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flat">Flat amount</SelectItem>
                        <SelectItem value="percent">Percent (%)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div>
                <Label>Discount Value</Label>
                <Input type="number" step="0.01" {...form.register("discount_value")} />
              </div>
            </div>
            <Separator />
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="text-destructive">({formatCurrency(discountAmount)})</span></div>
              <Separator />
              <div className="flex justify-between text-base font-bold"><span>Total</span><span>{formatCurrency(total)}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SalesOrderForm;
