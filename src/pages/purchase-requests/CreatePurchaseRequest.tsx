import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { productService } from "@/services/productService";
import { demandPlanningService } from "@/services/demandPlanningService";
import {
  purchaseRequestService,
  type PurchaseRequestItemInput,
} from "@/services/purchaseRequestService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Sparkles, Search, Trash2 } from "lucide-react";

const CreatePurchaseRequest = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<PurchaseRequestItemInput[]>([]);
  const [search, setSearch] = useState("");

  const { data: existing } = useQuery({
    queryKey: ["purchase-request", id, dealerId],
    queryFn: () => purchaseRequestService.getById(id!, dealerId),
    enabled: isEdit && !!id && !!dealerId,
  });

  const hasPrefilled = useRef(false);
  useEffect(() => {
    if (!existing || hasPrefilled.current) return;
    if (existing.status !== "draft") {
      toast.error("Only a draft purchase request can be edited.");
      navigate(`/purchase-requests/${existing.id}`);
      return;
    }
    hasPrefilled.current = true;
    setDepartment(existing.department ?? "");
    setNotes(existing.notes ?? "");
    setItems(
      existing.items.map((it) => ({
        product_id: it.product_id,
        product_name_snapshot: it.product_name_snapshot,
        requested_qty: it.requested_qty,
        source: it.source,
        notes: it.notes,
      })),
    );
  }, [existing]);

  const { data: searchResults = [] } = useQuery({
    queryKey: ["pr-product-search", dealerId, search],
    queryFn: async () => {
      const { data } = await productService.list(dealerId, search, 1, { active: true }, { column: "name", direction: "asc" }, 10);
      return data;
    },
    enabled: !!dealerId && search.trim().length > 1,
  });

  const loadSuggestionsMutation = useMutation({
    mutationFn: () => demandPlanningService.getDemandRows(dealerId),
    onSuccess: (rows) => {
      const actionable = rows.filter(
        (r) => r.suggested_reorder_qty > 0 && (r.flags.includes("reorder_suggested") || r.flags.includes("low_stock") || r.flags.includes("stockout_risk")),
      );
      if (actionable.length === 0) {
        toast.info("No reorder-suggested products right now.");
        return;
      }
      setItems((prev) => {
        const existingIds = new Set(prev.map((p) => p.product_id));
        const additions = actionable
          .filter((r) => !existingIds.has(r.product_id))
          .map((r) => ({
            product_id: r.product_id,
            product_name_snapshot: r.name,
            requested_qty: r.suggested_reorder_qty,
            source: "reorder_suggestion" as const,
            notes: null,
          }));
        return [...prev, ...additions];
      });
      toast.success(`Added ${actionable.length} suggested item(s) from Purchase Planning.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addProduct = (p: { id: string; name: string }) => {
    if (items.some((it) => it.product_id === p.id)) {
      toast.info("Already added.");
      return;
    }
    setItems((prev) => [...prev, { product_id: p.id, product_name_snapshot: p.name, requested_qty: 1, source: "manual" }]);
    setSearch("");
  };

  const updateQty = (idx: number, qty: number) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, requested_qty: qty } : it)));
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("Add at least one item.");
      const form = { department, notes, items };
      if (isEdit) {
        return purchaseRequestService.update(id!, dealerId, form);
      }
      return purchaseRequestService.create(dealerId, form);
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
      toast.success(isEdit ? "Purchase request updated" : "Purchase request saved as draft");
      navigate(`/purchase-requests/${row.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? "Edit Purchase Request" : "New Purchase Request"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Department</label>
              <Input placeholder="Sales, Production, Store…" value={department} onChange={(e) => setDepartment(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Notes</label>
            <Textarea rows={2} placeholder="Reason for this request…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Items</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadSuggestionsMutation.mutate()}
            disabled={loadSuggestionsMutation.isPending}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {loadSuggestionsMutation.isPending ? "Loading…" : "Load Reorder Suggestions"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search a product to add…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
            {search.trim().length > 1 && searchResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                {searchResults.map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                    onClick={() => addProduct(p)}
                  >
                    {p.name} <span className="text-muted-foreground">({p.sku})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No items added yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-32">Qty</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{it.product_name_snapshot}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {it.source === "reorder_suggestion" ? "Reorder suggestion" : "Manual"}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={it.requested_qty}
                        onChange={(e) => updateQty(idx, Number(e.target.value))}
                      />
                    </TableCell>
                    <TableCell>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Save as Draft"}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate("/purchase-requests")}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default CreatePurchaseRequest;
