import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageCircle, RotateCcw } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import { useDealerId } from "@/hooks/useDealerId";
import {
  whatsappService,
  DEFAULT_WHATSAPP_SETTINGS,
  buildQuotationMessage,
  buildInvoiceMessage,
  buildPaymentReceiptMessage,
  buildOverdueReminderMessage,
  buildDeliveryUpdateMessage,
  buildPurchaseOrderMessage,
  type WhatsAppSettings,
  type WhatsAppMessageType,
} from "@/services/whatsappService";

const TYPE_META: {
  type: WhatsAppMessageType;
  label: string;
  enableKey: keyof WhatsAppSettings;
  templateKey: keyof WhatsAppSettings;
  defaultPreview: () => string;
  hint: string;
}[] = [
  {
    type: "quotation_share",
    label: "Quotation Share",
    enableKey: "enable_quotation_share",
    templateKey: "template_quotation_share",
    hint: "Used when sharing a quotation PDF link/text via WhatsApp.",
    defaultPreview: () =>
      buildQuotationMessage({
        dealerName: "Your Business",
        customerName: "Mr. Karim",
        quotationNo: "QT-00123",
        totalAmount: 12500,
        validUntil: "31 Dec 2025",
        itemCount: 4,
      }),
  },
  {
    type: "invoice_share",
    label: "Invoice Share",
    enableKey: "enable_invoice_share",
    templateKey: "template_invoice_share",
    hint: "Used when sharing a sale invoice via WhatsApp.",
    defaultPreview: () =>
      buildInvoiceMessage({
        dealerName: "Your Business",
        customerName: "Mr. Karim",
        invoiceNo: "INV-00541",
        totalAmount: 12500,
        paidAmount: 5000,
        dueAmount: 7500,
        saleDate: "12 Apr 2026",
      }),
  },
  {
    type: "payment_receipt",
    label: "Payment Receipt",
    enableKey: "enable_payment_receipt",
    templateKey: "template_payment_receipt",
    hint: "Used after recording a customer payment in Collections.",
    defaultPreview: () =>
      buildPaymentReceiptMessage({
        dealerName: "Your Business",
        customerName: "Mr. Karim",
        receiptNo: "RCP-1ABZ",
        amount: 5000,
        remainingDue: 2500,
        date: "12 Apr 2026",
      }),
  },
  {
    type: "overdue_reminder",
    label: "Overdue Reminder",
    enableKey: "enable_overdue_reminder",
    templateKey: "template_overdue_reminder",
    hint: "Used to nudge customers with overdue balances from the Collections page.",
    defaultPreview: () =>
      buildOverdueReminderMessage({
        dealerName: "Your Business",
        dealerPhone: "01XXXXXXXXX",
        customerName: "Mr. Karim",
        outstanding: 7500,
        daysOverdue: 45,
        oldestInvoiceDate: "26 Feb 2026",
      }),
  },
  {
    type: "delivery_update",
    label: "Delivery Update",
    enableKey: "enable_delivery_update",
    templateKey: "template_delivery_update",
    hint: "Used to notify customers about delivery status changes.",
    defaultPreview: () =>
      buildDeliveryUpdateMessage({
        dealerName: "Your Business",
        customerName: "Mr. Karim",
        deliveryNo: "DL-00012",
        status: "In Transit",
        itemCount: 3,
        deliveryDate: "13 Apr 2026",
        invoiceNo: "INV-00541",
        receiverName: "Site Engineer",
      }),
  },
  {
    type: "purchase_order_share",
    label: "Purchase Order Share",
    enableKey: "enable_purchase_order_share",
    templateKey: "template_purchase_order_share",
    hint: "Used when sharing a purchase order with a supplier via WhatsApp.",
    defaultPreview: () =>
      buildPurchaseOrderMessage({
        dealerName: "Your Business",
        supplierName: "ABC Tiles Ltd.",
        poNumber: "PO-00045",
        totalAmount: 85000,
        itemCount: 6,
        expectedDeliveryDate: "20 Apr 2026",
      }),
  },
];

const WhatsAppSettingsCard = () => {
  const dealerId = useDealerId();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<WhatsAppSettings | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["whatsapp-settings", dealerId],
    queryFn: () => whatsappService.getSettings(dealerId),
    enabled: !!dealerId,
  });

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (next: WhatsAppSettings) => whatsappService.upsertSettings(next),
    onSuccess: () => {
      toast.success("WhatsApp settings saved");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-settings"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const dirty = useMemo(() => {
    if (!data || !draft) return false;
    return JSON.stringify(data) !== JSON.stringify(draft);
  }, [data, draft]);

  const setField = <K extends keyof WhatsAppSettings>(k: K, v: WhatsAppSettings[K]) => {
    setDraft((cur) => (cur ? { ...cur, [k]: v } : cur));
  };

  if (isLoading || !draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="h-4 w-4" /> WhatsApp Automation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" /> WhatsApp Automation
        </CardTitle>
        <CardDescription>
          Toggle which transactional messages are available, and customize the templates used in the
          send dialog. Currently uses Click-to-Chat (wa.me) — your WhatsApp opens with the message
          pre-filled and you tap Send.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* General */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="wa-country">Default Country Code</Label>
            <Input
              id="wa-country"
              value={draft.default_country_code}
              onChange={(e) => setField("default_country_code", e.target.value.replace(/\D/g, ""))}
              placeholder="880"
              className="max-w-[140px]"
            />
            <p className="text-xs text-muted-foreground">
              Used to normalize local phone numbers (e.g. <code>01…</code> → <code>880…</code>).
            </p>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="wa-manual" className="text-sm">Prefer Manual Send</Label>
              <p className="text-xs text-muted-foreground">
                Always open WhatsApp for the user to confirm. Recommended.
              </p>
            </div>
            <Switch
              id="wa-manual"
              checked={draft.prefer_manual_send}
              onCheckedChange={(v) => setField("prefer_manual_send", v)}
            />
          </div>
        </div>

        <Separator />

        {/* Per-type toggles + templates */}
        <div className="space-y-5">
          {TYPE_META.map((m) => {
            const enabled = Boolean(draft[m.enableKey]);
            const tpl = (draft[m.templateKey] as string | null) ?? "";
            return (
              <div key={m.type} className="rounded-md border p-3 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold">{m.label}</p>
                    <p className="text-xs text-muted-foreground">{m.hint}</p>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) =>
                      setField(m.enableKey, v as WhatsAppSettings[typeof m.enableKey])
                    }
                  />
                </div>

                {enabled && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`tpl-${m.type}`} className="text-xs">
                        Template (leave empty to use built-in default)
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() =>
                          setField(
                            m.templateKey,
                            m.defaultPreview() as WhatsAppSettings[typeof m.templateKey],
                          )
                        }
                      >
                        <RotateCcw className="mr-1 h-3 w-3" /> Load default
                      </Button>
                    </div>
                    <Textarea
                      id={`tpl-${m.type}`}
                      value={tpl}
                      onChange={(e) =>
                        setField(
                          m.templateKey,
                          e.target.value as WhatsAppSettings[typeof m.templateKey],
                        )
                      }
                      rows={5}
                      placeholder={m.defaultPreview()}
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      Templates are reference text. The send dialog still pre-fills with live
                      transaction data; you can edit per send.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => data && setDraft(data)}
          >
            Reset
          </Button>
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => draft && save.mutate(draft)}
          >
            {save.isPending ? "Saving…" : "Save WhatsApp Settings"}
          </Button>
          <Button
            variant="outline"
            disabled={save.isPending}
            onClick={() => {
              const reset = DEFAULT_WHATSAPP_SETTINGS(dealerId);
              setDraft(reset);
            }}
          >
            Restore Defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default WhatsAppSettingsCard;
