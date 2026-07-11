import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDealerId } from "@/hooks/useDealerId";
import { bankAccountService } from "@/services/bankAccountService";
import { chequeRegisterService, type ChequeStatus } from "@/services/chequeRegisterService";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, MoreVertical, FileText } from "lucide-react";

const STATUS_BADGE: Record<ChequeStatus, string> = {
  issued: "bg-muted text-muted-foreground",
  presented: "bg-blue-100 text-blue-700",
  cleared: "bg-green-100 text-green-700",
  bounced: "bg-red-100 text-red-700",
  cancelled: "bg-gray-200 text-gray-500",
};

const NEXT_STATUSES: Record<ChequeStatus, ChequeStatus[]> = {
  issued: ["presented", "cleared", "bounced", "cancelled"],
  presented: ["cleared", "bounced"],
  cleared: [],
  bounced: ["issued"],
  cancelled: [],
};

const ChequeRegisterPage = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [bankAccountId, setBankAccountId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");

  const { data: banks = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["cheque-register", dealerId, bankAccountId, status],
    queryFn: () => chequeRegisterService.list(dealerId, {
      bankAccountId: bankAccountId === "all" ? undefined : bankAccountId,
      status: status === "all" ? undefined : (status as ChequeStatus),
    }),
    enabled: !!dealerId,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: ChequeStatus }) => chequeRegisterService.updateStatus(dealerId, id, next),
    onSuccess: () => {
      toast.success("Cheque status updated");
      qc.invalidateQueries({ queryKey: ["cheque-register"] });
      qc.invalidateQueries({ queryKey: ["bank-ledger"] });
      qc.invalidateQueries({ queryKey: ["bank-accounts"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to update status"),
  });

  const rows = data?.rows ?? [];

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/bank-accounts")}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6" /> Cheque Register</h1>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger><SelectValue placeholder="All bank accounts" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All bank accounts</SelectItem>
                {banks.map(b => <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="issued">Issued</SelectItem>
                <SelectItem value="presented">Presented</SelectItem>
                <SelectItem value="cleared">Cleared</SelectItem>
                <SelectItem value="bounced">Bounced</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cheques ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p>Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Cheque No.</TableHead>
                  <TableHead>Bank Account</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{new Date(c.entry_date).toLocaleDateString()}</TableCell>
                    <TableCell className="font-mono">{c.cheque_no}</TableCell>
                    <TableCell>{c.bank_name} — {c.account_number}</TableCell>
                    <TableCell>{c.description || "—"}</TableCell>
                    <TableCell><Badge variant="secondary" className={STATUS_BADGE[c.cheque_status]}>{c.cheque_status}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(Math.abs(c.amount))}</TableCell>
                    <TableCell>
                      {NEXT_STATUSES[c.cheque_status].length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {NEXT_STATUSES[c.cheque_status].map((next) => (
                              <DropdownMenuItem key={next} onClick={() => updateStatus.mutate({ id: c.id, next })}>
                                Mark as {next}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No cheques found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ChequeRegisterPage;
