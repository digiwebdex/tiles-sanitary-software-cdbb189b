import { useState, useRef, useEffect } from "react";
import { SIGNUP_TRIAL_DAYS } from "@/lib/trialConstants";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { authBridge } from "@/lib/authBridge";
import {
  Layers, CheckCircle2, Loader2, Store, Shield, Zap, Package,
  BarChart2, Users, Eye, EyeOff, Phone, Mail, MessageSquare,
  ArrowLeft, ArrowRight, Building2, User, Lock, RefreshCw,
} from "lucide-react";
import { env } from "@/lib/env";

// ── Validation ────────────────────────────────────────────────────────────────

const BD_PHONE_RE = /^(?:\+?880|0)1[3-9]\d{8}$/;

const step1Schema = z.object({
  name: z.string().trim().min(2, "Full name must be at least 2 characters").max(100),
  business_name: z.string().trim().min(2, "Business name must be at least 2 characters").max(150),
});

const step2Schema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(255),
  phone: z.string().trim().refine((v) => BD_PHONE_RE.test(v), {
    message: "Enter a valid BD mobile number (e.g. 01XXXXXXXXX)",
  }),
});

const step3Schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").max(72)
    .regex(/[A-Za-z]/, "Include at least one letter")
    .regex(/\d/, "Include at least one number"),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, {
  message: "Passwords do not match",
  path: ["confirm"],
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const BENEFITS = [
  { icon: Package, text: "Full inventory management" },
  { icon: BarChart2, text: "Sales, purchase & profit reports" },
  { icon: Users, text: "Customer & supplier ledgers" },
  { icon: Shield, text: "Role-based access control" },
  { icon: Zap, text: "No setup fees, cancel anytime" },
  { icon: Store, text: "Multi-branch ready (Pro)" },
];

const VPS_URL = env.VPS_API_BASE ?? "";

async function apiPost<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${VPS_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Request failed (${res.status})`);
  return data as T;
}

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "8+ characters", ok: password.length >= 8 },
    { label: "Letter", ok: /[A-Za-z]/.test(password) },
    { label: "Number", ok: /\d/.test(password) },
    { label: "Symbol", ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const score = checks.filter((c) => c.ok).length;
  const color = score <= 1 ? "bg-red-500" : score === 2 ? "bg-amber-500" : score === 3 ? "bg-yellow-400" : "bg-emerald-500";
  const label = score <= 1 ? "Weak" : score === 2 ? "Fair" : score === 3 ? "Good" : "Strong";

  if (!password) return null;
  return (
    <div className="space-y-2 mt-1">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i < score ? color : "bg-white/10"}`} />
        ))}
      </div>
      <div className="flex gap-3 flex-wrap">
        {checks.map((c) => (
          <span key={c.label} className={`text-[10px] flex items-center gap-1 ${c.ok ? "text-emerald-400" : "text-gray-600"}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${c.ok ? "bg-emerald-400" : "bg-gray-600"}`} />
            {c.label}
          </span>
        ))}
        <span className={`text-[10px] font-semibold ml-auto ${score >= 3 ? "text-emerald-400" : "text-gray-500"}`}>{label}</span>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GetStartedPage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  // form state
  const [step, setStep] = useState<1 | 2 | 3 | "done">(1);
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState(["", "", "", "", "", ""]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // OTP digit refs for auto-focus
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const err = (field: string, msg: string) => setErrors((prev) => ({ ...prev, [field]: msg }));
  const clearErr = (field: string) => setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });

  // ── Step 1 submit ──
  const submitStep1 = () => {
    const r = step1Schema.safeParse({ name, business_name: businessName });
    if (!r.success) {
      const fe: Record<string, string> = {};
      r.error.issues.forEach((i) => { fe[i.path[0] as string] = i.message; });
      setErrors(fe);
      return;
    }
    setErrors({});
    setStep(2);
  };

  // ── Send WhatsApp OTP ──
  const sendOtp = async () => {
    const r = step2Schema.safeParse({ email, phone });
    if (!r.success) {
      const fe: Record<string, string> = {};
      r.error.issues.forEach((i) => { fe[i.path[0] as string] = i.message; });
      setErrors(fe);
      return;
    }
    setErrors({});
    setOtpLoading(true);
    try {
      await apiPost("/api/signup/send-otp", { phone });
      setOtpSent(true);
      setCooldown(60);
      setOtpCode(["", "", "", "", "", ""]);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
      toast({ title: "OTP sent!", description: "Check your WhatsApp for the 6-digit code." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to send OTP", description: e.message });
    } finally {
      setOtpLoading(false);
    }
  };

  // ── OTP digit input handler ──
  const handleOtpDigit = (idx: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const next = [...otpCode];
    next[idx] = digit;
    setOtpCode(next);
    clearErr("otp");
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus();
    if (!digit && idx > 0) otpRefs.current[idx - 1]?.focus();
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      setOtpCode(text.split(""));
      otpRefs.current[5]?.focus();
    }
  };

  // ── Verify OTP ──
  const verifyOtp = async () => {
    const code = otpCode.join("");
    if (code.length < 6) { err("otp", "Enter the complete 6-digit code"); return; }
    setVerifyLoading(true);
    try {
      const res = await apiPost<{ verify_token: string; phone: string }>(
        "/api/signup/verify-otp", { phone, otp: code }
      );
      setVerifyToken(res.verify_token);
      setVerifiedPhone(res.phone);
      setErrors({});
      toast({ title: "WhatsApp verified ✓", description: "Your number is confirmed." });
      setStep(3);
    } catch (e: any) {
      err("otp", e.message);
    } finally {
      setVerifyLoading(false);
    }
  };

  // ── Final submit ──
  const submitStep3 = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = step3Schema.safeParse({ password, confirm });
    if (!r.success) {
      const fe: Record<string, string> = {};
      r.error.issues.forEach((i) => { fe[i.path[0] as string] = i.message; });
      setErrors(fe);
      return;
    }
    if (!verifyToken) {
      toast({ variant: "destructive", title: "Phone not verified", description: "Please complete WhatsApp verification." });
      setStep(2);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const signupResult = await authBridge.signUp({
        name,
        business_name: businessName,
        phone: verifiedPhone || phone,
        email,
        password,
        whatsapp_verify_token: verifyToken,
      });
      if (!signupResult.success) throw new Error(signupResult.message || "Signup failed");
      // Tokens are stored — notify AuthContext then go straight to dashboard.
      window.dispatchEvent(new Event("vps-auth-change"));
      setStep("done");
      setTimeout(() => navigate("/dashboard", { replace: true }), 1200);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Signup failed", description: e.message });
    } finally {
      setLoading(false);
    }
  };

  // ── Step indicators ──
  const STEPS = [
    { n: 1, label: "Your Info" },
    { n: 2, label: "Verify WhatsApp" },
    { n: 3, label: "Set Password" },
  ];

  const currentStep = step === "done" ? 4 : step;

  // ── Done state ──────────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border border-emerald-500/20 bg-white/[0.03] p-8 text-center space-y-5">
          <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle2 className="h-9 w-9 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Account Created!</h1>
            <p className="text-emerald-400 font-semibold mt-1">You can log in right now ✓</p>
          </div>
          <p className="text-gray-400 leading-relaxed text-sm">
            Your <span className="text-white font-medium">{businessName}</span> account is active and ready. No waiting required — start managing your business immediately.
          </p>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-gray-500 text-left space-y-2">
            <p>📱 SMS & WhatsApp sent to <span className="text-gray-300">{verifiedPhone}</span></p>
            <p>📧 Welcome email sent to <span className="text-gray-300">{email}</span></p>
            <p>🎁 <span className="text-orange-400">{SIGNUP_TRIAL_DAYS}-day free trial</span> has started</p>
          </div>
          <div className="flex gap-3 pt-2">
            <Link to="/" className="flex-1">
              <Button variant="outline" className="w-full border-white/10 bg-white/5 text-white hover:bg-white/10">
                Home
              </Button>
            </Link>
            <Link to="/dashboard" className="flex-1">
              <Button className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white border-0 font-bold">
                Go to Dashboard →
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117]">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-[#0d1117]/90 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Layers className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-lg text-white">TilesERP</span>
          </Link>
          <Link to="/login">
            <Button size="sm" className="bg-white text-gray-900 hover:bg-gray-100 font-semibold border-0">Sign In</Button>
          </Link>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <div className="grid lg:grid-cols-5 gap-10 lg:gap-16 items-start">

          {/* Left — Benefits */}
          <div className="lg:col-span-2 space-y-8">
            <div>
              <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-orange-400 transition-colors mb-5">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to home
              </Link>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-3">
                Start for <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">Free</span>
              </h1>
              <p className="text-gray-400 leading-relaxed">
                <span className="text-orange-400 font-semibold">{SIGNUP_TRIAL_DAYS}-day free trial</span> — no credit card required.
              </p>
            </div>

            <div className="space-y-3">
              {BENEFITS.map((b, i) => (
                <div key={i} className="flex items-center gap-3 group">
                  <div className="h-9 w-9 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-orange-500/20 transition-colors">
                    <b.icon className="h-4 w-4 text-orange-400" />
                  </div>
                  <span className="text-gray-300 text-sm">{b.text}</span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-semibold text-white">Secure & Verified</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                We verify your WhatsApp number to ensure account security and send you important business notifications directly.
              </p>
            </div>
          </div>

          {/* Right — Form */}
          <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-white/[0.03] shadow-2xl shadow-black/20 backdrop-blur-sm overflow-hidden">

            {/* Step indicators */}
            <div className="border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-2">
                {STEPS.map((s, i) => {
                  const done = currentStep > s.n;
                  const active = currentStep === s.n;
                  return (
                    <div key={s.n} className="flex items-center gap-2 flex-1">
                      <div className={`flex items-center gap-2 ${active ? "opacity-100" : done ? "opacity-100" : "opacity-40"}`}>
                        <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${done ? "bg-emerald-500 text-white" : active ? "bg-orange-500 text-white" : "bg-white/10 text-gray-500"}`}>
                          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.n}
                        </div>
                        <span className={`text-xs font-medium hidden sm:block ${active ? "text-white" : done ? "text-emerald-400" : "text-gray-600"}`}>{s.label}</span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className={`h-px flex-1 mx-1 transition-all ${done ? "bg-emerald-500/50" : "bg-white/10"}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-6 sm:p-8">

              {/* ── STEP 1: Name + Business ── */}
              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-xl font-bold text-white">Tell us about yourself</h2>
                    <p className="text-sm text-gray-500 mt-1">Your personal and business details</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="text-sm font-medium text-gray-300 flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-orange-400" /> Full Name *
                      </Label>
                      <Input
                        id="name"
                        placeholder="Your full name"
                        value={name}
                        onChange={(e) => { setName(e.target.value); clearErr("name"); }}
                        className={`h-11 bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 ${errors.name ? "border-red-500" : ""}`}
                      />
                      {errors.name && <p className="text-xs text-red-400">{errors.name}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="business_name" className="text-sm font-medium text-gray-300 flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-orange-400" /> Business Name *
                      </Label>
                      <Input
                        id="business_name"
                        placeholder="e.g. ABC Tiles & Sanitary"
                        value={businessName}
                        onChange={(e) => { setBusinessName(e.target.value); clearErr("business_name"); }}
                        className={`h-11 bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 ${errors.business_name ? "border-red-500" : ""}`}
                      />
                      {errors.business_name && <p className="text-xs text-red-400">{errors.business_name}</p>}
                    </div>
                  </div>

                  <Button
                    onClick={submitStep1}
                    className="w-full h-12 font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white border-0 rounded-xl gap-2"
                  >
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>

                  <p className="text-xs text-gray-600 text-center">
                    Already have an account?{" "}
                    <Link to="/login" className="text-orange-400 hover:underline font-medium">Sign In</Link>
                  </p>
                </div>
              )}

              {/* ── STEP 2: Email + WhatsApp OTP ── */}
              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <button onClick={() => setStep(1)} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-400 mb-3 transition-colors">
                      <ArrowLeft className="h-3.5 w-3.5" /> Back
                    </button>
                    <h2 className="text-xl font-bold text-white">Contact & Verification</h2>
                    <p className="text-sm text-gray-500 mt-1">Verify your WhatsApp number to continue</p>
                  </div>

                  <div className="space-y-4">
                    {/* Email */}
                    <div className="space-y-1.5">
                      <Label htmlFor="email" className="text-sm font-medium text-gray-300 flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-orange-400" /> Email Address *
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); clearErr("email"); }}
                        disabled={otpSent}
                        className={`h-11 bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 disabled:opacity-50 ${errors.email ? "border-red-500" : ""}`}
                      />
                      {errors.email && <p className="text-xs text-red-400">{errors.email}</p>}
                    </div>

                    {/* Phone */}
                    <div className="space-y-1.5">
                      <Label htmlFor="phone" className="text-sm font-medium text-gray-300 flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-orange-400" /> WhatsApp / Mobile Number *
                      </Label>
                      <div className="flex gap-2">
                        <div className="flex items-center gap-2 h-11 px-3 rounded-lg border border-white/10 bg-white/5 text-gray-400 text-sm flex-shrink-0">
                          🇧🇩 <span className="text-gray-500">+880</span>
                        </div>
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="01XXXXXXXXX"
                          value={phone}
                          onChange={(e) => {
                            setPhone(e.target.value);
                            clearErr("phone");
                            if (otpSent) { setOtpSent(false); setOtpCode(["","","","","",""]); }
                          }}
                          disabled={otpSent}
                          className={`h-11 bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 disabled:opacity-50 ${errors.phone ? "border-red-500" : ""}`}
                        />
                      </div>
                      {errors.phone ? (
                        <p className="text-xs text-red-400">{errors.phone}</p>
                      ) : (
                        <p className="text-xs text-gray-600">Must be an active Bangladeshi number that uses WhatsApp</p>
                      )}
                    </div>

                    {/* Send OTP button */}
                    {!otpSent && (
                      <Button
                        onClick={sendOtp}
                        disabled={otpLoading || cooldown > 0}
                        className="w-full h-11 font-semibold bg-emerald-600 hover:bg-emerald-700 text-white border-0 rounded-xl gap-2"
                      >
                        {otpLoading ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Sending OTP…</>
                        ) : (
                          <><MessageSquare className="h-4 w-4" /> Send OTP via WhatsApp</>
                        )}
                      </Button>
                    )}

                    {/* OTP entry */}
                    {otpSent && (
                      <div className="space-y-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-white">OTP sent to WhatsApp</p>
                            <p className="text-xs text-gray-500">{phone} — enter the 6-digit code below</p>
                          </div>
                        </div>

                        <div className="flex gap-2 justify-center" onPaste={handleOtpPaste}>
                          {otpCode.map((d, i) => (
                            <input
                              key={i}
                              ref={(el) => { otpRefs.current[i] = el; }}
                              type="text"
                              inputMode="numeric"
                              maxLength={1}
                              value={d}
                              onChange={(e) => handleOtpDigit(i, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Backspace" && !d && i > 0) otpRefs.current[i - 1]?.focus();
                              }}
                              className="h-12 w-11 text-center text-lg font-bold rounded-lg border border-white/10 bg-white/5 text-white focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/20 transition-all"
                            />
                          ))}
                        </div>
                        {errors.otp && <p className="text-xs text-red-400 text-center">{errors.otp}</p>}

                        <Button
                          onClick={verifyOtp}
                          disabled={verifyLoading || otpCode.join("").length < 6}
                          className="w-full h-11 font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white border-0 rounded-xl gap-2"
                        >
                          {verifyLoading ? (
                            <><Loader2 className="h-4 w-4 animate-spin" /> Verifying…</>
                          ) : (
                            <><CheckCircle2 className="h-4 w-4" /> Verify OTP</>
                          )}
                        </Button>

                        <div className="flex items-center justify-between text-xs text-gray-600">
                          <span>Didn't receive it?</span>
                          <button
                            onClick={() => { setOtpSent(false); setOtpCode(["","","","","",""]); }}
                            className="text-orange-400 hover:underline flex items-center gap-1"
                            disabled={cooldown > 0}
                          >
                            {cooldown > 0 ? (
                              <><RefreshCw className="h-3 w-3" /> Resend in {cooldown}s</>
                            ) : (
                              <><RefreshCw className="h-3 w-3" /> Change number / Resend</>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── STEP 3: Password ── */}
              {step === 3 && (
                <form onSubmit={submitStep3} className="space-y-5">
                  <div>
                    <button type="button" onClick={() => { setStep(2); setOtpSent(false); setOtpCode(["","","","","",""]); }} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-400 mb-3 transition-colors">
                      <ArrowLeft className="h-3.5 w-3.5" /> Back
                    </button>
                    <h2 className="text-xl font-bold text-white">Set Your Password</h2>
                    <p className="text-sm text-gray-500 mt-1">Choose a strong password for your account</p>
                  </div>

                  {/* Verified badge */}
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                    <div className="text-xs">
                      <span className="text-emerald-400 font-medium">WhatsApp verified</span>
                      <span className="text-gray-500"> · {verifiedPhone}</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="password" className="text-sm font-medium text-gray-300 flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-orange-400" /> Password *
                      </Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPw ? "text" : "password"}
                          placeholder="Min 8 characters"
                          value={password}
                          onChange={(e) => { setPassword(e.target.value); clearErr("password"); }}
                          className={`h-11 pr-10 bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 ${errors.password ? "border-red-500" : ""}`}
                        />
                        <button type="button" tabIndex={-1} onClick={() => setShowPw(!showPw)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                          {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {errors.password && <p className="text-xs text-red-400">{errors.password}</p>}
                      <PasswordStrength password={password} />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="confirm" className="text-sm font-medium text-gray-300">Confirm Password *</Label>
                      <div className="relative">
                        <Input
                          id="confirm"
                          type={showConfirm ? "text" : "password"}
                          placeholder="Repeat your password"
                          value={confirm}
                          onChange={(e) => { setConfirm(e.target.value); clearErr("confirm"); }}
                          className={`h-11 pr-10 bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 ${errors.confirm ? "border-red-500" : ""}`}
                        />
                        <button type="button" tabIndex={-1} onClick={() => setShowConfirm(!showConfirm)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                          {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {errors.confirm && <p className="text-xs text-red-400">{errors.confirm}</p>}
                      {!errors.confirm && confirm && password === confirm && (
                        <p className="text-xs text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Passwords match
                        </p>
                      )}
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 text-base font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white border-0 rounded-xl gap-2"
                  >
                    {loading ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Creating Account…</>
                    ) : (
                      <><Zap className="h-4 w-4" /> Create My Account</>
                    )}
                  </Button>

                  <p className="text-xs text-gray-600 text-center">
                    By creating an account you agree to our{" "}
                    <Link to="/terms" className="underline hover:text-orange-400">Terms</Link> and{" "}
                    <Link to="/privacy" className="underline hover:text-orange-400">Privacy Policy</Link>.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
