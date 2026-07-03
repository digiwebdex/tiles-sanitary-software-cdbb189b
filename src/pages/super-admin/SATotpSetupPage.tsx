import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { vpsAuthApi, vpsTokenStore } from "@/lib/vpsAuthClient";
import { ShieldCheck, ShieldOff, Smartphone, RefreshCw } from "lucide-react";
import QRCode from "qrcode";

export default function SATotpSetupPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<{ enabled: boolean; enabledAt: string | null } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [loadingEnable, setLoadingEnable] = useState(false);
  const [loadingDisable, setLoadingDisable] = useState(false);

  const token = () => vpsTokenStore.access ?? "";

  const fetchStatus = async () => {
    try {
      const s = await vpsAuthApi.totpStatus(token());
      setStatus(s);
    } catch {
      // ignore
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  const handleSetup = async () => {
    setLoadingSetup(true);
    try {
      const result = await vpsAuthApi.totpSetup(token());
      setSecret(result.secret);
      const dataUrl = await QRCode.toDataURL(result.otpauthUrl, { width: 220 });
      setQrDataUrl(dataUrl);
      setCode("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
    setLoadingSetup(false);
  };

  const handleEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingEnable(true);
    try {
      await vpsAuthApi.totpEnable(token(), code.trim());
      toast({ title: "2FA সক্রিয় হয়েছে", description: "এখন থেকে লগইনে Google Authenticator কোড লাগবে।" });
      setQrDataUrl(null);
      setSecret(null);
      setCode("");
      await fetchStatus();
    } catch (err: any) {
      toast({ variant: "destructive", title: "ভুল কোড", description: err.message });
    }
    setLoadingEnable(false);
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingDisable(true);
    try {
      await vpsAuthApi.totpDisable(token(), disableCode.trim());
      toast({ title: "2FA বন্ধ করা হয়েছে" });
      setDisableCode("");
      await fetchStatus();
    } catch (err: any) {
      toast({ variant: "destructive", title: "ভুল কোড", description: err.message });
    }
    setLoadingDisable(false);
  };

  return (
    <div className="max-w-lg mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Two-Factor Authentication (2FA)</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Google Authenticator দিয়ে Super Admin অ্যাকাউন্ট সুরক্ষিত করুন
        </p>
      </div>

      {/* Status card */}
      <Card>
        <CardContent className="pt-6 flex items-center gap-4">
          {status?.enabled ? (
            <>
              <ShieldCheck className="h-8 w-8 text-green-500 shrink-0" />
              <div>
                <p className="font-semibold text-green-600 dark:text-green-400">2FA সক্রিয় আছে</p>
                {status.enabledAt && (
                  <p className="text-xs text-muted-foreground">
                    চালু হয়েছে: {new Date(status.enabledAt).toLocaleString("bn-BD")}
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <ShieldOff className="h-8 w-8 text-orange-500 shrink-0" />
              <div>
                <p className="font-semibold text-orange-600 dark:text-orange-400">2FA বন্ধ আছে</p>
                <p className="text-xs text-muted-foreground">Google Authenticator সেটআপ করুন</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Setup / QR section (only when not enabled) */}
      {!status?.enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="h-4 w-4" /> Google Authenticator সেটআপ
            </CardTitle>
            <CardDescription>
              ১. Google Authenticator ইনস্টল করুন → ২. QR স্ক্যান করুন → ৩. কোড দিয়ে নিশ্চিত করুন
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!qrDataUrl ? (
              <Button onClick={handleSetup} disabled={loadingSetup} className="w-full">
                {loadingSetup ? (
                  <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> সেটআপ হচ্ছে…</>
                ) : "QR কোড তৈরি করুন"}
              </Button>
            ) : (
              <>
                <div className="flex justify-center">
                  <img src={qrDataUrl} alt="TOTP QR Code" className="rounded-lg border" />
                </div>
                <Alert>
                  <AlertDescription className="text-xs font-mono break-all">
                    Manual key: {secret}
                  </AlertDescription>
                </Alert>
                <form onSubmit={handleEnable} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="totp-code">Authenticator থেকে ৬-সংখ্যার কোড</Label>
                    <Input
                      id="totp-code"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      placeholder="000000"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      required
                      className="text-center text-xl tracking-widest font-mono"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loadingEnable || code.length !== 6}>
                    {loadingEnable ? "যাচাই হচ্ছে…" : "2FA সক্রিয় করুন"}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Disable section (only when enabled) */}
      {status?.enabled && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive">2FA বন্ধ করুন</CardTitle>
            <CardDescription>
              বর্তমান Authenticator কোড দিয়ে 2FA নিষ্ক্রিয় করুন
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleDisable} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="disable-code">Authenticator কোড</Label>
                <Input
                  id="disable-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
                  required
                  className="text-center text-xl tracking-widest font-mono"
                />
              </div>
              <Button type="submit" variant="destructive" className="w-full" disabled={loadingDisable || disableCode.length !== 6}>
                {loadingDisable ? "নিষ্ক্রিয় হচ্ছে…" : "2FA বন্ধ করুন"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
