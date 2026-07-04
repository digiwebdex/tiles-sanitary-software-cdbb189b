import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { SIGNUP_TRIAL_DAYS } from "@/lib/trialConstants";
import { useCmsContent } from "@/hooks/useCmsContent";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  BarChart2, Package, ShoppingCart, Users, Truck, FileText,
  PieChart, Shield, Layers, CreditCard, Bell, Settings,
  CheckCircle2, Phone, Mail, MapPin, ArrowRight, Lock,
  Star, Zap, Server, Database, RefreshCw, UserCheck, Store,
  TrendingUp, LayoutDashboard, AlertCircle, Receipt, Sparkles,
  Globe, ExternalLink, ChevronRight, Play, Box, Menu, X, Building2,
} from "lucide-react";
import FloatingButtons from "@/components/FloatingButtons";

const ICON_MAP: Record<string, React.ElementType> = {
  BarChart2, Package, ShoppingCart, Users, Truck, FileText,
  PieChart, Shield, Layers, CreditCard, Bell, Settings,
};

const DEFAULTS = {
  hero: {
    title: "Simple, Smart & Secure ERP for Tiles and Sanitary Dealers",
    subtitle: "Manage Purchase, Sales, Stock, Credit, Profit & Reports — All in One Cloud System.",
    button_text: "Start Free Trial",
    button_link: "/get-started",
    extra_json: {
      badge: "🚀 #1 Tiles & Sanitary ERP in Bangladesh",
    },
  },
  features: {
    title: "Built for Tiles & Sanitary Professionals",
    subtitle: "Every module is designed around how dealers actually work — not generic business software.",
    extra_json: {
      items: [
        { icon: "Package", title: "Inventory Management", description: "Track stock levels by box, SFT, and piece. Set reorder alerts and monitor aging inventory in real time." },
        { icon: "ShoppingCart", title: "Sales & Invoicing", description: "Create sales invoices, manage credit limits, process returns and track outstanding dues with ease." },
        { icon: "Truck", title: "Purchase Management", description: "Record supplier purchases, calculate landed costs and maintain complete supplier ledgers." },
        { icon: "BarChart2", title: "Financial Reports", description: "Detailed P&L, cash flow, customer receivables, supplier payables and inventory valuation reports." },
        { icon: "Users", title: "Customer Ledger", description: "Full customer transaction history, credit tracking, overdue alerts and payment collection." },
        { icon: "Shield", title: "Role-Based Access", description: "Owner and salesman roles with granular permissions. Every action is audit-logged for security." },
      ],
    },
  },
  pricing: {
    title: "Simple, Transparent Pricing",
    subtitle: "No hidden fees. Cancel anytime.",
    extra_json: {},
  },
  footer: {
    title: "Tiles & Sanitary ERP",
    description: "The modern ERP platform for tiles and sanitary dealers.",
    extra_json: {
      phone: "+880 1674-533303",
      email: "support@tilesERP.com",
      address: "Dhaka, Bangladesh",
      copyright: `© ${new Date().getFullYear()} Tiles ERP. All rights reserved.`,
    },
  },
};

const SectionSkeleton = () => (
  <div className="space-y-4 py-12 px-4 max-w-4xl mx-auto">
    <Skeleton className="h-10 w-64 mx-auto bg-white/10" />
    <Skeleton className="h-5 w-96 mx-auto bg-white/10" />
    <div className="grid grid-cols-3 gap-4 mt-8">
      {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-xl bg-white/10" />)}
    </div>
  </div>
);

/* ─── NAV ─── */
const Navbar = ({ companyName }: { companyName: string }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-50 bg-[#0d1117]/90 backdrop-blur-xl border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/25">
            <Layers className="h-5 w-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-lg text-white tracking-tight">{companyName}</span>
            <span className="hidden sm:block text-[10px] uppercase tracking-[0.2em] text-gray-500 -mt-0.5">ERP Software</span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
          <a href="#features" className="hover:text-orange-400 transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-orange-400 transition-colors">How It Works</a>
          <a href="#pricing" className="hover:text-orange-400 transition-colors">Pricing</a>
          <a href="#security" className="hover:text-orange-400 transition-colors">Security</a>
          <a href="#contact" className="hover:text-orange-400 transition-colors">Contact</a>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/get-started">
            <Button size="sm" className="hidden sm:inline-flex bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white border-0 shadow-lg shadow-orange-500/20 font-semibold gap-1.5">
              Book a Demo <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <button className="md:hidden text-white" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="md:hidden border-t border-white/10 bg-[#0d1117] px-4 py-4 space-y-3">
          {["Features", "How It Works", "Pricing", "Security", "Contact"].map(item => (
            <a key={item} href={`#${item.toLowerCase().replace(/\s+/g, '-')}`} className="block text-sm text-gray-400 hover:text-orange-400" onClick={() => setMobileOpen(false)}>{item}</a>
          ))}
        </div>
      )}
    </nav>
  );
};

/* ─── HERO ─── */
const HeroSection = ({ cms }: { cms: typeof DEFAULTS.hero & { extra_json: any } }) => {
  const ex = cms.extra_json ?? {};
  return (
    <section className="relative overflow-hidden pt-20 pb-28 sm:pt-28 sm:pb-36 bg-[#0d1117]">
      {/* Gradient orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-orange-500/8 blur-[150px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-amber-500/5 blur-[100px]" />
        <div className="absolute top-1/2 left-0 w-[300px] h-[300px] rounded-full bg-orange-600/5 blur-[80px]" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center">
        {ex.badge && (
          <div className="inline-flex items-center gap-2 mb-8 px-5 py-2.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm">
            <span className="text-sm font-semibold text-gray-300">{ex.badge}</span>
          </div>
        )}

        <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold text-white leading-[1.08] tracking-tight mb-7">
          {(() => {
            const title = cms.title || "";
            const parts = title.split("ERP");
            if (parts.length > 1) {
              return parts.map((part, i, arr) =>
                i < arr.length - 1 ? (
                  <span key={i}>{part}<span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">ERP</span></span>
                ) : <span key={i}>{part}</span>
              );
            }
            // Highlight last 2-3 words
            const words = title.split(" ");
            const cutoff = Math.max(0, words.length - 3);
            return (
              <>
                {words.slice(0, cutoff).join(" ")}{" "}
                <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                  {words.slice(cutoff).join(" ")}
                </span>
              </>
            );
          })()}
        </h1>

        {cms.subtitle && (
          <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            {cms.subtitle}
          </p>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to={cms.button_link || "/get-started"}>
            <Button size="lg" className="gap-2 px-10 h-14 text-base font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white border-0 shadow-xl shadow-orange-500/25 rounded-xl">
              <Zap className="h-4 w-4" />
              {cms.button_text || "Start Free Trial"}
            </Button>
          </Link>
        </div>

        {/* Stats */}
        <div className="mt-20 flex flex-wrap justify-center gap-10 sm:gap-20">
          {[
            { value: "100+", label: "Active Dealers" },
            { value: "50K+", label: "Invoices Generated" },
            { value: "99.9%", label: "Uptime" },
            { value: "24/7", label: "Support" },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <div className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                {s.value}
              </div>
              <div className="text-sm text-gray-500 mt-1 font-medium">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ─── HOW IT WORKS ─── */
const HowItWorksSection = () => {
  const steps = [
    { num: "1", title: "Sign Up", desc: "Create account in 30 seconds" },
    { num: "2", title: "Add Products", desc: "Import or add your inventory" },
    { num: "3", title: "Start Selling", desc: "Create invoices instantly" },
    { num: "4", title: "Manage Stock", desc: "Real-time tracking" },
    { num: "5", title: "Collect Payments", desc: "Track dues & credit" },
    { num: "6", title: "View Reports", desc: "Full business insights" },
  ];

  return (
    <section id="how-it-works" className="py-24 bg-[#0f1419] relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-4 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            How It Works
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-4 tracking-tight">
            From Setup to Profit — <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">Simplified</span>
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            A complete workflow that mirrors how tiles & sanitary dealers actually operate.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {steps.map((step, i) => (
            <div key={i} className="relative group">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center hover:border-orange-500/40 hover:bg-orange-500/5 transition-all duration-300">
                <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-orange-500/20">
                  {step.num}
                </div>
                <h3 className="font-bold text-white text-sm mb-1">{step.title}</h3>
                <p className="text-xs text-gray-500">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ─── FEATURES ─── */
const FeaturesSection = ({ cms }: { cms: typeof DEFAULTS.features & { extra_json: any } }) => {
  const items: { icon: string; title: string; description: string }[] = cms.extra_json?.items ?? [];
  return (
    <section id="features" className="py-24 bg-[#0d1117] relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-4 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Features
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-4 tracking-tight">{cms.title}</h2>
          {cms.subtitle && <p className="text-gray-400 text-lg max-w-2xl mx-auto">{cms.subtitle}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((item, i) => {
            const Icon = ICON_MAP[item.icon] ?? Package;
            return (
              <div
                key={i}
                className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-7 hover:border-orange-500/30 hover:bg-orange-500/5 transition-all duration-300"
              >
                <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 group-hover:bg-gradient-to-br group-hover:from-amber-500 group-hover:to-orange-600 group-hover:shadow-lg group-hover:shadow-orange-500/25 transition-all duration-300">
                  <Icon className="h-6 w-6 text-orange-400 group-hover:text-white transition-colors duration-300" />
                </div>
                <h3 className="font-bold text-white mb-2 text-lg">{item.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

/* ─── WHY CHOOSE US ─── */
const WhyChooseUsSection = () => {
  const items = [
    { icon: LayoutDashboard, title: "Owner-Centric Dashboard", description: "Complete business overview — sales, purchases, stock, profit, and dues — on one screen." },
    { icon: Package, title: "Real-Time Stock Control", description: "Track inventory by Box and SFT simultaneously. Know stock before every sale." },
    { icon: AlertCircle, title: "Smart Credit Monitoring", description: "Set credit limits per customer, get overdue alerts automatically." },
    { icon: Receipt, title: "Profit Per Invoice", description: "See net profit on every sale including COGS, discount, and landed costs." },
    { icon: Bell, title: "Daily SMS & Email Summary", description: "Automated daily business summaries so you stay informed offline." },
    { icon: Database, title: "Automatic Google Drive Backup", description: "One-click Excel export plus nightly auto-backup to your own Google Drive — your data is always safe." },
    { icon: Store, title: "Online Store Ready", description: "Future-proof with built-in catalog and order management capabilities." },
  ];

  return (
    <section id="why-us" className="py-24 bg-[#0f1419]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-4 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Why Choose Us
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-4 tracking-tight">
            Built for Dealers, <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">Not Just Anyone</span>
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Every feature designed specifically for tiles and sanitary businesses.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((item, i) => (
            <div
              key={i}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-7 hover:border-orange-500/30 hover:bg-orange-500/5 transition-all duration-300"
            >
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 group-hover:bg-gradient-to-br group-hover:from-amber-500 group-hover:to-orange-600 group-hover:shadow-lg group-hover:shadow-orange-500/25 transition-all duration-300">
                <item.icon className="h-6 w-6 text-orange-400 group-hover:text-white transition-colors duration-300" />
              </div>
              <h3 className="font-bold text-white mb-2 text-lg">{item.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ─── TRUSTED & SECURE ─── */
const TrustedSecureSection = () => {
  const trustItems = [
    { icon: Server, title: "Enterprise Cloud Hosting", description: "High-performance VPS with 99.9% uptime SLA and global CDN." },
    { icon: Shield, title: "Bank-Level Encryption", description: "AES-256 encryption for all data at rest and in transit." },
    { icon: RefreshCw, title: "Daily Automated Backup", description: "30-day retention with point-in-time recovery." },
    { icon: Database, title: "Isolated Database", description: "Each dealer's data is fully isolated at the database level." },
    { icon: UserCheck, title: "Role-Based Access", description: "Granular permissions with complete audit trail on every action." },
  ];

  return (
    <section id="security" className="py-24 bg-[#0d1117]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-4 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Security
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-4 tracking-tight">
            Your Data is <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">Safe With Us</span>
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Enterprise-grade security so you can focus on growing your business.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
          {trustItems.slice(0, 3).map((item, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 flex flex-col gap-4 hover:border-orange-500/30 hover:bg-orange-500/5 transition-all duration-300">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10">
                <item.icon className="h-6 w-6 text-orange-400" />
              </div>
              <h3 className="font-bold text-white text-lg">{item.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl mx-auto lg:max-w-none lg:grid-cols-2 lg:px-[17%]">
          {trustItems.slice(3).map((item, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 flex flex-col gap-4 hover:border-orange-500/30 hover:bg-orange-500/5 transition-all duration-300">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10">
                <item.icon className="h-6 w-6 text-orange-400" />
              </div>
              <h3 className="font-bold text-white text-lg">{item.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>

        {/* Compliance banner */}
        <div className="mt-10 rounded-2xl bg-orange-500/5 border border-orange-500/20 px-8 py-7 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-6 w-6 text-orange-400" />
            </div>
            <div>
              <p className="font-bold text-white text-lg">Compliance Ready</p>
              <p className="text-sm text-gray-500">Complete audit trail — who did what, when, and from where.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ─── PRICING ─── */
const PRICING_PLANS = [
  {
    name: "Starter",
    highlighted: false,
    monthlyPrice: 999,
    yearlyPrice: 10000,
    features: [
      "Up to 5 users",
      "Full inventory management",
      "Sales & purchase tracking",
      "Customer & supplier ledger",
      "Basic reports & P/L",
      "Cashbook & day-end closing",
      "Email notifications",
      "Challan & invoice printing",
      "Excel backup & Google Drive auto-backup",
    ],
  },
  {
    name: "Pro",
    highlighted: true,
    monthlyPrice: 2000,
    yearlyPrice: 20000,
    features: [
      "Up to 8 users",
      "All Starter features",
      "Advanced analytics & dashboards",
      "Credit limit management",
      "Sales return & purchase return",
      "Stock movement tracking",
      "Customer follow-up & collections",
      "SMS + Email notifications",
      "Priority support",
    ],
  },
  {
    name: "Business",
    highlighted: false,
    monthlyPrice: 3000,
    yearlyPrice: 30000,
    features: [
      "Up to 20 users",
      "All Pro features",
      "Up to 10 branches & 5 warehouses",
      "Role-based access control",
      "Full audit logs",
      "Campaign & gift management",
      "Custom reports & exports",
      "Delivery management",
      "Dedicated account manager",
    ],
  },
  {
    name: "Premium Custom",
    highlighted: false,
    isPremium: true,
    monthlyPrice: 5000,
    yearlyPrice: 50000,
    features: [
      "Everything in Business",
      "Unlimited users & branches",
      "Unlimited warehouses",
      "All modules unlocked",
      "Custom feature config per dealer",
      "WhatsApp + SMS + Email",
      "HRM & advanced finance",
      "Dedicated account manager",
    ],
  },
];

const PricingSection = ({ cms }: { cms: typeof DEFAULTS.pricing & { extra_json: any } }) => {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="py-24 bg-[#0f1419]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-4 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Pricing
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-4 tracking-tight">{cms.title}</h2>
          {cms.subtitle && <p className="text-gray-400 text-lg max-w-2xl mx-auto">{cms.subtitle}</p>}
        </div>

        <div className="flex flex-col items-center gap-3 mb-14">
          <div className="inline-flex items-center gap-4 bg-white/5 border border-white/10 rounded-full px-6 py-3">
            <span className={`text-sm font-semibold transition-colors ${!yearly ? "text-white" : "text-gray-500"}`}>Monthly</span>
            <Switch checked={yearly} onCheckedChange={setYearly} className="data-[state=checked]:bg-orange-500" />
            <span className={`text-sm font-semibold transition-colors ${yearly ? "text-white" : "text-gray-500"}`}>Yearly</span>
          </div>
          <div className={`flex items-center gap-2 transition-all duration-300 ${yearly ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"}`}>
            <Sparkles className="h-4 w-4 text-orange-400" />
            <span className="text-sm font-semibold text-orange-400">Save 2 months with yearly billing</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 items-stretch max-w-7xl mx-auto">
          {PRICING_PLANS.map((plan, i) => {
            const isTrial = (plan as any).isTrial;
            const isPremium = (plan as any).isPremium;
            const price = isTrial ? 0 : (yearly ? plan.yearlyPrice : plan.monthlyPrice);
            const period = isTrial ? "" : (yearly ? "/year" : "/month");
            return (
              <div
                key={i}
                className={`relative rounded-2xl border-2 p-8 flex flex-col gap-6 transition-all ${
                  isPremium
                    ? "border-amber-500/60 bg-gradient-to-b from-amber-500/10 to-orange-600/5 shadow-2xl shadow-amber-500/10"
                    : plan.highlighted
                    ? "border-orange-500 bg-gradient-to-b from-orange-500/10 to-orange-600/5 shadow-2xl shadow-orange-500/10 scale-[1.02]"
                    : isTrial
                      ? "border-emerald-500/30 bg-gradient-to-b from-emerald-500/5 to-emerald-600/[0.02]"
                      : "border-white/10 bg-white/[0.03]"
                }`}
              >
                {isPremium && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-xs px-4 py-1 font-bold shadow-lg border-0">
                    <Sparkles className="h-3 w-3 mr-1" /> All Inclusive
                  </Badge>
                )}
                {plan.highlighted && !isPremium && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-500 to-orange-600 text-white text-xs px-4 py-1 font-bold shadow-lg border-0">
                    <Zap className="h-3 w-3 mr-1" /> Most Popular
                  </Badge>
                )}
                {isTrial && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs px-4 py-1 font-bold shadow-lg border-0">
                    <Play className="h-3 w-3 mr-1" /> Try Free
                  </Badge>
                )}
                <div>
                  <p className={`text-sm font-semibold mb-2 ${
                    isPremium ? "text-amber-400" : plan.highlighted ? "text-orange-400" : isTrial ? "text-emerald-400" : "text-gray-500"
                  }`}>{plan.name}</p>
                  <div className="flex items-end gap-1 mb-1">
                    {isTrial ? (
                      <span className="text-5xl font-extrabold leading-none tracking-tight text-white">Free</span>
                    ) : (
                      <>
                        <span className="text-sm font-bold text-white">৳</span>
                        <span className="text-5xl font-extrabold leading-none tracking-tight text-white">{price.toLocaleString()}</span>
                        <span className="text-sm mb-1 text-gray-500">{period}</span>
                      </>
                    )}
                  </div>
                  {isTrial ? (
                    <p className="text-xs mt-2 text-emerald-400/70 font-medium">{SIGNUP_TRIAL_DAYS} days • No payment required</p>
                  ) : yearly ? (
                    <Badge className="mt-2 text-[10px] px-2 py-0.5 gap-1 bg-gradient-to-r from-amber-500 to-orange-600 text-white border-0">
                      <Sparkles className="h-3 w-3" /> Save 2 months
                    </Badge>
                  ) : (
                    <p className="text-xs mt-2 text-gray-600">
                      Switch to yearly to save 2 months
                    </p>
                  )}
                </div>
                <ul className="space-y-3 flex-1">
                  {plan.features.map((feat, fi) => (
                    <li key={fi} className="flex items-start gap-2.5 text-sm">
                      <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${
                        isPremium ? "text-amber-400" : plan.highlighted ? "text-orange-400" : isTrial ? "text-emerald-400" : "text-orange-500/60"
                      }`} />
                      <span className="text-gray-300">{feat}</span>
                    </li>
                  ))}
                </ul>
                <Link to={isPremium ? "/contact" : "/get-started"}>
                  <Button className={`w-full h-12 rounded-xl font-semibold text-base border-0 ${
                    isPremium
                      ? "bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-white shadow-lg shadow-amber-500/20"
                      : plan.highlighted
                      ? "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-lg shadow-orange-500/20"
                      : isTrial
                        ? "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/20"
                        : "bg-white/10 hover:bg-white/15 text-white"
                  }`}>
                    {isTrial ? `Start ${SIGNUP_TRIAL_DAYS}-Day Trial` : isPremium ? "Contact Sales" : "Start Free Trial"}
                  </Button>
                </Link>
              </div>
            );
          })}
        </div>


        <p className="text-center text-sm text-gray-500 mt-8">
          <Link to="/pricing" className="underline underline-offset-4 hover:text-orange-400 transition-colors">
            View full pricing details →
          </Link>
        </p>
      </div>
    </section>
  );
};

/* ─── CTA BANNER ─── */
const CtaSection = ({ heroBtn }: { heroBtn: string; heroBtnLink: string }) => (
  <section className="py-24 bg-gradient-to-b from-[#0d1117] to-[#0f1419] relative overflow-hidden">
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-orange-500/10 blur-[150px]" />
    </div>
    <div className="relative max-w-3xl mx-auto px-4 text-center">
      <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-5 tracking-tight">
        Ready to modernise your business?
      </h2>
      <p className="text-gray-400 text-lg mb-10 max-w-xl mx-auto">
        Join hundreds of dealers already using our ERP to grow faster and manage smarter.
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
        <Link to="/get-started">
          <Button size="lg" className="gap-2 px-10 h-14 text-base font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white border-0 shadow-xl shadow-orange-500/25 rounded-xl">
            <Zap className="h-4 w-4" />
            {heroBtn || "Start Free Trial"}
          </Button>
        </Link>
      </div>
    </div>
  </section>
);

/* ─── FOOTER ─── */
const FooterSection = ({ cms }: { cms: typeof DEFAULTS.footer & { extra_json: any } }) => {
  const ex = cms.extra_json ?? {};
  return (
    <footer id="contact" className="bg-[#080b10] border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/25">
                <Layers className="h-5 w-5 text-white" />
              </div>
              <span className="font-bold text-lg text-white">{cms.title}</span>
            </div>
            {cms.description && (
              <p className="text-sm text-gray-500 leading-relaxed max-w-sm">{cms.description}</p>
            )}
          </div>

          {/* Links */}
          <div>
            <p className="font-bold text-sm text-white mb-4 uppercase tracking-wider">Company</p>
            <ul className="space-y-3 text-sm text-gray-500">
              {[
                { label: "Features", href: "#features" },
                { label: "Pricing", href: "#pricing" },
                { label: "Security", href: "#security" },
                { label: "Privacy Policy", href: "/privacy" },
                { label: "Terms", href: "/terms" },
              ].map(link => (
                <li key={link.href}>
                  <a href={link.href} className="hover:text-orange-400 transition-colors">{link.label}</a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <p className="font-bold text-sm text-white mb-4 uppercase tracking-wider">Contact</p>
            <ul className="space-y-3 text-sm text-gray-500">
              {ex.phone && (
                <li className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                    <Phone className="h-3.5 w-3.5 text-orange-400" />
                  </div>
                  <a href={`tel:${ex.phone}`} className="hover:text-orange-400 transition-colors">{ex.phone}</a>
                </li>
              )}
              {ex.email && (
                <li className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                    <Mail className="h-3.5 w-3.5 text-orange-400" />
                  </div>
                  <a href={`mailto:${ex.email}`} className="hover:text-orange-400 transition-colors">{ex.email}</a>
                </li>
              )}
              {ex.address && (
                <li className="flex items-start gap-2.5">
                  <div className="h-7 w-7 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                    <MapPin className="h-3.5 w-3.5 text-orange-400" />
                  </div>
                  <span>{ex.address}</span>
                </li>
              )}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-600">
            {ex.copyright || `© ${new Date().getFullYear()} Tiles ERP. All rights reserved.`}
          </p>
          <a
            href="https://digiwebdex.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-orange-400 transition-colors group"
          >
            Design & Development by{" "}
            <span className="font-semibold text-gray-400 group-hover:text-orange-400 transition-colors">
              digiwebdex.com
            </span>
            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </a>
        </div>
      </div>
    </footer>
  );
};

/* ─── MAIN LANDING PAGE ─── */
const LandingPage = () => {
  const { data: sections, isLoading } = useCmsContent();

  const hero     = { ...DEFAULTS.hero,     ...(sections?.hero     ?? {}), extra_json: { ...DEFAULTS.hero.extra_json,     ...(sections?.hero?.extra_json     ?? {}) } };
  const features = { ...DEFAULTS.features, ...(sections?.features ?? {}), extra_json: { ...DEFAULTS.features.extra_json, ...(sections?.features?.extra_json ?? {}) } };
  const pricing  = { ...DEFAULTS.pricing,  ...(sections?.pricing  ?? {}), extra_json: { ...DEFAULTS.pricing.extra_json,  ...(sections?.pricing?.extra_json  ?? {}) } };
  const footer   = { ...DEFAULTS.footer,   ...(sections?.footer   ?? {}), extra_json: { ...DEFAULTS.footer.extra_json,   ...(sections?.footer?.extra_json   ?? {}) } };

  // Scroll to anchor hash after page (and CMS content) has loaded
  useEffect(() => {
    if (isLoading) return;
    const hash = window.location.hash;
    if (!hash) return;
    const el = document.querySelector(hash);
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }, [isLoading]);

  if (isLoading) return (
    <div className="min-h-screen bg-[#0d1117]">
      <div className="h-16 border-b border-white/10" />
      {[1, 2, 3].map(i => <SectionSkeleton key={i} />)}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0d1117]">
      <Navbar companyName={footer.title || "Tiles ERP"} />
      <HeroSection cms={hero} />
      <HowItWorksSection />
      <FeaturesSection cms={features} />
      <WhyChooseUsSection />
      <TrustedSecureSection />
      <PricingSection cms={pricing} />
      <CtaSection heroBtn={hero.button_text || "Start Free Trial"} heroBtnLink={hero.button_link || "/get-started"} />
      <FooterSection cms={footer} />
      <FloatingButtons />
    </div>
  );
};

export default LandingPage;
