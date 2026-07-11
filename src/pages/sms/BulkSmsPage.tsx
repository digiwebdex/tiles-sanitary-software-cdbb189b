import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Send, Users, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useDealerId } from "@/hooks/useDealerId";
import { collectionsService } from "@/services/collectionsService";
import { customerService, type Customer } from "@/services/customerService";
import { smsCampaignService, type BulkSmsRecipient, type BulkSmsResult } from "@/services/smsCampaignService";
import {
  mergeTemplatesWithOverrides, renderSmsTemplate, estimateSmsSegments,
} from "@/lib/smsTemplates";

type Mode = "due" | "all";

/** Fetch every customer page-by-page (bounded) for the "all customers" mode. */
async function fetchAllCustomers(dealerId: string): Promise<Customer[]> {
  const out: Customer[] = [];
  for (let page = 1; page <= 40; page++) {
    const { data, total } = await customerService.list(dealerId, "", "", page);
    out.push(...data);
    if (out.length >= total || data.length === 0) break;
  }
  return out;
}

export default function BulkSmsPage() {
  const dealerId = useDealerId();
  const { profile } = useAuth();
  const [mode, setMode] = useState<Mode>("due");
  const [minDue, setMinDue] = useState("1");
  const [templateKey, setTemplateKey] = useState<string>("due_reminder");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BulkSmsResult | null>(null);

  const { data: overrides = [] } = useQuery({
    queryKey: ["sms-templates"],
    queryFn: () => smsCampaignService.listTemplates(),
  });
  const templates = mergeTemplatesWithOverrides(overrides).filter((t) => t.isEnabled && t.body);

  const { data: dueCustomers = [], isLoading: dueLoading } = useQuery({
    queryKey: ["bulk-sms-outstanding", dealerId],
    queryFn: () => collectionsService.listOutstanding(dealerId!),
    enabled: !!dealerId && mode === "due",
  });

  const { data: allCustomers = [], isLoading: allLoading } = useQuery({
    queryKey: ["bulk-sms-all-customers", dealerId],
    queryFn: () => fetchAllCustomers(dealerId!),
    enabled: !!dealerId && mode === "all",
  });

  const shopName = profile?.name ?? "";

  const recipients: BulkSmsRecipient[] = useMemo(() => {
    if (mode === "due") {
      const min = Math.max(0, Number(minDue) || 0);
      return dueCustomers
        .filter((c) => c.phone && c.outstanding >= min)
        .map((c) => ({
          phone: c.phone as string,
          vars: {
            name: c.name,
            phone: c.phone as string,
            due: Math.round(c.outstanding).toLocaleString("en-IN"),
            shop: shopName,
          },
        }));
    }
    return allCustomers
      .filter((c) => c.phone)
      .map((c) => ({
        phone: c.phone as string,
        vars: { name: c.name, phone: c.phone as string, shop: shopName },
      }));
  }, [mode, dueCustomers, allCustomers, minDue, shopName]);

  const activeTemplate = templates.find((t) => t.key === templateKey);
  const effectiveMessage = message.trim() || activeTemplate?.body || "";
  const previewVars = recipients[0]?.vars ?? { name: "কাস্টমার", due: "0", shop: shopName, phone: "" };
  const preview = renderSmsTemplate(effectiveMessage, previewVars);
  const loading = mode === "due" ? dueLoading : allLoading;

  async function handleSend() {
    if (!effectiveMessage) {
      toast.error("বার্তা লিখুন বা টেমপ্লেট বাছাই করুন (Message required)");
      return;
    }
    if (recipients.length === 0) {
      toast.error("কোনো প্রাপক নেই (No recipients with phone numbers)");
      return;
    }
    setSending(true);
    setResult(null);
    setProgress(0);
    try {
      const prefix = `bulk-${crypto.randomUUID().slice(0, 18)}`;
      const totals = await smsCampaignService.sendBulk(
        prefix,
        effectiveMessage,
        recipients,
        (done, total) => setProgress(Math.round((done / total) * 100)),
      );
      setResult(totals);
      toast.success(`পাঠানো হয়েছে: ${totals.sent}টি, ব্যর্থ: ${totals.failed}টি`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Megaphone className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Bulk SMS <span className="text-muted-foreground font-normal">(বাল্ক এসএমএস)</span></h1>
          <p className="text-sm text-muted-foreground">
            সব কাস্টমার বা বকেয়া কাস্টমারদের একসাথে এসএমএস পাঠান
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recipients (প্রাপক)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList>
                <TabsTrigger value="due" className="gap-1">
                  <Wallet className="h-4 w-4" /> বকেয়া কাস্টমার (Due)
                </TabsTrigger>
                <TabsTrigger value="all" className="gap-1">
                  <Users className="h-4 w-4" /> সব কাস্টমার (All)
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {mode === "due" && (
              <div className="max-w-xs">
                <Label>Minimum due (ন্যূনতম বকেয়া)</Label>
                <Input
                  type="number"
                  min="0"
                  value={minDue}
                  onChange={(e) => setMinDue(e.target.value)}
                />
              </div>
            )}

            <p className="text-sm">
              {loading ? (
                "Loading…"
              ) : (
                <>
                  <Badge variant="secondary" className="mr-2">{recipients.length}</Badge>
                  জন প্রাপক পাওয়া গেছে (ফোন নম্বর আছে এমন)
                </>
              )}
            </p>

            <div>
              <Label>Template (টেমপ্লেট)</Label>
              <Select value={templateKey} onValueChange={(v) => { setTemplateKey(v); setMessage(""); }}>
                <SelectTrigger className="max-w-sm">
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.label} ({t.labelBn})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Message (বার্তা — খালি রাখলে টেমপ্লেট ব্যবহৃত হবে)</Label>
              <Textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={activeTemplate?.body}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {effectiveMessage.length} chars • {estimateSmsSegments(effectiveMessage)} segment(s) •
                placeholders: {"{name} {due} {shop} {phone}"}
              </p>
            </div>

            {sending && <Progress value={progress} />}

            <Button onClick={handleSend} disabled={sending || loading} className="w-full sm:w-auto">
              <Send className="mr-2 h-4 w-4" />
              {sending ? `Sending… ${progress}%` : `Send to ${recipients.length} customers`}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Preview (নমুনা)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
                {preview || <span className="text-muted-foreground">টেমপ্লেট বা বার্তা বাছাই করুন</span>}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                প্রথম প্রাপকের তথ্য দিয়ে দেখানো হচ্ছে
              </p>
            </CardContent>
          </Card>

          {result && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Result (ফলাফল)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>মোট: <strong>{result.total}</strong></p>
                <p className="text-green-600">পাঠানো হয়েছে: <strong>{result.sent}</strong></p>
                <p className="text-destructive">ব্যর্থ: <strong>{result.failed}</strong></p>
                <p className="text-muted-foreground">আগে পাঠানো (বাদ): <strong>{result.deduped}</strong></p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
