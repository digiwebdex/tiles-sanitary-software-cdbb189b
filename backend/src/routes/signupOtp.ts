/**
 * /api/signup — Public WhatsApp OTP verification for self-signup flow.
 *
 * POST /api/signup/send-otp    → generate & send 6-digit OTP via WhatsApp
 * POST /api/signup/verify-otp  → verify code, return a short-lived token
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db/connection';
import { sendWhatsApp } from '../services/notificationService';

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

/** Normalise a BD phone to +8801XXXXXXXXX */
function normalizeBdPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  // 01XXXXXXXXX  → prefix 880
  if (/^01[3-9]\d{8}$/.test(digits)) return `+880${digits.slice(1)}`;
  // 8801XXXXXXXXX
  if (/^8801[3-9]\d{8}$/.test(digits)) return `+${digits}`;
  // +8801XXXXXXXXX (stripped)
  if (/^8801[3-9]\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}

/** Validate Bangladesh mobile number (01X-XXXXXXXX format) */
function isBdPhone(raw: string): boolean {
  return normalizeBdPhone(raw) !== null;
}

function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function randomOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── rate limit: max 3 sends per phone per 10 minutes ─────────────────────────

async function checkSendLimit(phone: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = (await db('whatsapp_otp')
    .where('phone', phone)
    .where('created_at', '>=', cutoff)
    .count<{ count: string }>('id as count')
    .first()) ?? { count: '0' };
  return Number(count) < 3;
}

// ── POST /api/signup/send-otp ─────────────────────────────────────────────────

router.post('/send-otp', async (req: Request, res: Response) => {
  try {
    const { phone } = req.body as { phone?: string };

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    if (!isBdPhone(phone.trim())) {
      return res.status(400).json({
        error: 'Please enter a valid Bangladeshi mobile number (e.g. 01XXXXXXXXX)',
      });
    }

    const normalized = normalizeBdPhone(phone.trim())!;

    const withinLimit = await checkSendLimit(normalized);
    if (!withinLimit) {
      return res.status(429).json({
        error: 'Too many OTP requests. Please wait 10 minutes before trying again.',
      });
    }

    // Invalidate any previous unverified OTPs for this phone
    await db('whatsapp_otp')
      .where({ phone: normalized, verified: false })
      .update({ attempts: 5 }); // exhaust them

    const otp = randomOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await db('whatsapp_otp').insert({
      phone: normalized,
      otp_hash: sha256(otp),
      token: randomToken(), // placeholder; only issued after verify
      verified: false,
      attempts: 0,
      expires_at: expiresAt.toISOString(),
    });

    const text =
      `🔐 *TilesERP Verification Code*\n\n` +
      `Your OTP is: *${otp}*\n\n` +
      `Valid for 10 minutes. Do not share this code with anyone.\n\n` +
      `If you didn't request this, ignore this message.`;

    const sent = await sendWhatsApp({ to: normalized, text });

    if (!sent) {
      return res.status(502).json({
        error: 'Could not send WhatsApp message. Please check your number and try again.',
      });
    }

    return res.json({ ok: true, phone: normalized });
  } catch (err: any) {
    console.error('[signup/send-otp]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/signup/verify-otp ───────────────────────────────────────────────

router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body as { phone?: string; otp?: string };

    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone and OTP are required' });
    }

    const normalized = normalizeBdPhone(phone.trim());
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    if (!/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json({ error: 'OTP must be a 6-digit number' });
    }

    const now = new Date().toISOString();

    const record = await db('whatsapp_otp')
      .where({ phone: normalized, verified: false })
      .where('expires_at', '>', now)
      .where('attempts', '<', 5)
      .orderBy('created_at', 'desc')
      .first();

    if (!record) {
      return res.status(400).json({
        error: 'OTP expired or not found. Please request a new code.',
      });
    }

    // Increment attempt counter
    await db('whatsapp_otp').where('id', record.id).increment('attempts', 1);

    if (record.otp_hash !== sha256(otp.trim())) {
      const attemptsLeft = 4 - record.attempts;
      return res.status(400).json({
        error: attemptsLeft > 0
          ? `Incorrect OTP. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`
          : 'Too many incorrect attempts. Please request a new OTP.',
      });
    }

    // Issue a verification token valid for 30 minutes
    const verifyToken = randomToken();
    const tokenExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await db('whatsapp_otp').where('id', record.id).update({
      verified: true,
      token: verifyToken,
      expires_at: tokenExpiry,
    });

    return res.json({ ok: true, verify_token: verifyToken, phone: normalized });
  } catch (err: any) {
    console.error('[signup/verify-otp]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/signup/notify — called by Supabase edge function to fire WhatsApp ─

router.post('/notify', async (req: Request, res: Response) => {
  try {
    const secret = req.headers['x-internal-secret'];
    const expected = process.env.INTERNAL_SECRET;
    if (expected && secret !== expected) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { channel, to, text } = req.body as { channel?: string; to?: string; text?: string };
    if (channel === 'whatsapp' && to && text) {
      await sendWhatsApp({ to, text });
    }
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[signup/notify]', err);
    return res.status(500).json({ ok: false });
  }
});

// ── POST /api/signup/consume-token — called by Supabase edge function ─────────

router.post('/consume-token', async (req: Request, res: Response) => {
  try {
    const { token, phone } = req.body as { token?: string; phone?: string };
    if (!token || !phone) {
      return res.status(400).json({ ok: false, error: 'Missing token or phone' });
    }
    const normalized = normalizeBdPhone(phone.trim()) ?? phone.trim();
    const now = new Date().toISOString();
    const record = await db('whatsapp_otp')
      .where({ token, verified: true })
      .where(db.raw(`(phone = ? OR phone = ?)`, [phone.trim(), normalized]))
      .where('expires_at', '>', now)
      .first();
    if (!record) return res.json({ ok: false, error: 'Invalid or expired token' });
    // One-time use
    await db('whatsapp_otp').where('id', record.id).update({ expires_at: now });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[signup/consume-token]', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// ── POST /api/signup/contact — public contact form submission ─────────────────

router.post('/contact', async (req: Request, res: Response) => {
  try {
    const { name, business_name, phone, email, message } = req.body as {
      name?: string; business_name?: string; phone?: string; email?: string; message?: string;
    };
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email and message are required' });
    }
    await db('contact_submissions').insert({
      name: String(name).trim(),
      business_name: business_name ? String(business_name).trim() : null,
      phone: phone ? String(phone).trim() : null,
      email: String(email).trim().toLowerCase(),
      message: String(message).trim(),
      status: 'new',
    });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[signup/contact]', err);
    return res.status(500).json({ error: 'Submission failed' });
  }
});

export default router;
