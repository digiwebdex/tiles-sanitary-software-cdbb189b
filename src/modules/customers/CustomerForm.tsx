import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { customerService, type Customer } from "@/services/customerService";
import { pricingTierService } from "@/services/pricingTierService";
import { useDealerId } from "@/hooks/useDealerId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

const NO_TIER = "__none";

const schema = z.object({
  name:             z.string().min(1, "Customer name is required").max(100),
  type:             z.enum(["retailer", "customer", "project"]),
  phone:            z.string().max(20).default(""),
  email:            z.string().email("Invalid email").or(z.literal("")).default(""),
  address:          z.string().max(250).default(""),
  reference_name:   z.string().max(100).default(""),
  opening_balance:  z.coerce.number().min(0, "Opening balance cannot be negative").default(0),
  status:           z.enum(["active", "inactive"]).default("active"),
  credit_limit:     z.coerce.number().min(0, "Credit limit cannot be negative").default(0),
  max_overdue_days: z.coerce.number().int().min(0, "Must be 0 or more").default(0),
  price_tier_id:    z.string().nullable().default(null),
  tax_id:           z.string().max(50).default(""),
});

type FormValues = z.infer<typeof schema>;

interface CustomerFormProps {
  customer?: Customer;
}

const CustomerForm = ({ customer }: CustomerFormProps) => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!customer;

  const { data: tiers = [] } = useQuery({
    queryKey: ["price-tiers", dealerId],
    queryFn: () => pricingTierService.listTiers(dealerId),
    enabled: !!dealerId,
  });
  const activeTiers = tiers.filter((t) => t.status === "active" || t.id === customer?.price_tier_id);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:            customer?.name ?? "",
      type:            (customer?.type as FormValues["type"]) ?? "customer",
      phone:           customer?.phone ?? "",
      email:           customer?.email ?? "",
      address:         customer?.address ?? "",
      reference_name:  customer?.reference_name ?? "",
      opening_balance: customer?.opening_balance ?? 0,
      status:          (customer?.status as "active" | "inactive") ?? "active",
      credit_limit:    customer?.credit_limit ?? 0,
      max_overdue_days: customer?.max_overdue_days ?? 0,
      price_tier_id:   customer?.price_tier_id ?? null,
      tax_id:          customer?.tax_id ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        name: values.name,
        type: values.type,
        phone: values.phone,
        email: values.email,
        address: values.address,
        reference_name: values.reference_name,
        opening_balance: values.opening_balance,
        status: values.status,
        credit_limit: values.credit_limit,
        max_overdue_days: values.max_overdue_days,
        price_tier_id: values.price_tier_id,
        tax_id: values.tax_id,
      };
      if (isEdit) {
        await customerService.update(customer!.id, payload);
      } else {
        await customerService.create(dealerId, payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success(isEdit ? "Customer updated" : "Customer created");
      navigate("/customers");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Customer Name <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input placeholder="Customer name" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Customer Type <span className="text-destructive">*</span></FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="retailer">Retailer</SelectItem>
                    <SelectItem value="customer">Regular</SelectItem>
                    <SelectItem value="project">Project</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl><Input placeholder="+880 1700-000000" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" placeholder="customer@example.com" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="reference_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reference Name</FormLabel>
              <FormControl><Input placeholder="Who referred this customer?" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="tax_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>BIN / TIN (VAT)</FormLabel>
              <FormControl><Input placeholder="Customer tax ID for Mushak" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl><Textarea placeholder="Street, City, Country" rows={2} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="opening_balance"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Opening Balance (৳)
                  {isEdit && (
                    <span className="ml-1 text-xs text-muted-foreground">(read-only after create)</span>
                  )}
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    {...field}
                    readOnly={isEdit}
                    className={isEdit ? "bg-muted cursor-not-allowed" : ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">Pricing Tier</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Auto-fills product rates in quotations and sales for this customer. Leave empty to use default rates.
          </p>
          <FormField
            control={form.control}
            name="price_tier_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Assigned Tier</FormLabel>
                <Select
                  value={field.value ?? NO_TIER}
                  onValueChange={(v) => field.onChange(v === NO_TIER ? null : v)}
                >
                  <FormControl><SelectTrigger><SelectValue placeholder="No tier (use default rates)" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={NO_TIER}>No tier (default rates)</SelectItem>
                    {activeTiers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}{t.status === "inactive" ? " (inactive)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">Credit Control</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Set 0 to disable credit limit or overdue enforcement.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="credit_limit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Credit Limit (৳)</FormLabel>
                  <FormControl><Input type="number" min={0} step="0.01" placeholder="0 = no limit" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="max_overdue_days"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Overdue Days</FormLabel>
                  <FormControl><Input type="number" min={0} step="1" placeholder="0 = no restriction" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : isEdit ? "Update Customer" : "Create Customer"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/customers")}>
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default CustomerForm;
