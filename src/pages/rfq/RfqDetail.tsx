import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { rfqService } from "@/services/rfqService";
import { supplierService } from "@/services/supplierService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Send, Ban, X, CheckCircle2 } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  comparing: "Comparing",
  approved: "Approved",
  cancelled: "Cancelled",
};

const RfqDetail = () => {
  const { id } = useParams<{ id: string }>();
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [supplierSearch, setSupplierSearch] = useState("");
  const [responseDraft, setResponseDraft] = useState<Record<string, { rate: string; leadDays: string }>>({});
  const [selections, setSelections] = useState<Record<string, string>>({});

  const { data: rfq, isLoading } = useQuery({
    queryKey: ["rfq", id, dealerId],
    queryFn: () => rfqService.getById(id!, dealerId),
    enabled: !!id && !!dealerId,
  });

  const { data: comparison } = useQuery({
    queryKey: ["rfq-comparison", id, dealerId],
    queryFn: () => rfqService.getComparison(id!, dealerId),
    enabled: !!id && !!dealerId && !!rfq && rfq.status !== "draft",
  });

  const { data: supplierResults = [] } = useQuery({
    queryKey: ["rfq-supplier-search", dealerId, supplierSearch],
    queryFn: async () => {
      const { data } = await supplierService.list(dealerId, supplierSearch, 1);
      return data;
    },
    enabled: !!dealerId && supplierSearch.trim().length > 1,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["rfq", id, dealerId] });
    queryClient.invalidateQueries({ queryKey: ["rfq-comparison", id, dealerId] });
    queryClient.invalidateQueries({ queryKey: ["rfqs"] });
  };

  const inviteMutation = useMutation({
    mutationFn: (supplierId: string) => rfqService.inviteSuppliers(id!, dealerId, [supplierId]),
    onSuccess: () => { invalidate(); setSupplierSearch(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeSupplierMutation = useMutation({
    mutationFn: (supplierId: string) => rfqService.removeSupplier(id!, dealerId, supplierId),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: () => rfqService.send(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("RFQ sent"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const recordResponseMutation = useMutation({
    mutationFn: (input: { supplier_id: string; rfq_item_id: string; quoted_rate: number; quoted_lead_time_days: number | null }) =>
      rfqService.recordResponse(id!, dealerId, input),
    onSuccess: () => { invalidate(); toast.success("Quote recorded"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: () => {
      const sel = Object.entries(selections).map(([rfq_item_id, supplier_id]) => ({ rfq_item_id, supplier_id }));
      return rfqService.approve(id!, dealerId, sel);
    },
    onSuccess: () => { invalidate(); toast.success("RFQ approved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => rfqService.cancel(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("RFQ cancelled"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!rfq) {
    navigate("/rfqs");
    return null;
  }

  const draftKey = (supplierId: string, itemId: string) => `${itemId}:${supplierId}`;

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{rfq.rfq_number ?? "Draft RFQ"}</CardTitle>
            {rfq.notes && <p className="text-sm text-muted-foreground mt-1">{rfq.notes}</p>}
          </div>
          <Badge variant={rfq.status === "approved" ? "default" : rfq.status === "cancelled" ? "outline" : "secondary"}>
            {STATUS_LABEL[rfq.status]}
          </Badge>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Selected Supplier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfq.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{it.product_name_snapshot}</TableCell>
                  <TableCell className="text-right">{it.qty}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{it.selected_supplier_name ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invited Suppliers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rfq.status === "draft" && (
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search a supplier to invite…"
                value={supplierSearch}
                onChange={(e) => setSupplierSearch(e.target.value)}
                className="pl-9"
              />
              {supplierSearch.trim().length > 1 && supplierResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                  {supplierResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                      onClick={() => inviteMutation.mutate(s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {rfq.suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No suppliers invited yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {rfq.suppliers.map((s) => (
                <li key={s.id} className="flex items-center gap-1 rounded-full border px-3 py-1 text-sm">
                  {s.supplier_name}
                  <Badge variant="outline" className="ml-1 text-[10px]">{s.status}</Badge>
                  {rfq.status === "draft" && (
                    <button onClick={() => removeSupplierMutation.mutate(s.supplier_id)} className="ml-1 text-muted-foreground hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2 pt-2">
            {rfq.status === "draft" && (
              <>
                <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending || rfq.suppliers.length === 0}>
                  <Send className="mr-2 h-4 w-4" /> Send RFQ
                </Button>
                <Button variant="outline" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                  <Ban className="mr-2 h-4 w-4" /> Cancel
                </Button>
              </>
            )}
            {(rfq.status === "sent" || rfq.status === "comparing") && (
              <Button variant="outline" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                <Ban className="mr-2 h-4 w-4" /> Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {(rfq.status === "sent" || rfq.status === "comparing") && comparison && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record Supplier Quotes & Compare</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    {comparison.suppliers.map((s) => (
                      <TableHead key={s.supplier_id}>{s.supplier_name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.items.map((item) => (
                    <TableRow key={item.rfq_item_id}>
                      <TableCell>{item.product_name_snapshot}</TableCell>
                      <TableCell className="text-right">{item.qty}</TableCell>
                      {item.quotes.map((q) => {
                        const key = draftKey(q.supplier_id, item.rfq_item_id);
                        const draft = responseDraft[key] ?? { rate: q.quoted_rate?.toString() ?? "", leadDays: q.quoted_lead_time_days?.toString() ?? "" };
                        return (
                          <TableCell key={q.supplier_id}>
                            <div className="flex flex-col gap-1 min-w-[110px]">
                              <Input
                                type="number"
                                placeholder="Rate"
                                value={draft.rate}
                                onChange={(e) => setResponseDraft((prev) => ({ ...prev, [key]: { ...draft, rate: e.target.value } }))}
                              />
                              <Input
                                type="number"
                                placeholder="Lead days"
                                value={draft.leadDays}
                                onChange={(e) => setResponseDraft((prev) => ({ ...prev, [key]: { ...draft, leadDays: e.target.value } }))}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!draft.rate || recordResponseMutation.isPending}
                                onClick={() =>
                                  recordResponseMutation.mutate({
                                    supplier_id: q.supplier_id,
                                    rfq_item_id: item.rfq_item_id,
                                    quoted_rate: Number(draft.rate),
                                    quoted_lead_time_days: draft.leadDays ? Number(draft.leadDays) : null,
                                  })
                                }
                              >
                                Save Quote
                              </Button>
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium">Select winning supplier per line to approve:</p>
              {comparison.items.map((item) => {
                const quotedSuppliers = item.quotes.filter((q) => q.quoted_rate !== null);
                return (
                  <div key={item.rfq_item_id} className="flex items-center gap-3">
                    <span className="w-48 text-sm truncate">{item.product_name_snapshot}</span>
                    <Select
                      value={selections[item.rfq_item_id] ?? item.selected_supplier_id ?? undefined}
                      onValueChange={(v) => setSelections((prev) => ({ ...prev, [item.rfq_item_id]: v }))}
                      disabled={quotedSuppliers.length === 0}
                    >
                      <SelectTrigger className="w-64">
                        <SelectValue placeholder="Choose supplier…" />
                      </SelectTrigger>
                      <SelectContent>
                        {quotedSuppliers.map((q) => (
                          <SelectItem key={q.supplier_id} value={q.supplier_id}>
                            {q.supplier_name} — {q.quoted_rate}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || Object.keys(selections).length === 0}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> Approve RFQ
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default RfqDetail;
