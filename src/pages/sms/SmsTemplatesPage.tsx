import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, Pencil, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { smsCampaignService } from "@/services/smsCampaignService";
import {
  mergeTemplatesWithOverrides, renderSmsTemplate, estimateSmsSegments,
  SMS_PLACEHOLDER_HINTS, type ResolvedSmsTemplate,
} from "@/lib/smsTemplates";

const SAMPLE_VARS = {
  shop: "মেসার্স সেনিটারি টাইলস",
  name: "মোঃ রহিম",
  phone: "01700000000",
  invoice: "INV-1024",
  total: "12,500",
  paid: "10,000",
  due: "2,500",
  amount: "2,500",
  date: "০১/০৮/২০২৬",
};

export default function SmsTemplatesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ResolvedSmsTemplate | null>(null);
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const [enabled, setEnabled] = useState(true);

  const { data: overrides = [], isLoading } = useQuery({
    queryKey: ["sms-templates"],
    queryFn: () => smsCampaignService.listTemplates(),
  });
  const templates = mergeTemplatesWithOverrides(overrides);

  const saveMut = useMutation({
    mutationFn: () =>
      smsCampaignService.saveTemplate(editing!.key, {
        label: label.trim() || undefined,
        body: body.trim(),
        is_enabled: enabled,
      }),
    onSuccess: () => {
      toast.success("টেমপ্লেট সংরক্ষিত হয়েছে (Template saved)");
      qc.invalidateQueries({ queryKey: ["sms-templates"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: (key: string) => smsCampaignService.resetTemplate(key),
    onSuccess: () => {
      toast.success("ডিফল্টে ফিরে গেছে (Reset to default)");
      qc.invalidateQueries({ queryKey: ["sms-templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEditor = (tpl: ResolvedSmsTemplate) => {
    setEditing(tpl);
    setLabel(tpl.label);
    setBody(tpl.body);
    setEnabled(tpl.isEnabled);
  };

  const insertPlaceholder = (ph: string) => setBody((b) => `${b}{${ph}}`);
  const preview = renderSmsTemplate(body, SAMPLE_VARS);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <MessageSquareText className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">SMS Templates <span className="text-muted-foreground font-normal">(এসএমএস টেমপ্লেট)</span></h1>
          <p className="text-sm text-muted-foreground">
            ইভেন্ট অনুযায়ী বার্তা সাজান — প্লেসহোল্ডার যেমন {"{name}"}, {"{due}"} নিজে থেকে বসে যাবে
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((tpl) => (
            <Card key={tpl.key} className={!tpl.isEnabled ? "opacity-60" : undefined}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>
                    {tpl.label}
                    <span className="block text-xs font-normal text-muted-foreground">{tpl.labelBn}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    {tpl.isCustomised && <Badge variant="outline" className="text-[10px]">Customised</Badge>}
                    {!tpl.isEnabled && <Badge variant="destructive" className="text-[10px]">Off</Badge>}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="min-h-10 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">
                  {tpl.body || <span className="text-muted-foreground">— খালি (empty) —</span>}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEditor(tpl)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                  </Button>
                  {tpl.isCustomised && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => resetMut.mutate(tpl.key)}
                      disabled={resetMut.isPending}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing?.label} <span className="text-muted-foreground text-sm">({editing?.labelBn})</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div>
              <Label>Message Body (বার্তা)</Label>
              <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">
                {body.length} chars • {estimateSmsSegments(body)} segment(s)
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {(editing?.placeholders ?? []).map((ph) => (
                <Button
                  key={ph}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  title={SMS_PLACEHOLDER_HINTS[ph]}
                  onClick={() => insertPlaceholder(ph)}
                >
                  {"{"}{ph}{"}"}
                </Button>
              ))}
            </div>
            <div>
              <Label>Preview (নমুনা)</Label>
              <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-sm">
                {preview || <span className="text-muted-foreground">—</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={enabled} onCheckedChange={setEnabled} id="tpl-enabled" />
              <Label htmlFor="tpl-enabled">Enabled (চালু)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !body.trim()}>
              {saveMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
