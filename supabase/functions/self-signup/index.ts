import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper to create notification record and invoke send-notification
async function sendNotification(
  client: any,
  opts: { dealer_id: string; channel: "sms" | "email"; type: string; recipient: string; message: string; subject?: string }
) {
  const { data: notif } = await client.from("notifications").insert({
    dealer_id: opts.dealer_id,
    channel: opts.channel,
    type: opts.type,
    status: "pending",
    payload: { _custom_message: opts.message, ...(opts.subject ? { _subject: opts.subject } : {}) },
  }).select("id").single();

  if (!notif) return;

  try {
    await client.functions.invoke("send-notification", {
      body: {
        notification_id: notif.id,
        dealer_id: opts.dealer_id,
        channel: opts.channel,
        type: opts.type,
        payload: { _custom_message: opts.message },
        recipient: opts.recipient,
      },
    });
  } catch (err) {
    console.error(`[sendNotification] Failed ${opts.channel} to ${opts.recipient}:`, err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { name, business_name, phone, email, password, whatsapp_verify_token } = body;

    // ── Validate inputs ──
    if (!name || typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      return new Response(JSON.stringify({ error: "Invalid name" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!business_name || typeof business_name !== "string" || business_name.trim().length === 0 || business_name.length > 150) {
      return new Response(JSON.stringify({ error: "Invalid business name" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!phone || typeof phone !== "string" || phone.trim().length < 6 || phone.length > 20) {
      return new Response(JSON.stringify({ error: "Invalid phone number" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email) || email.length > 255) {
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!password || typeof password !== "string" || password.length < 8 || password.length > 72) {
      return new Response(JSON.stringify({ error: "Password must be 8-72 characters" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // ── Verify WhatsApp OTP token (required) ──
    if (!whatsapp_verify_token || typeof whatsapp_verify_token !== "string") {
      return new Response(JSON.stringify({ error: "WhatsApp verification is required. Please verify your number before signing up." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const vpsUrl = Deno.env.get("VPS_API_URL");
    if (vpsUrl) {
      try {
        const verifyRes = await fetch(`${vpsUrl}/api/signup/consume-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: whatsapp_verify_token, phone: phone.trim() }),
        });
        const verifyBody = await verifyRes.json().catch(() => ({}));
        if (!verifyRes.ok || !verifyBody.ok) {
          return new Response(JSON.stringify({ error: "WhatsApp verification token is invalid or expired. Please verify your number again." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (verifyErr) {
        console.error("[self-signup] WhatsApp token verify failed:", verifyErr);
        // non-blocking if VPS is unreachable — log and continue
      }
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Check if email already exists ──
    const { data: existingUsers } = await serviceClient.auth.admin.listUsers();
    const emailLower = email.trim().toLowerCase();
    const alreadyExists = existingUsers?.users?.some(
      (u: any) => u.email?.toLowerCase() === emailLower
    );
    if (alreadyExists) {
      return new Response(JSON.stringify({ error: "An account with this email already exists. Please sign in." }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 1. Create dealer (ACTIVE — self-signup is auto-approved) ──
    const { data: dealer, error: dealerErr } = await serviceClient
      .from("dealers")
      .insert({
        name: business_name.trim(),
        phone: phone.trim(),
        status: "active",
      })
      .select("id")
      .single();

    if (dealerErr || !dealer) {
      console.error("Dealer creation error:", dealerErr);
      return new Response(JSON.stringify({ error: "Failed to create dealer" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. Create auth user ──
    const { data: newUser, error: createErr } = await serviceClient.auth.admin.createUser({
      email: emailLower,
      password,
      email_confirm: true,
      user_metadata: { name: name.trim() },
    });

    if (createErr || !newUser?.user) {
      // Rollback dealer
      await serviceClient.from("dealers").delete().eq("id", dealer.id);
      console.error("User creation error:", createErr);
      return new Response(JSON.stringify({ error: createErr?.message || "Failed to create user" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = newUser.user.id;

    // ── 3. Update profile with dealer_id ──
    const { error: profileErr } = await serviceClient
      .from("profiles")
      .update({ dealer_id: dealer.id, name: name.trim() })
      .eq("id", userId);

    if (profileErr) {
      console.error("Profile update error:", profileErr);
      await serviceClient.auth.admin.deleteUser(userId);
      await serviceClient.from("dealers").delete().eq("id", dealer.id);
      return new Response(JSON.stringify({ error: "Failed to provision user profile" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 4. Assign dealer_admin role ──
    const { error: roleErr } = await serviceClient
      .from("user_roles")
      .upsert({ user_id: userId, role: "dealer_admin" }, { onConflict: "user_id,role" });

    if (roleErr) {
      console.error("Role insert error:", roleErr);
      await serviceClient.auth.admin.deleteUser(userId);
      await serviceClient.from("dealers").delete().eq("id", dealer.id);
      return new Response(JSON.stringify({ error: "Failed to assign account role" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 5. Create invoice sequence ──
    await serviceClient
      .from("invoice_sequences")
      .insert({ dealer_id: dealer.id });

    // ── 6. Get Starter plan and create trial subscription (7 days) ──
    const TRIAL_DAYS = 7;
    const { data: plan } = await serviceClient
      .from("subscription_plans")
      .select("id")
      .eq("name", "Starter")
      .eq("is_active", true)
      .single();

    if (plan) {
      const startDate = new Date().toISOString().split("T")[0];
      const endDate = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const { error: subscriptionErr } = await serviceClient.from("subscriptions").insert({
        dealer_id: dealer.id,
        plan_id: plan.id,
        status: "active",
        billing_cycle: "monthly",
        start_date: startDate,
        end_date: endDate,
      });

      if (subscriptionErr) {
        console.error("Subscription creation error:", subscriptionErr);
        await serviceClient.auth.admin.deleteUser(userId);
        await serviceClient.from("dealers").delete().eq("id", dealer.id);
        return new Response(JSON.stringify({ error: "Failed to create trial subscription" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      console.error("Starter plan not found during self-signup");
      await serviceClient.auth.admin.deleteUser(userId);
      await serviceClient.from("dealers").delete().eq("id", dealer.id);
      return new Response(JSON.stringify({ error: "Starter plan is not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 6b. Create default notification settings ──
    await serviceClient.from("notification_settings").insert({
      dealer_id: dealer.id,
      enable_sale_sms: true,
      enable_sale_email: true,
      enable_daily_summary_sms: true,
      enable_daily_summary_email: true,
      owner_email: emailLower,
      owner_phone: phone.trim(),
    });

    // ── 7. Log as contact submission for SA tracking ──
    await serviceClient.from("contact_submissions").insert({
      name: name.trim(),
      business_name: business_name.trim(),
      phone: phone.trim(),
      email: emailLower,
      message: `Auto-signup: ${business_name.trim()}`,
      status: "auto_provisioned",
    });

    // ── 8. Send SMS + Email + WhatsApp to dealer AND admin (all 3 channels) ──
    try {
      const TRIAL_DAYS = 7;
      const DEFAULT_ADMIN_EMAIL = "digiwebdex@gmail.com";
      const DEFAULT_ADMIN_PHONE = "+8801674533303";
      const adminPhone = Deno.env.get("ADMIN_PHONE") || DEFAULT_ADMIN_PHONE;
      const envAdminEmail = Deno.env.get("ADMIN_EMAIL");
      let adminEmail: string = envAdminEmail || DEFAULT_ADMIN_EMAIL;

      // Try to get SA email from DB
      const { data: saRoles } = await serviceClient.from("user_roles").select("user_id").eq("role", "super_admin");
      if (saRoles && saRoles.length > 0) {
        const { data: saProfile } = await serviceClient.from("profiles").select("email").eq("id", saRoles[0].user_id).single();
        if (saProfile?.email && !envAdminEmail) adminEmail = saProfile.email;
      }

      // ── Message bodies ──
      const dealerSms =
        `স্বাগতম ${name.trim()}!\n` +
        `"${business_name.trim()}" অ্যাকাউন্ট সক্রিয় হয়েছে।\n` +
        `${TRIAL_DAYS} দিনের ফ্রি ট্রায়াল শুরু হয়েছে।\n` +
        `লগইন করুন: https://sanitileserp.com/login\n` +
        `TilesERP`;

      const dealerWhatsApp =
        `✅ *স্বাগতম TilesERP-তে!*\n\n` +
        `প্রিয় ${name.trim()},\n` +
        `আপনার *"${business_name.trim()}"* ব্যবসার অ্যাকাউন্ট সফলভাবে তৈরি ও সক্রিয় হয়েছে!\n\n` +
        `📦 *পরিকল্পনা:* Starter (${TRIAL_DAYS}-দিন ফ্রি ট্রায়াল)\n` +
        `📧 *ইমেইল:* ${emailLower}\n` +
        `📱 *ফোন:* ${phone.trim()}\n\n` +
        `🔗 লগইন করুন: https://sanitileserp.com/login\n\n` +
        `যেকোনো সমস্যায় আমাদের সাথে যোগাযোগ করুন।\n` +
        `— TilesERP Team`;

      const dealerEmailSubject = `✅ আপনার TilesERP অ্যাকাউন্ট সক্রিয় হয়েছে — ${business_name.trim()}`;
      const dealerEmailBody =
        `Dear ${name.trim()},\n\n` +
        `Your business account has been created and is ACTIVE!\n\n` +
        `Account Details:\n` +
        `  Business : ${business_name.trim()}\n` +
        `  Email    : ${emailLower}\n` +
        `  Phone    : ${phone.trim()}\n` +
        `  Plan     : Starter (${TRIAL_DAYS}-day free trial)\n` +
        `  Status   : ✅ Active — you can log in now\n\n` +
        `Login at: https://sanitileserp.com/login\n\n` +
        `Best regards,\nTiles & Sanitary ERP Team`;

      const adminSms =
        `🆕 নতুন ডিলার!\n` +
        `নাম: ${name.trim()}\n` +
        `ব্যবসা: ${business_name.trim()}\n` +
        `ফোন: ${phone.trim()}\n` +
        `ইমেইল: ${emailLower}\n` +
        `Status: Active (Trial)`;

      const adminWhatsApp =
        `🆕 *নতুন ডিলার রেজিস্ট্রেশন!*\n\n` +
        `👤 *নাম:* ${name.trim()}\n` +
        `🏪 *ব্যবসা:* ${business_name.trim()}\n` +
        `📱 *ফোন:* ${phone.trim()}\n` +
        `📧 *ইমেইল:* ${emailLower}\n` +
        `📦 *পরিকল্পনা:* Starter Trial\n` +
        `✅ *স্ট্যাটাস:* Active\n` +
        `📅 *তারিখ:* ${new Date().toLocaleDateString("bn-BD")}\n\n` +
        `Super Admin: https://sanitileserp.com/super-admin`;

      const adminEmailSubject = `🆕 New Dealer — ${business_name.trim()} (Active)`;
      const adminEmailBody =
        `New Dealer Self-Signup — Account is LIVE\n\n` +
        `Owner     : ${name.trim()}\n` +
        `Business  : ${business_name.trim()}\n` +
        `Phone     : ${phone.trim()}\n` +
        `Email     : ${emailLower}\n` +
        `Plan      : Starter (${TRIAL_DAYS}-day trial)\n` +
        `Status    : Active\n` +
        `Date      : ${new Date().toISOString().split("T")[0]}\n\n` +
        `Manage at: https://sanitileserp.com/super-admin/dealers`;

      // ── Fire all via VPS backend (handles SMS/WhatsApp/Email directly) ──
      const vpsUrl = Deno.env.get("VPS_API_URL") || "https://api.sanitileserp.com";
      const notifyVps = async (payload: object) => {
        try {
          await fetch(`${vpsUrl}/api/signup/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Internal-Secret": Deno.env.get("INTERNAL_SECRET") || "" },
            body: JSON.stringify(payload),
          });
        } catch (e) {
          console.error("[self-signup] VPS notify failed:", e);
        }
      };

      await Promise.all([
        // Dealer — SMS
        sendNotification(serviceClient, { dealer_id: dealer.id, channel: "sms", type: "new_signup", recipient: phone.trim(), message: dealerSms }),
        // Dealer — Email
        sendNotification(serviceClient, { dealer_id: dealer.id, channel: "email", type: "new_signup", recipient: emailLower, subject: dealerEmailSubject, message: dealerEmailBody }),
        // Dealer — WhatsApp (via VPS)
        notifyVps({ channel: "whatsapp", to: phone.trim(), text: dealerWhatsApp }),
        // Admin — SMS
        sendNotification(serviceClient, { dealer_id: dealer.id, channel: "sms", type: "new_signup", recipient: adminPhone, message: adminSms }),
        // Admin — Email
        sendNotification(serviceClient, { dealer_id: dealer.id, channel: "email", type: "new_signup", recipient: adminEmail, subject: adminEmailSubject, message: adminEmailBody }),
        // Admin — WhatsApp (via VPS)
        notifyVps({ channel: "whatsapp", to: adminPhone, text: adminWhatsApp }),
      ]);

      console.log("[Self-signup] All notifications dispatched");
    } catch (notifErr) {
      console.error("[Self-signup] Notification error (non-blocking):", notifErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        active: true,
        user_id: userId,
        dealer_id: dealer.id,
        message: "Account created and activated. You can now log in.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Self-signup error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
