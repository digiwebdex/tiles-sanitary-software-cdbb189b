import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import {
  postingTraceService,
  type TraceLineDomain,
} from "@/services/postingTraceService";
import { ExternalLink, Loader2 } from "lucide-react";

export interface PostingTraceTarget {
  lineDomain: TraceLineDomain;
  partyId: string;
  partyName: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealerId: string;
  target: PostingTraceTarget | null;
}

function formatLineType(type: string): string {
  return type.replace(/_/g, " ");
}

function lineDescription(metadata: Record<string, unknown>): string | null {
  const desc = metadata.description;
  return typeof desc === "string" && desc.trim() ? desc : null;
}

export function PostingTraceDialog({ open, onOpenChange, dealerId, target }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["posting-trace", dealerId, target?.lineDomain, target?.partyId],
    queryFn: () =>
      postingTraceService.traceParty(dealerId, target!.lineDomain, target!.partyId, { limit: 100 }),
    enabled: open && !!dealerId && !!target,
  });

  const partyLabel = target?.partyName ?? data?.partyName ?? "Party";
  const domainLabel = target?.lineDomain === "customer" ? "Customer" : "Supplier";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Posting trace — {partyLabel}</DialogTitle>
          <DialogDescription>
            {domainLabel} balance movements from posting batches or legacy ledger.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading trace…
          </div>
        ) : error ? (
          <p className="text-destructive text-sm py-6">{(error as Error).message}</p>
        ) : !data || data.batches.length === 0 ? (
          <p className="text-muted-foreground text-sm py-6 text-center">No posting entries found.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={data.source === "posting_engine" ? "default" : "secondary"}>
                {data.source === "posting_engine" ? "Posting engine" : "Legacy ledger"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Net in view: {formatCurrency(data.runningBalance)}
              </span>
            </div>

            {data.batches.map((batch) => (
              <div key={batch.batchId} className="rounded-md border overflow-hidden">
                {data.source === "posting_engine" && (
                  <div className="bg-muted/40 px-3 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium capitalize">{batch.documentType}</span>
                    {batch.invoiceRef && (
                      <span className="font-mono text-xs">{batch.invoiceRef}</span>
                    )}
                    <Badge variant="outline" className="text-xs capitalize">
                      {batch.eventType.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {String(batch.postedAt).slice(0, 10)}
                    </span>
                    {batch.reversesBatchId && (
                      <span className="text-xs text-amber-600">Reverses prior batch</span>
                    )}
                  </div>
                )}
                {batch.notes && data.source === "legacy_ledger" && (
                  <p className="px-3 py-2 text-xs text-muted-foreground border-b">{batch.notes}</p>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batch.lines.map((line) => {
                      const desc = lineDescription(line.metadata);
                      return (
                        <TableRow key={line.id}>
                          <TableCell className="whitespace-nowrap">{line.entryDate}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">
                              {formatLineType(line.lineType)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {line.saleId ? (
                              <Link
                                to={`/sales/${line.saleId}/invoice`}
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                Sale
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            ) : line.purchaseId ? (
                              <Link
                                to={`/purchases/${line.purchaseId}`}
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                Purchase
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            ) : desc ? (
                              <span className="text-muted-foreground">{desc}</span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${
                              line.amount < 0 ? "text-destructive" : "text-foreground"
                            }`}
                          >
                            {formatCurrency(line.amount)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {data.source === "posting_engine" && batch.lines.length > 1 && (
                      <TableRow className="bg-muted/30 font-medium">
                        <TableCell colSpan={3} className="text-right">
                          Batch total
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(batch.lineTotal)}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
