import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { usePermissions } from "@/hooks/usePermissions";
import { purchaseRequestService } from "@/services/purchaseRequestService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Send, Check, X, Ban, Trash2 } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const PurchaseRequestDetail = () => {
  const { id } = useParams<{ id: string }>();
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const canApprove = (permissions.isDealerAdmin || permissions.isSuperAdmin) && permissions.canMutate;
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const { data: pr, isLoading } = useQuery({
    queryKey: ["purchase-request", id, dealerId],
    queryFn: () => purchaseRequestService.getById(id!, dealerId),
    enabled: !!id && !!dealerId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-request", id, dealerId] });
    queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
  };

  const submitMutation = useMutation({
    mutationFn: () => purchaseRequestService.submit(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Submitted for approval"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: () => purchaseRequestService.approve(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Purchase request approved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: () => purchaseRequestService.reject(id!, dealerId, rejectReason),
    onSuccess: () => { invalidate(); setRejectOpen(false); setRejectReason(""); toast.success("Purchase request rejected"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => purchaseRequestService.cancel(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Purchase request cancelled"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => purchaseRequestService.remove(id!, dealerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
      toast.success("Draft deleted");
      navigate("/purchase-requests");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!pr) {
    navigate("/purchase-requests");
    return null;
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{pr.pr_number ?? "Draft Purchase Request"}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{pr.department || "No department specified"}</p>
          </div>
          <Badge variant={pr.status === "approved" ? "default" : pr.status === "rejected" ? "destructive" : "secondary"}>
            {STATUS_LABEL[pr.status]}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {pr.notes && <p className="text-sm text-muted-foreground">{pr.notes}</p>}
          {pr.status === "rejected" && pr.rejection_reason && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <span className="font-medium">Rejection reason: </span>{pr.rejection_reason}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Requested Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pr.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{it.product_name_snapshot}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {it.source === "reorder_suggestion" ? "Reorder suggestion" : "Manual"}
                  </TableCell>
                  <TableCell className="text-right">{it.requested_qty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-wrap gap-2 pt-2">
            {pr.status === "draft" && (
              <>
                <Button variant="outline" onClick={() => navigate(`/purchase-requests/${pr.id}/edit`)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </Button>
                <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
                  <Send className="mr-2 h-4 w-4" /> Submit for Approval
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => { if (confirm("Delete this draft?")) deleteMutation.mutate(); }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </>
            )}
            {pr.status === "pending_approval" && (
              <>
                {canApprove ? (
                  <>
                    <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                      <Check className="mr-2 h-4 w-4" /> Approve
                    </Button>
                    <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                      <X className="mr-2 h-4 w-4" /> Reject
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Awaiting dealer admin approval.</p>
                )}
                <Button variant="outline" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                  <Ban className="mr-2 h-4 w-4" /> Cancel
                </Button>
              </>
            )}
            {pr.status === "approved" && (
              <Button onClick={() => navigate(`/rfqs/new?fromPurchaseRequest=${pr.id}`)}>
                <Send className="mr-2 h-4 w-4" /> Create RFQ from this Request
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Purchase Request</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejection…"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectMutation.isPending}
              onClick={() => rejectMutation.mutate()}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PurchaseRequestDetail;
