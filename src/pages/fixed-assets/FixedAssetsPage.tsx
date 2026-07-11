/**
 * Fixed Asset Register & Categories — V2 Sprint 6D.
 * Register creation capitalizes the asset (Asset Purchase GL posting) in the
 * same call — see fixedAssetService.create / routes/fixedAssets.ts POST /.
 * Depreciation runs and Disposal live on FixedAssetDetailPage.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDealerId } from "@/hooks/useDealerId";
import { fixedAssetService, type AssetCategory } from "@/services/fixedAssetService";
import { toast } from "@/hooks/use-toast";
import { Plus, Boxes, Pencil } from "lucide-react";

const money = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const emptyAssetForm = () => ({
  tag: "", name: "", asset_category_id: "", serial_no: "", brand: "", model: "",
  purchase_date: new Date().toISOString().slice(0, 10), amount: "",
  useful_life_months: "", salvage_value: "",
  depreciation_method: "straight_line" as "straight_line" | "declining_balance",
  depreciation_rate: "", cost_center_id: "", funded_by: "none" as "none" | "cash" | "bank",
  notes: "",
});

const emptyCategoryForm = () => ({
  name: "", default_useful_life_months: "", default_salvage_percent: "0",
  default_depreciation_method: "straight_line" as "straight_line" | "declining_balance",
});

const FixedAssetsPage = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"register" | "categories">("register");

  const { data: assetsData, isLoading: assetsLoading } = useQuery({
    queryKey: ["fixed-assets", dealerId],
    queryFn: () => fixedAssetService.list(dealerId!),
    enabled: !!dealerId,
  });
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ["asset-categories", dealerId],
    queryFn: () => fixedAssetService.listCategories(dealerId!),
    enabled: !!dealerId,
  });

  const assets = assetsData?.rows ?? [];
  const categories = categoriesData?.rows ?? [];

  // ── Create asset dialog ──
  const [assetOpen, setAssetOpen] = useState(false);
  const [assetForm, setAssetForm] = useState(emptyAssetForm());
  const resetAssetForm = () => { setAssetOpen(false); setAssetForm(emptyAssetForm()); };

  const createAssetMutation = useMutation({
    mutationFn: () => fixedAssetService.create(dealerId!, {
      tag: assetForm.tag.trim(),
      name: assetForm.name.trim(),
      asset_category_id: assetForm.asset_category_id || null,
      serial_no: assetForm.serial_no.trim() || null,
      brand: assetForm.brand.trim() || null,
      model: assetForm.model.trim() || null,
      purchase_date: assetForm.purchase_date,
      amount: Number(assetForm.amount),
      useful_life_months: assetForm.useful_life_months ? Number(assetForm.useful_life_months) : null,
      salvage_value: assetForm.salvage_value ? Number(assetForm.salvage_value) : null,
      depreciation_method: assetForm.depreciation_method,
      depreciation_rate: assetForm.depreciation_method === "declining_balance" && assetForm.depreciation_rate ? Number(assetForm.depreciation_rate) : null,
      cost_center_id: assetForm.cost_center_id || null,
      funded_by: assetForm.funded_by === "none" ? null : { kind: assetForm.funded_by },
      notes: assetForm.notes.trim() || null,
    }),
    onSuccess: () => { toast({ title: "Asset capitalized" }); resetAssetForm(); qc.invalidateQueries({ queryKey: ["fixed-assets"] }); },
    onError: (e: any) => toast({ title: "Failed to create asset", description: e?.message, variant: "destructive" }),
  });

  const handleAssetSave = () => {
    if (!assetForm.tag.trim() || !assetForm.name.trim()) { toast({ title: "Tag and name are required", variant: "destructive" }); return; }
    if (!(Number(assetForm.amount) > 0)) { toast({ title: "Amount must be positive", variant: "destructive" }); return; }
    if (assetForm.depreciation_method === "declining_balance" && !assetForm.depreciation_rate) {
      toast({ title: "Depreciation rate is required for declining balance", variant: "destructive" }); return;
    }
    createAssetMutation.mutate();
  };

  // ── Category dialog ──
  const [catOpen, setCatOpen] = useState(false);
  const [catEditing, setCatEditing] = useState<AssetCategory | null>(null);
  const [catForm, setCatForm] = useState(emptyCategoryForm());
  const resetCatForm = () => { setCatOpen(false); setCatEditing(null); setCatForm(emptyCategoryForm()); };
  const openCatCreate = () => { setCatEditing(null); setCatForm(emptyCategoryForm()); setCatOpen(true); };
  const openCatEdit = (c: AssetCategory) => {
    setCatEditing(c);
    setCatForm({
      name: c.name,
      default_useful_life_months: c.default_useful_life_months != null ? String(c.default_useful_life_months) : "",
      default_salvage_percent: String(c.default_salvage_percent ?? 0),
      default_depreciation_method: c.default_depreciation_method,
    });
    setCatOpen(true);
  };

  const catCreateMutation = useMutation({
    mutationFn: () => fixedAssetService.createCategory(dealerId!, {
      name: catForm.name.trim(),
      default_useful_life_months: catForm.default_useful_life_months ? Number(catForm.default_useful_life_months) : null,
      default_salvage_percent: Number(catForm.default_salvage_percent) || 0,
      default_depreciation_method: catForm.default_depreciation_method,
    }),
    onSuccess: () => { toast({ title: "Category created" }); resetCatForm(); qc.invalidateQueries({ queryKey: ["asset-categories"] }); },
    onError: (e: any) => toast({ title: "Create failed", description: e?.message, variant: "destructive" }),
  });
  const catUpdateMutation = useMutation({
    mutationFn: () => fixedAssetService.updateCategory(dealerId!, catEditing!.id, {
      name: catForm.name.trim(),
      default_useful_life_months: catForm.default_useful_life_months ? Number(catForm.default_useful_life_months) : null,
      default_salvage_percent: Number(catForm.default_salvage_percent) || 0,
      default_depreciation_method: catForm.default_depreciation_method,
    }),
    onSuccess: () => { toast({ title: "Category updated" }); resetCatForm(); qc.invalidateQueries({ queryKey: ["asset-categories"] }); },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });
  const catSaving = catCreateMutation.isPending || catUpdateMutation.isPending;
  const handleCatSave = () => {
    if (!catForm.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (catEditing) catUpdateMutation.mutate(); else catCreateMutation.mutate();
  };

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="h-6 w-6" /> Fixed Assets</h1>
        {tab === "register" ? (
          <Button onClick={() => setAssetOpen(true)}><Plus className="h-4 w-4 mr-2" /> New Asset</Button>
        ) : (
          <Button onClick={openCatCreate}><Plus className="h-4 w-4 mr-2" /> New Category</Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Asset Register ({assets.length})</CardTitle></CardHeader>
            <CardContent>
              {assetsLoading ? <p>Loading…</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tag</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Accum. Depr.</TableHead>
                      <TableHead className="text-right">Book Value</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((a) => (
                      <TableRow key={a.id} className="cursor-pointer" onClick={() => navigate(`/fixed-assets/${a.id}`)}>
                        <TableCell className="font-mono">{a.tag}</TableCell>
                        <TableCell>{a.name}</TableCell>
                        <TableCell className="text-muted-foreground">{a.category_name || "—"}</TableCell>
                        <TableCell className="text-right">{money(a.purchase_cost)}</TableCell>
                        <TableCell className="text-right">{money(a.accumulated_depreciation)}</TableCell>
                        <TableCell className="text-right font-semibold">{money(a.purchase_cost - a.accumulated_depreciation)}</TableCell>
                        <TableCell><Badge variant={a.status === "disposed" ? "secondary" : "default"} className="capitalize">{a.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {!assets.length && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No fixed assets yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Asset Categories ({categories.length})</CardTitle></CardHeader>
            <CardContent>
              {categoriesLoading ? <p>Loading…</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Default Useful Life</TableHead>
                      <TableHead>Default Salvage %</TableHead>
                      <TableHead>Default Method</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categories.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{c.name}</TableCell>
                        <TableCell>{c.default_useful_life_months ? `${c.default_useful_life_months} months` : "—"}</TableCell>
                        <TableCell>{c.default_salvage_percent}%</TableCell>
                        <TableCell className="capitalize">{c.default_depreciation_method.replace("_", " ")}</TableCell>
                        <TableCell><Button size="icon" variant="ghost" onClick={() => openCatEdit(c)}><Pencil className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    ))}
                    {!categories.length && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No categories yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* New asset dialog */}
      <Dialog open={assetOpen} onOpenChange={(v) => { if (!v) resetAssetForm(); else setAssetOpen(true); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New Fixed Asset</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tag</Label><Input value={assetForm.tag} onChange={e => setAssetForm({ ...assetForm, tag: e.target.value })} placeholder="e.g. FA-001" /></div>
              <div><Label>Name</Label><Input value={assetForm.name} onChange={e => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="e.g. Delivery Van" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category (optional)</Label>
                <Select value={assetForm.asset_category_id || "none"} onValueChange={(v) => {
                  const cat = categories.find(c => c.id === v);
                  setAssetForm({
                    ...assetForm, asset_category_id: v === "none" ? "" : v,
                    useful_life_months: cat?.default_useful_life_months != null ? String(cat.default_useful_life_months) : assetForm.useful_life_months,
                    depreciation_method: cat?.default_depreciation_method ?? assetForm.depreciation_method,
                  });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Purchase Date</Label><Input type="date" value={assetForm.purchase_date} onChange={e => setAssetForm({ ...assetForm, purchase_date: e.target.value })} /></div>
            </div>
            <div><Label>Amount (Capitalized Cost)</Label><Input type="number" value={assetForm.amount} onChange={e => setAssetForm({ ...assetForm, amount: e.target.value })} placeholder="0.00" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Useful Life (months)</Label><Input type="number" value={assetForm.useful_life_months} onChange={e => setAssetForm({ ...assetForm, useful_life_months: e.target.value })} /></div>
              <div><Label>Salvage Value</Label><Input type="number" value={assetForm.salvage_value} onChange={e => setAssetForm({ ...assetForm, salvage_value: e.target.value })} placeholder="0.00" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Depreciation Method</Label>
                <Select value={assetForm.depreciation_method} onValueChange={(v: any) => setAssetForm({ ...assetForm, depreciation_method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="straight_line">Straight Line</SelectItem>
                    <SelectItem value="declining_balance">Declining Balance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {assetForm.depreciation_method === "declining_balance" && (
                <div><Label>Annual Rate (%)</Label><Input type="number" value={assetForm.depreciation_rate} onChange={e => setAssetForm({ ...assetForm, depreciation_rate: e.target.value })} placeholder="e.g. 20" /></div>
              )}
            </div>
            <div>
              <Label>Funded By (optional)</Label>
              <Select value={assetForm.funded_by} onValueChange={(v: any) => setAssetForm({ ...assetForm, funded_by: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">On account / no immediate cash effect</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetAssetForm} disabled={createAssetMutation.isPending}>Cancel</Button>
            <Button onClick={handleAssetSave} disabled={createAssetMutation.isPending}>{createAssetMutation.isPending ? "Saving…" : "Capitalize Asset"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category dialog */}
      <Dialog open={catOpen} onOpenChange={(v) => { if (!v) resetCatForm(); else setCatOpen(true); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{catEditing ? "Edit Category" : "New Category"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} placeholder="e.g. Vehicles" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Default Useful Life (months)</Label><Input type="number" value={catForm.default_useful_life_months} onChange={e => setCatForm({ ...catForm, default_useful_life_months: e.target.value })} /></div>
              <div><Label>Default Salvage (%)</Label><Input type="number" value={catForm.default_salvage_percent} onChange={e => setCatForm({ ...catForm, default_salvage_percent: e.target.value })} /></div>
            </div>
            <div>
              <Label>Default Depreciation Method</Label>
              <Select value={catForm.default_depreciation_method} onValueChange={(v: any) => setCatForm({ ...catForm, default_depreciation_method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="straight_line">Straight Line</SelectItem>
                  <SelectItem value="declining_balance">Declining Balance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetCatForm} disabled={catSaving}>Cancel</Button>
            <Button onClick={handleCatSave} disabled={catSaving}>{catSaving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FixedAssetsPage;
