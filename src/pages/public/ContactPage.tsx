import { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Layers, ArrowRight, Phone, Mail, MapPin,
  MessageCircle, CheckCircle2, Send, Clock, Building2,
} from "lucide-react";
import { env } from "@/lib/env";

/* ─── Validation schema ─── */
const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name too long"),
  business_name: z.string().trim().max(150, "Business name too long").optional(),
  phone: z.string().trim().max(20, "Phone too long").optional(),
  email: z.string().trim().email("Invalid email address").max(255, "Email too long"),
  message: z.string().trim().min(5, "Message must be at least 5 characters").max(2000, "Message too long"),
});

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
        <Link to="/#features"  className="hover:text-foreground transition-colors">Features</Link>
        <Link to="/pricing"    className="hover:text-foreground transition-colors">Pricing</Link>
        <Link to="/#security"  className="hover:text-foreground transition-colors">Security</Link>
        <Link to="/contact"    className="text-primary font-medium">Contact</Link>
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

/* ─── CONTACT INFO CARDS ─── */
const INFO_CARDS = [
  {
    icon: Phone,
    label: "Phone",
    value: "+880 1674-533303",
    href: "tel:+8801674533303",
    note: "Available 9am – 6pm (BD Time)",
  },
  {
    icon: Mail,
    label: "Email",
    value: "support@yourdomain.com",
    href: "mailto:support@yourdomain.com",
    note: "We reply within 2 business hours",
  },
  {
    icon: MapPin,
    label: "Office",
    value: "Bangladesh",
    href: null,
    note: "Serving dealers nationwide",
  },
];

/* ─── MAIN PAGE ─── */
const ContactPage = () => {
  const [form, setForm] = useState({
    name: "",
    business_name: "",
    phone: "",
    email: "",
    message: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: "" }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Client-side validation
    const result = contactSchema.safeParse(form);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach(err => {
        if (err.path[0]) fieldErrors[String(err.path[0])] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${env.VPS_API_BASE}/api/signup/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Submission failed");
      setSubmitted(true);
    } catch (err: any) {
      setErrors({ form: err.message || "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="py-16 text-center bg-gradient-to-br from-background via-muted/30 to-background border-b border-border">
        <div className="max-w-3xl mx-auto px-4">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mb-6 mx-auto">
            <MessageCircle className="h-7 w-7 text-primary" />
          </div>
          <Badge variant="outline" className="mb-4 px-3 py-1 text-xs">Contact Us</Badge>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4 tracking-tight">
            Get In Touch
          </h1>
          <p className="text-muted-foreground text-lg">
            Have a question about our ERP? We'd love to hear from you. Send us a message and we'll respond within 2 business hours.
          </p>
        </div>
      </section>

      {/* Contact Info Cards */}
      <section className="py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-12">
            {INFO_CARDS.map((card, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-6 text-center hover:border-primary/40 hover:shadow-md transition-all">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-4 mx-auto">
                  <card.icon className="h-6 w-6 text-primary" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">{card.label}</p>
                {card.href ? (
                  <a href={card.href} className="font-semibold text-foreground hover:text-primary transition-colors block mb-1">
                    {card.value}
                  </a>
                ) : (
                  <p className="font-semibold text-foreground mb-1">{card.value}</p>
                )}
                <p className="text-xs text-muted-foreground">{card.note}</p>
              </div>
            ))}
          </div>

          {/* Form + Side info */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">

            {/* Side info */}
            <div className="lg:col-span-2 space-y-6">
              <div>
                <h2 className="text-xl font-bold text-foreground mb-2">Why Contact Us?</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Whether you're interested in a free trial, need a product demo, have billing questions, or need technical support — our team is ready to help.
                </p>
              </div>

              <div className="space-y-3">
                {[
                  { icon: CheckCircle2, text: "Free demo for your business" },
                  { icon: CheckCircle2, text: "Custom plan consultation" },
                  { icon: CheckCircle2, text: "Technical support & onboarding" },
                  { icon: CheckCircle2, text: "Billing & subscription queries" },
                  { icon: CheckCircle2, text: "Partnership opportunities" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <item.icon className="h-4 w-4 text-primary shrink-0" />
                    {item.text}
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-muted/40 border border-border p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Office Hours</span>
                </div>
                <p className="text-xs text-muted-foreground">Saturday – Thursday: 9:00 AM – 6:00 PM</p>
                <p className="text-xs text-muted-foreground">Friday: Closed</p>
                <p className="text-xs text-muted-foreground mt-1">(Bangladesh Standard Time, UTC+6)</p>
              </div>

              <div className="rounded-xl bg-muted/40 border border-border p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Head Office</span>
                </div>
                <p className="text-xs text-muted-foreground">Tiles & Sanitary ERP</p>
                <p className="text-xs text-muted-foreground">Bangladesh</p>
              </div>
            </div>

            {/* Form */}
            <div className="lg:col-span-3">
              {submitted ? (
                <div className="rounded-2xl border border-border bg-card p-10 text-center h-full flex flex-col items-center justify-center gap-4">
                  <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-2">
                    <CheckCircle2 className="h-8 w-8 text-primary" />
                  </div>
                  <h2 className="text-2xl font-bold text-foreground">Message Sent!</h2>
                  <p className="text-muted-foreground max-w-sm">
                    Thank you for reaching out. Our team will get back to you within 2 business hours.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => { setSubmitted(false); setForm({ name: "", business_name: "", phone: "", email: "", message: "" }); }}
                  >
                    Send Another Message
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-6 sm:p-8 space-y-5">
                  <h2 className="text-xl font-bold text-foreground mb-2">Send Us a Message</h2>

                  {errors.form && (
                    <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                      {errors.form}
                    </div>
                  )}

                  {/* Name + Business Name */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Your Name <span className="text-destructive">*</span></Label>
                      <Input
                        id="name"
                        name="name"
                        placeholder="e.g. Rahim Uddin"
                        value={form.name}
                        onChange={handleChange}
                        maxLength={100}
                        className={errors.name ? "border-destructive" : ""}
                      />
                      {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="business_name">Business Name</Label>
                      <Input
                        id="business_name"
                        name="business_name"
                        placeholder="e.g. Rahim Tiles & Sanitary"
                        value={form.business_name}
                        onChange={handleChange}
                        maxLength={150}
                        className={errors.business_name ? "border-destructive" : ""}
                      />
                      {errors.business_name && <p className="text-xs text-destructive">{errors.business_name}</p>}
                    </div>
                  </div>

                  {/* Phone + Email */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Phone Number</Label>
                      <Input
                        id="phone"
                        name="phone"
                        type="tel"
                        placeholder="+880 1X XX-XXXXXX"
                        value={form.phone}
                        onChange={handleChange}
                        maxLength={20}
                        className={errors.phone ? "border-destructive" : ""}
                      />
                      {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email Address <span className="text-destructive">*</span></Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        placeholder="you@example.com"
                        value={form.email}
                        onChange={handleChange}
                        maxLength={255}
                        className={errors.email ? "border-destructive" : ""}
                      />
                      {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                    </div>
                  </div>

                  {/* Message */}
                  <div className="space-y-1.5">
                    <Label htmlFor="message">Your Message <span className="text-destructive">*</span></Label>
                    <Textarea
                      id="message"
                      name="message"
                      placeholder="Tell us how we can help you…"
                      value={form.message}
                      onChange={handleChange}
                      rows={5}
                      maxLength={2000}
                      className={`resize-none ${errors.message ? "border-destructive" : ""}`}
                    />
                    <div className="flex justify-between">
                      {errors.message
                        ? <p className="text-xs text-destructive">{errors.message}</p>
                        : <span />
                      }
                      <p className="text-xs text-muted-foreground text-right">{form.message.length}/2000</p>
                    </div>
                  </div>

                  <Button type="submit" disabled={loading} className="w-full gap-2 h-11">
                    <Send className="h-4 w-4" />
                    {loading ? "Sending…" : "Send Message"}
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    By submitting this form, you agree to our{" "}
                    <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default ContactPage;
