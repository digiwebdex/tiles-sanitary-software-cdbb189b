import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services/authService';
import { authenticate } from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(72),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const emailSchema = z.object({
  email: z.string().email().max(255),
});

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(6).max(72),
});

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  business_name: z.string().trim().min(1).max(150),
  phone: z.string().trim().min(6).max(20),
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(72),
});

function getIp(req: Request): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.ip;
}

// GET /api/auth/lock-status?email=...  — pre-login check (matches old Supabase RPC)
router.get('/lock-status', async (req: Request, res: Response) => {
  try {
    const email = String(req.query.email ?? '').trim();
    if (!email) {
      res.json({ locked: false, remaining_attempts: 3 });
      return;
    }
    const status = await authService.checkLock(email);
    res.json(status);
  } catch {
    res.json({ locked: false });
  }
});

// POST /api/auth/register — public self-signup (creates account in PENDING state).
// No tokens are returned: the user must wait for Super Admin approval before
// they can log in. The frontend reads `pending: true` and shows the
// "Awaiting approval" success screen.
router.post('/register', async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);
    const result = await authService.register({ ...data, ip: getIp(req) });

    res.status(201).json({
      success: true,
      pending: true,
      message: 'Account created. Awaiting Super Admin approval before you can log in.',
      user_id: result.userId,
      dealer_id: result.dealerId,
    });
  } catch (err: any) {
    if (err.code === 'EMAIL_TAKEN') {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    if (err?.issues) {
      res.status(400).json({ error: 'Invalid signup data', issues: err.issues });
      return;
    }
    console.error('[register] failed:', err);
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const result = await authService.login(email, password, getIp(req));

    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      lock: result.lock,
    });
  } catch (err: any) {
    const code = err.code as string | undefined;
    const lock = err.lock;

    if (code === 'LOCKED') {
      res.status(423).json({ error: err.message, code, lock });
      return;
    }
    if (code === 'INVALID_CREDENTIALS') {
      res.status(401).json({ error: err.message, code, lock });
      return;
    }
    if (code === 'PENDING_APPROVAL') {
      res.status(403).json({ error: err.message, code });
      return;
    }
    if (code === 'SUSPENDED') {
      res.status(403).json({ error: err.message, code });
      return;
    }
    // Invalid request body — return a clean message + field issues instead of
    // leaking the raw stringified Zod error as the `error` string.
    if (err?.name === 'ZodError') {
      res.status(400).json({
        error: 'Invalid login request',
        issues: err.flatten?.() ?? err.issues,
      });
      return;
    }
    res.status(400).json({ error: err.message || 'Login failed' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const result = await authService.refreshTokens(refreshToken);

    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ error: 'Invalid refresh request', issues: err.flatten?.() ?? err.issues });
      return;
    }
    res.status(401).json({
      error: err.message || 'Token refresh failed',
      code: err.code,
    });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    await authService.logout(refreshToken);
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

// POST /api/auth/logout-all (requires authentication)
router.post('/logout-all', authenticate, async (req: Request, res: Response) => {
  try {
    await authService.logoutAll(req.user!.userId);
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await authService.getUserPayload(req.user!.userId);
    res.json({ user });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load account' });
  }
});

// POST /api/auth/password-reset/request
// Always returns success (no enumeration). When SMTP is wired the route can
// dispatch the email; for now it returns the token in dev mode only.
router.post('/password-reset/request', async (req: Request, res: Response) => {
  try {
    const { email } = emailSchema.parse(req.body);
    const result = await authService.requestPasswordReset(email);

    const payload: any = { success: true };
    if (result && process.env.NODE_ENV !== 'production') {
      // Dev-only convenience so QA can complete the flow without SMTP.
      payload.devToken = result.token;
    }
    res.json(payload);
  } catch {
    res.json({ success: true });
  }
});

// POST /api/auth/password-reset/confirm
router.post('/password-reset/confirm', async (req: Request, res: Response) => {
  try {
    const { token, password } = resetSchema.parse(req.body);
    await authService.resetPassword(token, password);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Invalid reset request' });
  }
});

export default router;
