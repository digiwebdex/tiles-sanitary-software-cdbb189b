import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supplierService, type Supplier } from "@/services/supplierService";
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

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  name:            z.string().min(1, "Supplier name is required").max(100),
  contact_person:  z.string().max(100).default(""),
  phone:           z.string().max(20).default(""),
  email:           z.string().email("Invalid email").or(z.literal("")).default(""),
  address:         z.string().max(250).default(""),
  gstin:           z.string().max(20).default(""),
  opening_balance: z.coerce.number().min(0, "Opening balance cannot be negative").default(0),
  status:          z.enum(["active", "inactive"]).default("active"),
});

type FormValues = z.infer<typeof schema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface SupplierFormProps {
  /** If provided, the form operates in edit mode. */
  supplier?: Supplier;
}

// ─── Component ────────────────────────────────────────────────────────────────

const SupplierForm = ({ supplier }: SupplierFormProps) => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!supplier;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:            supplier?.name ?? "",
      contact_person:  supplier?.contact_person ?? "",
      phone:           supplier?.phone ?? "",
      email:           supplier?.email ?? "",
      address:         supplier?.address ?? "",
      gstin:           supplier?.gstin ?? "",
      opening_balance: supplier?.opening_balance ?? 0,
      status:          (supplier?.status as "active" | "inactive") ?? "active",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (isEdit) {
        await supplierService.update(supplier!.id, {
          name: values.name,
          contact_person: values.contact_person,
          phone: values.phone,
          email: values.email,
          address: values.address,
          gstin: values.gstin,
          status: values.status,
        });
      } else {
        await supplierService.create(dealerId, {
          name: values.name,
          contact_person: values.contact_person,
          phone: values.phone,
          email: values.email,
          address: values.address,
          gstin: values.gstin,
          opening_balance: values.opening_balance,
          status: values.status,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success(isEdit ? "Supplier updated" : "Supplier created");
      navigate("/suppliers");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-5">
        {/* Row 1: Name + Contact person */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Supplier Name <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Input placeholder="ABC Tiles Ltd." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contact_person"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact Person</FormLabel>
                <FormControl>
                  <Input placeholder="John Doe" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Row 2: Phone + Email */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input placeholder="+880 1700-000000" {...field} />
                </FormControl>
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
                <FormControl>
                  <Input type="email" placeholder="supplier@example.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Row 3: Address */}
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Textarea placeholder="Street, City, Country" rows={2} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Row 4: GSTIN + Opening balance + Status */}
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="gstin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>BIN / TIN (VAT)</FormLabel>
                <FormControl>
                  <Input placeholder="Supplier BIN or TIN" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
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

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : isEdit ? "Update Supplier" : "Create Supplier"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/suppliers")}>
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default SupplierForm;
