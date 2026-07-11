import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  CheckCircle2, XCircle, ArrowRight, Zap, Layers, Phone, Mail, MapPin,
  Users, Package, BarChart2, Bell, MessageCircle, ShieldCheck,
  TrendingUp, Sparkles, GitBranch, HeadphonesIcon, Building2, Database,
} from "lucide-react";

/* ─── NAV ─── */
const Navbar = () => (
  <nav className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <Link to="/" className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <Layers className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-bold text-foreground">Tiles & Sanitary ERP</span>
      </Link>
      <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
        <Link to="/#features" className="hover:text-foreground transition-colors">Features</Link>
        <Link to="/pricing" className="text-primary font-medium">Pricing</Link>
        <Link to="/#security" className="hover:text-foreground transition-colors">Security</Link>
        <Link to="/contact" className="hover:text-foreground transition-colors">Contact</Link>
      </div>
      <div className="flex items-center gap-2">
        <Link to="/login">
          <Button size="sm" variant="outline">Sign In</Button>
        </Link>
        <Link to="/get-started">
          <Button size="sm" className="gap-1.5">
            Get Started <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  </nav>
);

/* ─── FOOTER ─── */
const Footer = () => (
  <footer className="bg-card border-t border-border">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Layers className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">Tiles & Sanitary ERP</span>
          </div>
          <p className="text-sm text-muted-foreground">The modern ERP platform for tiles and sanitary dealers.</p>
        </div>
        <div>
          <p className="font-semibold text-sm text-foreground mb-3">Company</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {[
              { label: "Features", href: "/#features" },
              { label: "Pricing",  href: "/pricing" },
              { label: "Privacy",  href: "/privacy" },
              { label: "Terms",    href: "/terms" },
            ].map(l => (
              <li key={l.href}><Link to={l.href} className="hover:text-foreground transition-colors">{l.label}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-semibold text-sm text-foreground mb-3">Contact</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-primary" /><span>+880 1234-567890</span></li>
            <li className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-primary" /><span>support@yourdomain.com</span></li>
            <li className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-primary" /><span>Bangladesh</span></li>
          </ul>
        </div>
      </div>
      <div className="pt-6 border-t border-border text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Tiles ERP. All rights reserved.
      </div>
    </div>
  </footer>
);

/* ─── PLAN DATA ─── */
const PLANS = [
  {
    name: "Starter",
    tagline: "Perfect for small shops getting started",
    highlighted: false,
    badge: null,
    cta: "Get Started",
    ctaLink: "/get-started",
    monthlyPrice: 999,
    yearlyPrice: 10000,
    isPremium: false,
    features: [
      { icon: Users,       text: "Up to 5 users" },
      { icon: Package,     text: "Inventory management" },
      { icon: BarChart2,   text: "Basic reports" },
      { icon: ShieldCheck, text: "Customer ledger" },
      { icon: Mail,        text: "Email notifications" },
      { icon: Database,    text: "Excel backup & Google Drive auto-backup" },
    ],
  },
  {
    name: "Pro",
    tagline: "For growing businesses that need more",
    highlighted: true,
    badge: "Most Popular",
    cta: "Get Started",
    ctaLink: "/get-started",
    monthlyPrice: 2000,
    yearlyPrice: 20000,
    isPremium: false,
    features: [
      { icon: Users,           text: "Up to 8 users" },
      { icon: Package,         text: "All Starter features" },
      { icon: TrendingUp,      text: "Advanced analytics" },
      { icon: GitBranch,       text: "Multi-branch (3 branches)" },
      { icon: HeadphonesIcon,  text: "Priority support" },
      { icon: Mail,            text: "Email & SMS notifications" },
      { icon: MessageCircle,   text: "Backorders management" },
    ],
  },
  {
    name: "Business",
    tagline: "Full-featured for established businesses",
    highlighted: false,
    badge: null,
    cta: "Get Started",
    ctaLink: "/get-started",
    monthlyPrice: 3000,
    yearlyPrice: 30000,
    isPremium: false,
    features: [
      { icon: Users,           text: "Up to 20 users" },
      { icon: Package,         text: "All Pro features" },
      { icon: Building2,       text: "Up to 10 branches & 5 warehouses" },
      { icon: MessageCircle,   text: "WhatsApp notifications" },
      { icon: ShieldCheck,     text: "HRM module" },
      { icon: TrendingUp,      text: "Directors / Shareholder accounts" },
      { icon: Bell,            text: "Campaigns & marketing" },
    ],
  },
  {
    name: "Premium Custom",
    tagline: "All features + custom configuration per dealer",
    highlighted: false,
    badge: "All Inclusive",
    cta: "Contact Sales",
    ctaLink: "/contact",
    monthlyPrice: 5000,
    yearlyPrice: 50000,
    isPremium: true,
    features: [
      { icon: Sparkles,        text: "Everything in Business" },
      { icon: Building2,       text: "Unlimited branches & warehouses" },
      { icon: Users,           text: "Unlimited staff users" },
      { icon: ShieldCheck,     text: "Custom feature configuration" },
      { icon: HeadphonesIcon,  text: "Dedicated account manager" },
      { icon: MessageCircle,   text: "All notification channels" },
      { icon: TrendingUp,      text: "All modules unlocked" },
    ],
  },
];

/* ─── COMPARISON TABLE ─── */
const COMPARISON = [
  { feature: "Max Users",                 starter: "5",    pro: "8",    business: "20",        premium: "Unlimited" },
  { feature: "Warehouses",               starter: "1",    pro: "3",    business: "5",          premium: "Unlimited" },
  { feature: "Branches",                 starter: "1",    pro: "3",    business: "10",         premium: "Unlimited" },
  { feature: "Inventory Management",     starter: true,   pro: true,   business: true,         premium: true },
  { feature: "Excel Data Backup",         starter: true,   pro: true,   business: true,         premium: true },
  { feature: "Google Drive Auto-Backup",  starter: true,   pro: true,   business: true,         premium: true },
  { feature: "Customer Ledger",          starter: true,   pro: true,   business: true,         premium: true },
  { feature: "Email Notifications",      starter: true,   pro: true,   business: true,         premium: true },
  { feature: "SMS Notifications",        starter: false,  pro: true,   business: true,         premium: true },
  { feature: "WhatsApp Notifications",   starter: false,  pro: false,  business: true,         premium: true },
  { feature: "Advanced Analytics",       starter: false,  pro: true,   business: true,         premium: true },
  { feature: "Backorders",               starter: false,  pro: true,   business: true,         premium: true },
  { feature: "HRM Module",               starter: false,  pro: false,  business: true,         premium: true },
  { feature: "Campaigns & Marketing",    starter: false,  pro: false,  business: true,         premium: true },
  { feature: "Customer Portal",          starter: false,  pro: true,   business: true,         premium: true },
  { feature: "Directors / Shareholders", starter: false,  pro: false,  business: true,         premium: true },
  { feature: "Custom Feature Config",    starter: false,  pro: false,  business: false,        premium: true },
  { feature: "Dedicated Account Mgr",   starter: false,  pro: false,  business: false,        premium: true },
];

const CellValue = ({ val, highlighted }: { val: boolean | string; highlighted?: boolean }) => {
  if (val === true)  return <CheckCircle2 className={`h-5 w-5 mx-auto ${highlighted ? "text-blue-600" : "text-primary"}`} />;
  if (val === false) return <XCircle className="h-5 w-5 mx-auto text-muted-foreground/50" />;
  return <span className={`text-sm font-bold ${highlighted ? "text-blue-700 dark:text-blue-300" : "text-foreground"}`}>{val}</span>;
};

/* ─── MAIN PAGE ─── */
const PricingPage = () => {
  const [yearly, setYearly] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="py-20 text-center bg-gradient-to-br from-background via-muted/30 to-background border-b border-border">
        <div className="max-w-3xl mx-auto px-4">
          <Badge variant="outline" className="mb-4 px-3 py-1 text-xs">Pricing</Badge>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4 tracking-tight">
            Simple, Transparent Pricing
          </h1>
          <p className="text-lg text-muted-foreground mb-10">
            No hidden fees. No long-term contracts. Cancel anytime.
          </p>

          {/* Monthly / Yearly toggle */}
          <div className="inline-flex flex-col items-center gap-3">
            <div className="inline-flex items-center gap-4 bg-muted rounded-full px-6 py-3">
              <span className={`text-sm font-medium transition-colors ${!yearly ? "text-foreground" : "text-muted-foreground"}`}>
                Monthly
              </span>
              <Switch
                checked={yearly}
                onCheckedChange={setYearly}
                className="data-[state=checked]:bg-primary"
              />
              <span className={`text-sm font-medium transition-colors ${yearly ? "text-foreground" : "text-muted-foreground"}`}>
                Yearly
              </span>
            </div>
            <div className={`flex items-center gap-2 transition-all duration-300 ${yearly ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"}`}>
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-primary">
                Save 2 months with yearly billing
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 items-stretch">
            {PLANS.map((plan) => {
              const price = yearly ? plan.yearlyPrice : plan.monthlyPrice;
              const isHighlighted = plan.highlighted;
              const isPremium = plan.isPremium;

              return (
                <div
                  key={plan.name}
                  className={`relative rounded-2xl border p-6 flex flex-col gap-5 transition-all ${
                    isPremium
                      ? "border-amber-400 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 shadow-xl"
                      : isHighlighted
                      ? "border-primary bg-primary text-primary-foreground shadow-2xl scale-[1.02]"
                      : "border-border bg-card"
                  }`}
                >
                  {plan.badge && (
                    <Badge className={`absolute -top-3 left-1/2 -translate-x-1/2 text-xs px-3 gap-1 shadow-md ${
                      isPremium
                        ? "bg-amber-500 text-white border-amber-600"
                        : "bg-primary-foreground text-primary"
                    }`}>
                      {isPremium ? <Sparkles className="h-3 w-3" /> : <Zap className="h-3 w-3" />} {plan.badge}
                    </Badge>
                  )}

                  {/* Plan name + tagline */}
                  <div>
                    <p className={`text-xs font-semibold uppercase tracking-widest mb-1 ${
                      isPremium ? "text-amber-600 dark:text-amber-400" :
                      isHighlighted ? "text-primary-foreground/60" : "text-muted-foreground"
                    }`}>
                      {plan.name}
                    </p>
                    <p className={`text-sm mb-4 ${
                      isPremium ? "text-amber-800 dark:text-amber-300" :
                      isHighlighted ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}>
                      {plan.tagline}
                    </p>

                    {/* Price block */}
                    <div className="flex items-end gap-1 mb-1">
                      <span className={`text-sm font-semibold ${
                        isPremium ? "text-amber-700 dark:text-amber-400" :
                        isHighlighted ? "text-primary-foreground/80" : "text-foreground"
                      }`}>৳</span>
                      <span className={`text-4xl font-bold leading-none ${
                        isPremium ? "text-amber-900 dark:text-amber-100" : ""
                      }`}>{price.toLocaleString()}</span>
                      <span className={`text-sm mb-0.5 ${
                        isPremium ? "text-amber-600 dark:text-amber-400" :
                        isHighlighted ? "text-primary-foreground/60" : "text-muted-foreground"
                      }`}>
                        {yearly ? "/year" : "/month"}
                      </span>
                    </div>

                    {yearly ? (
                      <div className="flex items-center gap-2 mt-2">
                        <Badge className={`text-[10px] px-2 py-0.5 gap-1 ${
                          isPremium ? "bg-amber-500 text-white" :
                          isHighlighted ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
                        }`}>
                          <Sparkles className="h-3 w-3" /> Save 2 months
                        </Badge>
                      </div>
                    ) : (
                      <p className={`text-xs mt-1 ${
                        isPremium ? "text-amber-600 dark:text-amber-400" :
                        isHighlighted ? "text-primary-foreground/60" : "text-muted-foreground"
                      }`}>
                        Switch to yearly to save 2 months
                      </p>
                    )}
                  </div>

                  {/* Features list */}
                  <ul className="space-y-2 flex-1">
                    {plan.features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${
                          isPremium ? "text-amber-500" :
                          isHighlighted ? "text-primary-foreground/70" : "text-primary"
                        }`} />
                        <span className={
                          isPremium ? "text-amber-900 dark:text-amber-100" :
                          isHighlighted ? "text-primary-foreground/90" : "text-foreground"
                        }>{f.text}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <Link to={plan.ctaLink}>
                    <Button
                      className={`w-full h-11 ${isPremium ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-600" : ""}`}
                      variant={isHighlighted ? "secondary" : isPremium ? "default" : "default"}
                    >
                      {plan.cta}
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>

          {yearly && (
            <p className="text-center text-xs text-muted-foreground mt-6">
              * Yearly prices billed as a single annual payment.
            </p>
          )}
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-16 bg-muted/20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Compare Plans</h2>
            <p className="text-muted-foreground">See exactly what's included in each plan.</p>
          </div>

          <div className="rounded-2xl border border-border overflow-hidden bg-card overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="p-4 text-left text-sm font-semibold text-foreground w-1/3">Feature</th>
                  <th className="p-4 text-center text-sm font-semibold text-foreground">Starter</th>
                  <th className="p-4 text-center text-sm font-semibold bg-primary text-primary-foreground">Pro</th>
                  <th className="p-4 text-center text-sm font-semibold text-foreground">Business</th>
                  <th className="p-4 text-center text-sm font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">Premium</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr key={i} className={`border-b border-border last:border-0 ${i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}>
                    <td className="p-4 text-sm text-foreground">{row.feature}</td>
                    <td className="p-4 text-center"><CellValue val={row.starter} /></td>
                    <td className="p-4 text-center bg-blue-50 dark:bg-blue-950/25"><CellValue val={row.pro} highlighted /></td>
                    <td className="p-4 text-center"><CellValue val={row.business} /></td>
                    <td className="p-4 text-center bg-amber-50/50 dark:bg-amber-950/20"><CellValue val={row.premium} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Payment Methods */}
      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">পেমেন্ট মাধ্যম / Payment Methods</h2>
            <p className="text-muted-foreground">সাবস্ক্রিপশন পেমেন্ট করতে নিচের যেকোনো মাধ্যম ব্যবহার করুন</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Phone className="h-5 w-5 text-primary" />
                <h3 className="font-bold text-foreground">মোবাইল ব্যাংকিং</h3>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
                  <div>
                    <p className="font-semibold text-foreground">bKash / Nagad (Personal)</p>
                    <p className="text-muted-foreground text-xs">Send Money</p>
                  </div>
                  <span className="font-mono font-bold text-foreground text-base">01674533303</span>
                </div>
                <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
                  <div>
                    <p className="font-semibold text-foreground">Rocket</p>
                    <p className="text-muted-foreground text-xs">Send Money</p>
                  </div>
                  <span className="font-mono font-bold text-foreground text-base">016745333033</span>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="h-5 w-5 text-primary" />
                <h3 className="font-bold text-foreground">ব্যাংক ট্রান্সফার</h3>
              </div>
              <div className="bg-muted/50 rounded-lg px-4 py-3 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Account Name</span><span className="font-semibold text-foreground">Md. Iqbal Hossain</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Account Type</span><span className="text-foreground">Savings Account</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">A/C No.</span><span className="font-mono font-bold text-foreground">2706101077904</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Routing No.</span><span className="font-mono text-foreground">175260162</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Bank</span><span className="font-semibold text-foreground">Pubali Bank Limited</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Branch</span><span className="text-foreground text-right text-xs">Asad Avenue, Mohammadpur, Dhaka-1207</span></div>
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-4">পেমেন্ট করার পর অবশ্যই Transaction ID সহ আমাদের জানান</p>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Frequently Asked Questions</h2>
          </div>
          <div className="space-y-4">
            {[
              { q: "How does yearly billing work?", a: "When you choose yearly billing, you pay for 10 months and get 12 — effectively saving 2 months compared to monthly billing. Billed as a single annual payment." },
              { q: "Can I change plans later?", a: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect at the start of the next billing period." },
              { q: "Is there a free trial?", a: "Yes! Every new dealer gets a 7-day free trial after account approval so you can complete a full purchase → sale → collection cycle before paying." },
              { q: "What payment methods are accepted?", a: "Mobile Banking: bKash/Nagad (Personal) — 01674533303, Rocket — 016745333033. Bank Transfer: Md. Iqbal Hossain, Savings A/C 2706101077904, Routing 175260162, Pubali Bank Ltd, Asad Avenue, Mohammadpur, Dhaka-1207." },
              { q: "What does Multi-branch ready mean?", a: "Pro plan supports managing multiple store locations or branches from a single dashboard, with consolidated reporting." },
              { q: "Is my data safe?", a: "Absolutely. All data is encrypted, backed up daily, and isolated per dealer account with role-based access control." },
            ].map((faq, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5">
                <p className="font-semibold text-foreground mb-2">{faq.q}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Sales */}
      <section id="contact-sales" className="py-20 bg-gradient-to-br from-amber-500 to-orange-500">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <Sparkles className="h-12 w-12 text-white/80 mx-auto mb-4" />
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Premium Custom Plan
          </h2>
          <p className="text-white/80 text-lg mb-8">
            Get every feature unlocked at ৳5,000/month. We customise individual modules — turn on/off exactly what your business needs.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="mailto:support@yourdomain.com">
              <Button size="lg" variant="secondary" className="gap-2 px-8 h-12 text-base">
                <Mail className="h-4 w-4" /> Email Sales
              </Button>
            </a>
            <a href="tel:+8801674533303">
              <Button size="lg" variant="outline" className="gap-2 px-8 h-12 text-base border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10">
                <Phone className="h-4 w-4" /> Call Us
              </Button>
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default PricingPage;
