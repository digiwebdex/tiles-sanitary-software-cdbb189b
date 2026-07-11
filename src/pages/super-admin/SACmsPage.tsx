import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Globe, Save, RefreshCw, LayoutTemplate, Star, CreditCard,
  Shield, AlignLeft, Search, CheckCircle2, Plus, Trash2,
  GripVertical, Link, Type, FileText, Package, Lock,
} from "lucide-react";
import { format } from "date-fns";

/* ─────────────────────────────────────────────────────────────────── */
/* Types                                                               */
/* ─────────────────────────────────────────────────────────────────── */
type WebsiteContent = {
  id: string;
  section_key: string;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  button_text: string | null;
  button_link: string | null;
  extra_json: Record<string, any> | null;
  updated_at: string;
};

type FeatureItem = { icon: string; title: string; description: string };
type PricingPlan  = { name: string; price: string; period: string; features: string[]; highlighted: boolean };
type BulletPoint  = { text: string };

/* ─────────────────────────────────────────────────────────────────── */
/* Helpers                                                             */
/* ─────────────────────────────────────────────────────────────────── */
const SECTIONS = [
  { key: "hero",     label: "Hero",     icon: LayoutTemplate, description: "Main landing page banner" },
  { key: "features", label: "Features", icon: Star,           description: "Product feature highlights" },
  { key: "pricing",  label: "Pricing",  icon: CreditCard,     description: "Pricing plans" },
  { key: "security", label: "Security", icon: Shield,         description: "Security & trust section" },
  { key: "footer",   label: "Footer",   icon: AlignLeft,      description: "Footer contact info" },
  { key: "seo",      label: "SEO",      icon: Search,         description: "Meta title & description" },
];

const SaveBar = ({
  updatedAt,
  onSave,
  isSaving,
}: { updatedAt?: string; onSave: () => void; isSaving: boolean }) => (
  <div className="flex items-center justify-between pt-4 border-t mt-6">
    <span className="text-xs text-muted-foreground">
      {updatedAt ? `Last saved: ${format(new Date(updatedAt), "dd MMM yyyy, HH:mm")}` : "Not yet saved"}
    </span>
    <Button onClick={onSave} disabled={isSaving} size="sm" className="gap-2">
      {isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      {isSaving ? "Saving…" : "Save Section"}
    </Button>
  </div>
);

/* ─────────────────────────────────────────────────────────────────── */
/* HERO FORM                                                           */
/* ─────────────────────────────────────────────────────────────────── */
const HeroForm = ({
  data, onSave, isSaving,
}: { data?: WebsiteContent; onSave: (v: Partial<WebsiteContent>) => void; isSaving: boolean }) => {
  const ex = data?.extra_json ?? {};
  const [title, setTitle]         = useState(data?.title ?? "");
  const [subtitle, setSubtitle]   = useState(data?.subtitle ?? "");
  const [btnText, setBtnText]     = useState(data?.button_text ?? "");
  const [btnLink, setBtnLink]     = useState(data?.button_link ?? "");
  const [badge, setBadge]         = useState<string>(ex.badge ?? "");
  const [secondaryBtn, setSecBtn] = useState<string>(ex.secondary_button ?? "");
  const [secondaryLink, setSecLink] = useState<string>(ex.secondary_link ?? "");

  const handleSave = () => onSave({
    section_key: "hero",
    title:       title || null,
    subtitle:    subtitle || null,
    button_text: btnText || null,
    button_link: btnLink || null,
    extra_json:  { badge, secondary_button: secondaryBtn, secondary_link: secondaryLink },
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><Type className="h-3.5 w-3.5" />Hero Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Manage Your Business Smarter" />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />Subtitle / Tagline</Label>
          <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="All-in-one ERP for Tiles & Sanitary Dealers" />
        </div>
        <div className="space-y-1.5">
          <Label>Badge Text <span className="text-muted-foreground text-xs">(above title)</span></Label>
          <Input value={badge} onChange={e => setBadge(e.target.value)} placeholder="Trusted by 100+ Dealers" />
        </div>
      </div>

      <Separator />
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Primary Button</p>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><Type className="h-3.5 w-3.5" />Button Text</Label>
          <Input value={btnText} onChange={e => setBtnText(e.target.value)} placeholder="Get Started" />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><Link className="h-3.5 w-3.5" />Button Link</Label>
          <Input value={btnLink} onChange={e => setBtnLink(e.target.value)} placeholder="/login" />
        </div>
      </div>

      <Separator />
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Secondary Button (optional)</p>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Button Text</Label>
          <Input value={secondaryBtn} onChange={e => setSecBtn(e.target.value)} placeholder="Watch Demo" />
        </div>
        <div className="space-y-1.5">
          <Label>Button Link</Label>
          <Input value={secondaryLink} onChange={e => setSecLink(e.target.value)} placeholder="#demo" />
        </div>
      </div>

      <SaveBar updatedAt={data?.updated_at} onSave={handleSave} isSaving={isSaving} />
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────── */
/* FEATURES FORM                                                       */
/* ─────────────────────────────────────────────────────────────────── */
const ICON_OPTIONS = [
  "BarChart2", "Package", "ShoppingCart", "Users", "Truck", "FileText",
  "PieChart", "Shield", "Layers", "CreditCard", "Bell", "Settings",
];

const FeaturesForm = ({
  data, onSave, isSaving,
}: { data?: WebsiteContent; onSave: (v: Partial<WebsiteContent>) => void; isSaving: boolean }) => {
  const ex = data?.extra_json ?? {};
  const [title, setTitle]       = useState(data?.title ?? "");
  const [subtitle, setSubtitle] = useState(data?.subtitle ?? "");
  const [items, setItems] = useState<FeatureItem[]>(
    ex.items ?? [{ icon: "BarChart2", title: "", description: "" }]
  );

  const addItem = () => setItems(prev => [...prev, { icon: "Package", title: "", description: "" }]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof FeatureItem, val: string) =>
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  const handleSave = () => onSave({
    section_key: "features",
    title:       title || null,
    subtitle:    subtitle || null,
    extra_json:  { items },
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4">
        <div className="space-y-1.5">
          <Label>Section Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Everything You Need" />
        </div>
        <div className="space-y-1.5">
          <Label>Section Subtitle</Label>
          <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Powerful features for modern dealers" />
        </div>
      </div>

      <Separator />
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Feature Cards ({items.length})</p>
        <Button size="sm" variant="outline" onClick={addItem} className="gap-1.5 h-8 text-xs">
          <Plus className="h-3.5 w-3.5" /> Add Feature
        </Button>
      </div>

      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="border rounded-lg p-4 space-y-3 bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Feature {i + 1}</span>
              </div>
              <Button
                size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => removeItem(i)} disabled={items.length === 1}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Icon Name</Label>
                <select
                  value={item.icon}
                  onChange={e => updateItem(i, "icon", e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {ICON_OPTIONS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
                </select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Feature Title</Label>
                <Input
                  value={item.title}
                  onChange={e => updateItem(i, "title", e.target.value)}
                  placeholder="Inventory Management"
                  className="text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={item.description}
                onChange={e => updateItem(i, "description", e.target.value)}
                placeholder="Track stock levels, set reorder alerts, manage products..."
                className="min-h-[60px] text-sm"
              />
            </div>
          </div>
        ))}
      </div>

      <SaveBar updatedAt={data?.updated_at} onSave={handleSave} isSaving={isSaving} />
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────── */
/* PRICING FORM                                                        */
/* ─────────────────────────────────────────────────────────────────── */
const PricingForm = ({
  data, onSave, isSaving,
}: { data?: WebsiteContent; onSave: (v: Partial<WebsiteContent>) => void; isSaving: boolean }) => {
  const ex = data?.extra_json ?? {};
  const [title, setTitle]       = useState(data?.title ?? "");
  const [subtitle, setSubtitle] = useState(data?.subtitle ?? "");
  const [plans, setPlans] = useState<PricingPlan[]>(
    ex.plans ?? [{ name: "Starter", price: "999", period: "/month", features: ["Up to 5 users", "Basic reports"], highlighted: false }]
  );

  const addPlan = () => setPlans(prev => [...prev, { name: "", price: "", period: "/month", features: [""], highlighted: false }]);
  const removePlan = (i: number) => setPlans(prev => prev.filter((_, idx) => idx !== i));
  const updatePlan = <K extends keyof PricingPlan>(i: number, field: K, val: PricingPlan[K]) =>
    setPlans(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p));

  const addFeature = (planIdx: number) =>
    setPlans(prev => prev.map((p, i) => i === planIdx ? { ...p, features: [...p.features, ""] } : p));
  const updateFeature = (planIdx: number, featIdx: number, val: string) =>
    setPlans(prev => prev.map((p, i) => i === planIdx
      ? { ...p, features: p.features.map((f, fi) => fi === featIdx ? val : f) }
      : p
    ));
  const removeFeature = (planIdx: number, featIdx: number) =>
    setPlans(prev => prev.map((p, i) => i === planIdx
      ? { ...p, features: p.features.filter((_, fi) => fi !== featIdx) }
      : p
    ));

  const handleSave = () => onSave({
    section_key: "pricing",
    title:       title || null,
    subtitle:    subtitle || null,
    extra_json:  { plans },
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4">
        <div className="space-y-1.5">
          <Label>Section Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Simple, Transparent Pricing" />
        </div>
        <div className="space-y-1.5">
          <Label>Section Subtitle</Label>
          <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="No hidden fees. Pay as you grow." />
        </div>
      </div>

      <Separator />
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pricing Plans ({plans.length})</p>
        <Button size="sm" variant="outline" onClick={addPlan} className="gap-1.5 h-8 text-xs">
          <Plus className="h-3.5 w-3.5" /> Add Plan
        </Button>
      </div>

      <div className="space-y-4">
        {plans.map((plan, pi) => (
          <div key={pi} className={`border rounded-lg p-4 space-y-4 ${plan.highlighted ? "border-primary/50 bg-primary/5" : "bg-muted/20"}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Plan {pi + 1}</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox" checked={plan.highlighted}
                    onChange={e => updatePlan(pi, "highlighted", e.target.checked)}
                    className="rounded"
                  />
                  Highlighted
                </label>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => removePlan(pi)} disabled={plans.length === 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Plan Name</Label>
                <Input value={plan.name} onChange={e => updatePlan(pi, "name", e.target.value)} placeholder="Pro" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Price</Label>
                <Input value={plan.price} onChange={e => updatePlan(pi, "price", e.target.value)} placeholder="1,999" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Period</Label>
                <Input value={plan.period} onChange={e => updatePlan(pi, "period", e.target.value)} placeholder="/month" className="text-sm" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Features List</Label>
                <Button size="sm" variant="ghost" onClick={() => addFeature(pi)} className="h-6 text-xs gap-1 px-2">
                  <Plus className="h-3 w-3" /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {plan.features.map((feat, fi) => (
                  <div key={fi} className="flex items-center gap-2">
                    <Input
                      value={feat}
                      onChange={e => updateFeature(pi, fi, e.target.value)}
                      placeholder="Feature description"
                      className="text-sm h-8"
                    />
                    <Button
                      size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => removeFeature(pi, fi)} disabled={plan.features.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <SaveBar updatedAt={data?.updated_at} onSave={handleSave} isSaving={isSaving} />
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────── */
/* SECURITY FORM                                                       */
/* ─────────────────────────────────────────────────────────────────── */
const SecurityForm = ({
  data, onSave, isSaving,
}: { data?: WebsiteContent; onSave: (v: Partial<WebsiteContent>) => void; isSaving: boolean }) => {
  const ex = data?.extra_json ?? {};
  const [title, setTitle]       = useState(data?.title ?? "");
  const [subtitle, setSubtitle] = useState(data?.subtitle ?? "");
  const [bullets, setBullets]   = useState<BulletPoint[]>(ex.bullets ?? [{ text: "" }]);
  const [cloudInfo, setCloudInfo]   = useState<string>(ex.cloud_info ?? "");
  const [backupInfo, setBackupInfo] = useState<string>(ex.backup_info ?? "");

  const addBullet   = () => setBullets(prev => [...prev, { text: "" }]);
  const removeBullet = (i: number) => setBullets(prev => prev.filter((_, idx) => idx !== i));
  const updateBullet = (i: number, val: string) =>
    setBullets(prev => prev.map((b, idx) => idx === i ? { text: val } : b));

  const handleSave = () => onSave({
    section_key: "security",
    title:       title || null,
    subtitle:    subtitle || null,
    extra_json:  { bullets, cloud_info: cloudInfo, backup_info: backupInfo },
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4">
        <div className="space-y-1.5">
          <Label>Section Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Enterprise-Grade Security" />
        </div>
        <div className="space-y-1.5">
          <Label>Section Subtitle</Label>
          <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Your data is safe with us" />
        </div>
      </div>

      <Separator />
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Security Bullet Points ({bullets.length})
        </p>
        <Button size="sm" variant="outline" onClick={addBullet} className="gap-1.5 h-8 text-xs">
          <Plus className="h-3.5 w-3.5" /> Add Point
        </Button>
      </div>

      <div className="space-y-2">
        {bullets.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              value={b.text}
              onChange={e => updateBullet(i, e.target.value)}
              placeholder="Bank-level AES-256 encryption"
              className="text-sm"
            />
            <Button
              size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
              onClick={() => removeBullet(i)} disabled={bullets.length === 1}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Separator />
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Additional Info</p>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><Package className="h-3.5 w-3.5" />Cloud Infrastructure Info</Label>
          <Textarea
            value={cloudInfo}
            onChange={e => setCloudInfo(e.target.value)}
            placeholder="Hosted on enterprise cloud with 99.9% uptime SLA..."
            className="min-h-[80px] text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" />Backup & Recovery Info</Label>
          <Textarea
            value={backupInfo}
            onChange={e => setBackupInfo(e.target.value)}
            placeholder="Automated daily backups with 30-day retention..."
            className="min-h-[80px] text-sm"
          />
        </div>
      </div>

      <SaveBar updatedAt={data?.updated_at} onSave={handleSave} isSaving={isSaving} />
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────── */
/* FOOTER FORM                                                         */
/* ─────────────────────────────────────────────────────────────────── */
const FooterForm = ({
  data, onSave, isSaving,
}: { data?: WebsiteContent; onSave: (v: Partial<WebsiteContent>) => void; isSaving: boolean }) => {
  const ex = data?.extra_json ?? {};
  const [companyName, setCompanyName] = useState<string>(data?.title ?? "");
  const [tagline, setTagline]         = useState<string>(data?.description ?? "");
  const [phone, setPhone]             = useState<string>(ex.phone ?? "");
  const [email, setEmail]             = useState<string>(ex.email ?? "");
  const [address, setAddress]         = useState<string>(ex.address ?? "");
  const [copyright, setCopyright]     = useState<string>(ex.copyright ?? "");

  const handleSave = () => onSave({
    section_key: "footer",
    title:       companyName || null,
    description: tagline || null,
    extra_json:  { phone, email, address, copyright },
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4">
        <div className="space-y-1.5">
          <Label>Company Name</Label>
          <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Tiles & Sanitary ERP" />
        </div>
        <div className="space-y-1.5">
          <Label>Company Tagline</Label>
          <Input value={tagline} onChange={e => setTagline(e.target.value)} placeholder="The modern ERP for tiles dealers..." />
        </div>
      </div>

      <Separator />
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contact Info</p>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Phone Number</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+880 1234-567890" />
          </div>
          <div className="space-y-1.5">
            <Label>Email Address</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="support@example.com" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Address</Label>
          <Textarea
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="123 Business Street, Dhaka, Bangladesh"
            className="min-h-[70px] text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Copyright Text</Label>
          <Input value={copyright} onChange={e => setCopyright(e.target.value)} placeholder="© 2025 Tiles ERP. All rights reserved." />
        </div>
      </div>

      <SaveBar updatedAt={data?.updated_at} onSave={handleSave} isSaving={isSaving} />
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────── */
/* SEO FORM                                                            */
/* ─────────────────────────────────────────────────────────────────── */
const SeoForm = ({
  data, onSave, isSaving,
}: { data?: WebsiteContent; onSave: (v: Partial<WebsiteContent>) => void; isSaving: boolean }) => {
  const ex = data?.extra_json ?? {};
  const [metaTitle, setMetaTitle]       = useState(data?.title ?? "");
  const [metaDesc, setMetaDesc]         = useState(data?.description ?? "");
  const [keywords, setKeywords]         = useState<string>(ex.keywords ?? "");
  const [ogImage, setOgImage]           = useState<string>(ex.og_image ?? "");

  const handleSave = () => onSave({
    section_key: "seo",
    title:       metaTitle || null,
    description: metaDesc || null,
    extra_json:  { keywords, og_image: ogImage },
  });

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Meta Title</Label>
        <Input value={metaTitle} onChange={e => setMetaTitle(e.target.value)} placeholder="Tiles & Sanitary ERP – Manage Your Business" />
        <p className={`text-xs ${metaTitle.length > 60 ? "text-destructive" : "text-muted-foreground"}`}>
          {metaTitle.length}/60 characters (recommended)
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Meta Description</Label>
        <Textarea
          value={metaDesc}
          onChange={e => setMetaDesc(e.target.value)}
          placeholder="All-in-one ERP for tiles and sanitary dealers. Manage inventory, sales, purchases and finances in one place."
          className="min-h-[90px]"
        />
        <p className={`text-xs ${metaDesc.length > 160 ? "text-destructive" : "text-muted-foreground"}`}>
          {metaDesc.length}/160 characters (recommended)
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Keywords <span className="text-muted-foreground text-xs">(comma-separated)</span></Label>
        <Input
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
          placeholder="tiles ERP, sanitary software, dealer management"
        />
      </div>

      <div className="space-y-1.5">
        <Label>OG Image URL <span className="text-muted-foreground text-xs">(for social sharing)</span></Label>
        <Input value={ogImage} onChange={e => setOgImage(e.target.value)} placeholder="https://example.com/og-image.png" />
      </div>

      {/* Live preview */}
      {(metaTitle || metaDesc) && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Search Preview</p>
          <p className="text-sm font-medium text-primary truncate">{metaTitle || "Page Title"}</p>
          <p className="text-xs text-muted-foreground line-clamp-2">{metaDesc || "Meta description..."}</p>
        </div>
      )}

      <SaveBar updatedAt={data?.updated_at} onSave={handleSave} isSaving={isSaving} />
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────── */
/* MAIN PAGE                                                           */
/* ─────────────────────────────────────────────────────────────────── */
const SACmsPage = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  const { data: allContent = [], isLoading } = useQuery<WebsiteContent[]>({
    queryKey: ["website-content-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("website_content")
        .select("*")
        .order("section_key");
      if (error) throw new Error(error.message);
      return (data ?? []) as WebsiteContent[];
    },
  });

  const contentByKey = Object.fromEntries(allContent.map(c => [c.section_key, c]));

  const { mutate: saveSection, isPending: isSaving } = useMutation({
    mutationFn: async (values: Partial<WebsiteContent>) => {
      const payload = {
        section_key: values.section_key!,
        title:       values.title       ?? null,
        subtitle:    values.subtitle    ?? null,
        description: values.description ?? null,
        button_text: values.button_text ?? null,
        button_link: values.button_link ?? null,
        extra_json:  values.extra_json  ?? {},
      };
      const { error } = await supabase
        .from("website_content")
        .upsert(payload, { onConflict: "section_key" });
      if (error) throw new Error(error.message);
      return values.section_key;
    },
    onSuccess: (key) => {
      toast({ title: "Section saved", description: `"${key}" section has been updated.` });
      setSavedKeys(prev => new Set([...prev, key as string]));
      qc.invalidateQueries({ queryKey: ["website-content-all"] });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
      Loading CMS content…
    </div>
  );

  const formProps = (key: string) => ({
    data:    contentByKey[key],
    onSave:  saveSection,
    isSaving,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Globe className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Landing Page CMS</h1>
            <p className="text-sm text-muted-foreground">Edit content for your public landing page sections.</p>
          </div>
        </div>
        <Badge variant="outline" className="text-xs gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block" />
          {allContent.length} / {SECTIONS.length} sections
        </Badge>
      </div>

      {/* Section status chips */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {SECTIONS.map(s => {
          const saved  = savedKeys.has(s.key);
          const exists = Boolean(contentByKey[s.key]);
          return (
            <div
              key={s.key}
              className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-center transition-colors ${
                saved ? "border-primary/50 bg-primary/5" : exists ? "border-border bg-muted/30" : "border-dashed border-border"
              }`}
            >
              <s.icon className={`h-4 w-4 ${saved ? "text-primary" : "text-muted-foreground"}`} />
              <span className="text-[10px] font-medium capitalize text-foreground leading-tight">{s.label}</span>
              {saved && <CheckCircle2 className="h-3 w-3 text-primary" />}
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="hero">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted p-1">
          {SECTIONS.map(s => (
            <TabsTrigger key={s.key} value={s.key} className="gap-1.5 text-xs">
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
              {savedKeys.has(s.key) && <CheckCircle2 className="h-3 w-3 text-primary ml-0.5" />}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="hero" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2"><LayoutTemplate className="h-4 w-4 text-primary" /><CardTitle className="text-base">Hero Section</CardTitle></div>
              <CardDescription>Main banner — first thing visitors see on your landing page.</CardDescription>
            </CardHeader>
            <CardContent><HeroForm {...formProps("hero")} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="features" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2"><Star className="h-4 w-4 text-primary" /><CardTitle className="text-base">Features Section</CardTitle></div>
              <CardDescription>Showcase your product's key capabilities with icons and descriptions.</CardDescription>
            </CardHeader>
            <CardContent><FeaturesForm {...formProps("features")} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pricing" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-primary" /><CardTitle className="text-base">Pricing Section</CardTitle></div>
              <CardDescription>Define your pricing plans with feature lists. Mark one as highlighted for emphasis.</CardDescription>
            </CardHeader>
            <CardContent><PricingForm {...formProps("pricing")} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-primary" /><CardTitle className="text-base">Security Section</CardTitle></div>
              <CardDescription>Build trust with security bullet points, cloud info and backup details.</CardDescription>
            </CardHeader>
            <CardContent><SecurityForm {...formProps("security")} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="footer" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2"><AlignLeft className="h-4 w-4 text-primary" /><CardTitle className="text-base">Footer Section</CardTitle></div>
              <CardDescription>Company name, contact information and copyright displayed in the footer.</CardDescription>
            </CardHeader>
            <CardContent><FooterForm {...formProps("footer")} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seo" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2"><Search className="h-4 w-4 text-primary" /><CardTitle className="text-base">SEO Settings</CardTitle></div>
              <CardDescription>Control how your landing page appears in search engines and social media previews.</CardDescription>
            </CardHeader>
            <CardContent><SeoForm {...formProps("seo")} /></CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SACmsPage;
