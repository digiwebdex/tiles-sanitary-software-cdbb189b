import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Database, Download, FileText, ArrowLeft, CheckCircle2,
  Upload, Calendar, Archive, Package2,
} from "lucide-react";
import { toast } from "sonner";
import { vpsAuthedFetch, vpsTokenStore } from "@/lib/vpsAuthClient";
import { env } from "@/lib/env";
import { usePermissions } from "@/hooks/usePermissions";

interface ManifestEntry {
  key: string;
  label: string;
  table: string;
  rows: number;
}

async function triggerDownload(url: string, filename: string) {
  const access = vpsTokenStore.access;
  const res = await fetch(url, {
    headers: access ? { Authorization: `Bearer ${access}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

const DataBackupPage = () => {
  const { isDealerAdmin } = usePermissions();
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [dailyDate, setDailyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [downloadingDaily, setDownloadingDaily] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const manifestQuery = useQuery({
    queryKey: ["data-export-manifest"],
    queryFn: async () => {
      const res = await vpsAuthedFetch(`/api/data-export/manifest`);
      if (!res.ok) throw new Error("Failed to load backup manifest");
      return (await res.json()) as ManifestEntry[];
    },
    enabled: isDealerAdmin,
  });

  if (!isDealerAdmin) {
    return (
      <div className="container mx-auto max-w-4xl p-6">
        <p className="text-destructive">Access denied. Dealer admin only.</p>
      </div>
    );
  }

  const entries = manifestQuery.data ?? [];

  const handleExportOne = async (entry: ManifestEntry) => {
    setDownloadingKey(entry.key);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await triggerDownload(
        `${env.VPS_API_BASE}/api/data-export/${entry.key}.csv`,
        `${entry.key}_${stamp}.csv`,
      );
      toast.success(`Exported ${entry.label}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleExportAll = async () => {
    if (entries.length === 0) return;
    setDownloadingAll(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      for (const e of entries) {
        try {
          await triggerDownload(
            `${env.VPS_API_BASE}/api/data-export/${e.key}.csv`,
            `${e.key}_${stamp}.csv`,
          );
          await new Promise((r) => setTimeout(r, 250));
        } catch (err) {
          console.warn("export failed", e.key, err);
        }
      }
      toast.success("All CSVs downloaded");
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleDailyExport = async () => {
    setDownloadingDaily(true);
    try {
      await triggerDownload(
        `${env.VPS_API_BASE}/api/data-export/daily?date=${encodeURIComponent(dailyDate)}`,
        `daily_report_${dailyDate}.csv`,
      );
      toast.success(`Daily report for ${dailyDate} downloaded`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloadingDaily(false);
    }
  };

  const handleFullBackup = async () => {
    setDownloadingZip(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await triggerDownload(
        `${env.VPS_API_BASE}/api/data-export/full-backup.zip`,
        `full_backup_${stamp}.zip`,
      );
      toast.success("Full database backup downloaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloadingZip(false);
    }
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Link
          to="/settings"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Settings
        </Link>
      </div>

      {/* ── Daily Data Export ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Daily Data Export
          </CardTitle>
          <CardDescription>
            Download all transactions for a specific date — sales, purchases, expenses,
            payments, challans, returns and ledger entries — in a single CSV file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="daily-date" className="text-sm font-medium mb-1.5 block">
                Select Date
              </Label>
              <Input
                id="daily-date"
                type="date"
                value={dailyDate}
                onChange={(e) => setDailyDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                className="max-w-[220px]"
              />
            </div>
            <Button
              onClick={handleDailyExport}
              disabled={downloadingDaily || !dailyDate}
              className="shrink-0"
            >
              <Download className="h-4 w-4 mr-2" />
              {downloadingDaily ? "Generating…" : "Download Daily CSV"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Includes: Sales · Purchases · Expenses · Customer & Supplier Ledger · Cash Ledger ·
            Challans · Returns · Deliveries
          </p>
        </CardContent>
      </Card>

      {/* ── Full Database Backup ──────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-primary" />
              Full Database Backup
            </CardTitle>
            <CardDescription>
              Download all your dealer data in one ZIP archive containing separate CSV files
              for every table — customers, products, sales, ledger, stock and more.
            </CardDescription>
          </div>
          <Button
            onClick={handleFullBackup}
            disabled={downloadingZip}
            className="shrink-0"
          >
            <Package2 className="h-4 w-4 mr-2" />
            {downloadingZip ? "Packing ZIP…" : "Download Full Backup (.zip)"}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {entries.map((e) => (
              <Badge key={e.key} variant="secondary" className="text-xs">
                {e.label} ({e.rows.toLocaleString()})
              </Badge>
            ))}
            {manifestQuery.isLoading && (
              <span className="text-xs text-muted-foreground">Loading table info…</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* ── Per-table CSV Export ──────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Export by Table
            </CardTitle>
            <CardDescription>Download individual tables as CSV files</CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={handleExportAll}
            disabled={downloadingAll || entries.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            {downloadingAll ? "Exporting…" : "Export All Tables"}
          </Button>
        </CardHeader>
        <CardContent>
          {manifestQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : manifestQuery.isError ? (
            <p className="text-sm text-destructive">{(manifestQuery.error as Error).message}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {entries.map((e) => (
                <div
                  key={e.key}
                  className="flex items-center justify-between rounded-lg border bg-card p-3 hover:bg-accent/40 transition"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.label}</div>
                      <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                        <CheckCircle2 className="h-3 w-3" />
                        {e.rows.toLocaleString()} records
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleExportOne(e)}
                    disabled={downloadingKey === e.key}
                    aria-label={`Export ${e.label}`}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Restore ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Restore from CSV
          </CardTitle>
          <CardDescription>
            Re-import previously exported data using the bulk import dialog in each module.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Link to="/customers">
            <Button variant="outline" className="w-full justify-start">
              <Upload className="h-4 w-4 mr-2" /> Restore Customers
            </Button>
          </Link>
          <Link to="/suppliers">
            <Button variant="outline" className="w-full justify-start">
              <Upload className="h-4 w-4 mr-2" /> Restore Suppliers
            </Button>
          </Link>
          <Link to="/products">
            <Button variant="outline" className="w-full justify-start">
              <Upload className="h-4 w-4 mr-2" /> Restore Products
            </Button>
          </Link>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        <Badge variant="secondary" className="mr-2">Tip</Badge>
        Exports include only your dealer account's data. Schedule regular backups and keep files
        in a safe place (Google Drive, email, USB).
      </p>
    </div>
  );
};

export default DataBackupPage;
