import { useState, useMemo, useEffect } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft, Save, FileCheck, Calculator, Ruler } from "lucide-react";
import AreaCalculatorDialog, { type AreaCalculatorInsertPayload } from "./AreaCalculatorDialog";
import AvailabilityCell from "./AvailabilityCell";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { useDealerId } from "@/hooks/useDealerId";
import { useAuth } from "@/contexts/AuthContext";
import { customerService } from "@/services/customerService";
import { productService } from "@/services/productService";
import { quotationService, type Quotation, type QuotationItem } from "@/services/quotationService";
import { pricingTierService } from "@/services/pricingTierService";
import { quotationFormSchema, type QuotationFormInput, type QuotationItemInput } from "./quotationSchema";
import type { MeasurementSnapshot } from "@/lib/areaCalculator";
import { formatCurrency } from "@/lib/utils";
import RateSourceBadge from "@/components/RateSourceBadge";
import { ProjectSitePicker } from "@/components/project/ProjectSitePicker";

interface Props {
  initialQuotation?: Quotation;
  initialItems?: QuotationItem[];
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const inDaysISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const QuotationForm = ({ initialQuotation, initialItems }: Props) => {
  const navigate = useNavigate();
  const dealerId = useDealerId();
  const { user } = useAuth();
  const isEdit = !!initialQuotation;

  const { data: customersResp } = useQuery({
    queryKey: ["customers-for-quotation", dealerId],
    queryFn: () => customerService.list(dealerId, "", "", 1),
  });
  const { data: productsResp } = useQuery({
    queryKey: ["products-for-quotation", dealerId],
    queryFn: () => productService.list(dealerId, "", 1),
  });

  const customers = customersResp?.data ?? [];
  const products = useMemo(() => (productsResp?.data ?? []).filter((p) => p.active), [productsResp]);

  const form = useForm<QuotationFormInput>({
    resolver: zodResolver(quotationFormSchema),
    defaultValues: {
      customer_id: initialQuotation?.customer_id ?? null,
      customer_name_text: initialQuotation?.customer_name_text ?? "",
      customer_phone_text: initialQuotation?.customer_phone_text ?? "",
      customer_address_text: initialQuotation?.customer_address_text ?? "",
      quote_date: initialQuotation?.quote_date ?? todayISO(),
      valid_until: initialQuotation?.valid_until ?? inDaysISO(7),
      discount_type: (initialQuotation?.discount_type as "flat" | "percent") ?? "flat",
      discount_value: Number(initialQuotation?.discount_value ?? 0),
      notes: initialQuotation?.notes ?? "",
      terms_text: initialQuotation?.terms_text ?? "",
      project_id: (initialQuotation as { project_id?: string | null } | undefined)?.project_id ?? null,
      site_id: (initialQuotation as { site_id?: string | null } | undefined)?.site_id ?? null,
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
          preferred_shade_code: it.preferred_shade_code,
          preferred_caliber: it.preferred_caliber,
          preferred_batch_no: it.preferred_batch_no,
          notes: it.notes,
          sort_order: it.sort_order,
          measurement_snapshot: (it as { measurement_snapshot?: unknown }).measurement_snapshot ?? null,
          rate_source: ((it as { rate_source?: string }).rate_source as "default" | "tier" | "manual") ?? "default",
          tier_id: (it as { tier_id?: string | null }).tier_id ?? null,
        })) ?? [],
    },
  });

  const [calcOpen, setCalcOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const { fields, append, remove, update } = useFieldArray({ control: form.control, name: "items" });
  const watchedItems = form.watch("items");
  const watchedDiscountType = form.watch("discount_type");
  const watchedDiscountValue = form.watch("discount_value");

  const subtotal = (watchedItems ?? []).reduce(
    (s, it) => s + Math.max(0, Number(it.quantity || 0) * Number(it.rate || 0) - Number(it.discount_value || 0)),
    0,
  );
  const discountAmount =
    watchedDiscountType === "percent"
      ? (subtotal * Number(watchedDiscountValue || 0)) / 100
      : Number(watchedDiscountValue || 0);
  const total = Math.max(0, subtotal - discountAmount);

  const customerId = form.watch("customer_id");
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const tierId = selectedCustomer?.price_tier_id ?? null;

  // Pre-load tier rates for products currently in the form (used for re-pricing on customer change)
  const formItems = form.watch("items");

  // When customer chosen from list, autofill walk-in fields and re-price default/tier lines (preserve manual)
  useEffect(() => {
    if (selectedCustomer) {
      form.setValue("customer_name_text", selectedCustomer.name);
      form.setValue("customer_phone_text", selectedCustomer.phone ?? "");
      form.setValue("customer_address_text", selectedCustomer.address ?? "");
    }
    // Re-price lines (skip manual)
    void (async () => {
      const current = form.getValues("items");
      const productIds = current.map((it) => it.product_id).filter((id): id is string => !!id);
      if (productIds.length === 0) return;
      const resolved = await pricingTierService.resolvePricesBatch(dealerId, productIds, tierId);
      let changedCount = 0;
      let keptManual = 0;
      current.forEach((it, idx) => {
        if (!it.product_id) return;
        if (it.rate_source === "manual") { keptManual += 1; return; }
        const r = resolved.get(it.product_id);
        if (!r) return;
        if (Number(it.rate) === r.rate && it.rate_source === r.source) return;
        form.setValue(`items.${idx}.rate`, r.rate);
        form.setValue(`items.${idx}.rate_source`, r.source);
        form.setValue(`items.${idx}.tier_id`, r.tier_id);
        form.setValue(`items.${idx}.original_resolved_rate`, r.rate);
        const qty = Number(it.quantity || 0);
        const disc = Number(it.discount_value || 0);
        form.setValue(`items.${idx}.line_total`, Math.max(0, qty * r.rate - disc));
        changedCount += 1;
      });
      if (changedCount > 0 || keptManual > 0) {
        const parts: string[] = [];
        if (changedCount > 0) parts.push(`Refreshed ${changedCount} line${changedCount === 1 ? "" : "s"}`);
        if (keptManual > 0) parts.push(`kept ${keptManual} manual-rate line${keptManual === 1 ? "" : "s"} unchanged`);
        toast.message(parts.join(", "));
      }
    })();
  }, [customerId, tierId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      preferred_shade_code: null,
      preferred_caliber: null,
      preferred_batch_no: null,
      notes: null,
      sort_order: fields.length,
      rate_source: resolved.source,
      tier_id: resolved.tier_id,
      original_resolved_rate: resolved.rate,
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
      preferred_shade_code: null,
      preferred_caliber: null,
      preferred_batch_no: null,
      notes: null,
      sort_order: fields.length,
      measurement_snapshot: null,
      rate_source: "default",
      tier_id: null,
    });
  };


  const handleAreaInsert = (payload: AreaCalculatorInsertPayload) => {
    const { product, final_boxes, snapshot } = payload;
    const roomLabel = snapshot.room_name ? `Room: ${snapshot.room_name}` : "Area Calculator";

    if (editingIdx != null) {
      // EDIT existing line — preserve user-edited rate/discount but refresh qty + snapshot
      const existing = watchedItems?.[editingIdx] as QuotationItemInput | undefined;
      const rate = Number(existing?.rate ?? product.default_sale_rate);
      const discount = Number(existing?.discount_value ?? 0);
      update(editingIdx, {
        ...(existing as QuotationItemInput),
        product_id: product.id,
        product_name_snapshot: product.name,
        product_sku_snapshot: product.sku,
        unit_type: "box_sft",
        per_box_sft: product.per_box_sft,
        quantity: final_boxes,
        rate,
        discount_value: discount,
        line_total: Math.max(0, final_boxes * rate - discount),
        notes: existing?.notes || roomLabel,
        measurement_snapshot: snapshot,
      });
      setEditingIdx(null);
      toast.success(`${snapshot.room_name || "Room"}: updated to ${final_boxes} boxes`);
      return;
    }

    append({
      product_id: product.id,
      product_name_snapshot: product.name,
      product_sku_snapshot: product.sku,
      unit_type: "box_sft",
      per_box_sft: product.per_box_sft,
      quantity: final_boxes,
      rate: product.default_sale_rate,
      discount_value: 0,
      line_total: final_boxes * product.default_sale_rate,
      preferred_shade_code: null,
      preferred_caliber: null,
      preferred_batch_no: null,
      notes: roomLabel,
      sort_order: fields.length,
      measurement_snapshot: snapshot,
    });
    toast.success(`${snapshot.room_name || "Room"}: ${final_boxes} boxes added`);
  };

  const openEditMeasurement = (idx: number) => {
    setEditingIdx(idx);
    setCalcOpen(true);
  };

  const saveDraftMutation = useMutation({
    mutationFn: async (data: QuotationFormInput) => {
      if (isEdit) {
        await quotationService.updateDraft(initialQuotation!.id, dealerId, data);
        return initialQuotation!.id;
      }
      const created = await quotationService.createDraft(dealerId, user?.id ?? null, data);
      return created.id;
    },
    onSuccess: (id) => {
      toast.success(isEdit ? "Quotation updated" : "Draft saved");
      navigate(`/quotations`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finalizeMutation = useMutation({
    mutationFn: async (data: QuotationFormInput) => {
      let id = initialQuotation?.id;
      if (isEdit) {
        await quotationService.updateDraft(initialQuotation!.id, dealerId, data);
      } else {
        const created = await quotationService.createDraft(dealerId, user?.id ?? null, data);
        id = created.id;
      }
      const finalized = await quotationService.finalize(id!, dealerId);
      return finalized;
    },
    onSuccess: () => {
      toast.success("Quote finalized");
      navigate(`/quotations`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onSaveDraft = form.handleSubmit((data) => saveDraftMutation.mutate(data));
  const onFinalize = form.handleSubmit((data) => finalizeMutation.mutate(data));

  const isSaving = saveDraftMutation.isPending || finalizeMutation.isPending;
  const isLockedForEdit =
    isEdit && initialQuotation && initialQuotation.status !== "draft";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/quotations")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-xl font-bold">{isEdit ? "Edit Quotation" : "New Quotation"}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onSaveDraft} disabled={isSaving || !!isLockedForEdit}>
            <Save className="h-4 w-4 mr-1" /> Save Draft
          </Button>
          <Button onClick={onFinalize} disabled={isSaving || !!isLockedForEdit}>
            <FileCheck className="h-4 w-4 mr-1" /> Finalize Quote
          </Button>
        </div>
      </div>

      {isLockedForEdit && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="text-sm py-3 text-foreground">
            This quotation is <strong>{initialQuotation?.status}</strong> and cannot be edited. Use "Revise" from the detail view to change it.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Customer</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Customer (optional)</Label>
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
            <Label>Quote Date</Label>
            <Input type="date" {...form.register("quote_date")} />
          </div>
          <div>
            <Label>Valid Until</Label>
            <Input type="date" {...form.register("valid_until")} />
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
              <Button type="button" variant="outline" size="sm" onClick={() => setCalcOpen(true)}>
                <Calculator className="h-4 w-4 mr-1" /> Area Calculator
              </Button>
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
                    const snap = (it as { measurement_snapshot?: { room_name?: string | null; final_boxes?: number; final_area_sft?: number } | null } | undefined)?.measurement_snapshot;
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
                          <Input {...form.register(`items.${idx}.notes`)} placeholder="Line note (optional)" className="text-xs" />
                          {snap && (
                            <button
                              type="button"
                              onClick={() => openEditMeasurement(idx)}
                              className="flex items-center gap-1 text-xs text-primary hover:underline"
                              title="Edit measurement"
                            >
                              <Ruler className="h-3 w-3" />
                              <span>
                                {snap.room_name || "Area"} · {Number(snap.final_area_sft ?? 0).toFixed(2)} sft → {snap.final_boxes} boxes
                              </span>
                              <span className="text-muted-foreground">(edit)</span>
                            </button>
                          )}
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
                              onChange: (e) => {
                                const cur = form.getValues(`items.${idx}.rate_source`);
                                const orig = form.getValues(`items.${idx}.original_resolved_rate`);
                                const newVal = Number((e.target as HTMLInputElement).value);
                                const baseline = orig ?? Number(form.getValues(`items.${idx}.rate`) ?? 0);
                                if (orig == null) {
                                  form.setValue(`items.${idx}.original_resolved_rate`, baseline);
                                }
                                if (cur !== "manual" && newVal !== baseline) {
                                  form.setValue(`items.${idx}.rate_source`, "manual");
                                }
                              },
                            })}
                          />
                          <div className="mt-1 flex items-center gap-1 justify-end">
                            <RateSourceBadge source={(it as { rate_source?: string })?.rate_source ?? "default"} />
                            {(it as { rate_source?: string; original_resolved_rate?: number | null })?.rate_source === "manual" &&
                              (it as { original_resolved_rate?: number | null })?.original_resolved_rate != null &&
                              Number((it as { original_resolved_rate?: number | null }).original_resolved_rate) !== Number(it.rate) && (
                                <span className="text-[10px] text-muted-foreground" title="Original resolved rate">
                                  was {formatCurrency(Number((it as { original_resolved_rate?: number | null }).original_resolved_rate))}
                                </span>
                              )}
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

      <AreaCalculatorDialog
        open={calcOpen}
        onOpenChange={(o) => {
          setCalcOpen(o);
          if (!o) setEditingIdx(null);
        }}
        onInsert={handleAreaInsert}
        initialSnapshot={
          editingIdx != null
            ? ((watchedItems?.[editingIdx] as { measurement_snapshot?: MeasurementSnapshot | null } | undefined)
                ?.measurement_snapshot ?? null)
            : null
        }
        initialProductId={
          editingIdx != null ? (watchedItems?.[editingIdx]?.product_id ?? null) : null
        }
      />
    </div>
  );
};

export default QuotationForm;
