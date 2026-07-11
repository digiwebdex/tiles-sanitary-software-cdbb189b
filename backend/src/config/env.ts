import { z } from 'zod';
import { loadBackendEnv } from './loadEnv';

loadBackendEnv();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().default(3003),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  BULKSMSBD_API_KEY: z.string().optional(),
  BULKSMSBD_API_URL: z.string().optional(),
  BULKSMSBD_SENDER_ID: z.string().optional(),
  // WhatsApp via WasenderAPI (https://wasenderapi.com). Token is a per-session
  // Bearer secret — keep it in .env, never in source.
  WASENDER_API_URL: z.string().optional(),
  WASENDER_API_TOKEN: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PHONE: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  APP_PUBLIC_URL: z.string().optional(),
  // P0: HMAC secret for signing one-shot /restore-local confirmation tokens.
  // Falls back to JWT_SECRET so existing deployments keep working, but
  // a dedicated secret is strongly recommended.
  RESTORE_TOKEN_SECRET: z.string().min(16).optional(),
  /** Phase 2: mirror legacy posts into posting_batches/lines (default off). */
  USE_POSTING_ENGINE: z.string().optional(),
  /** Phase 6: mirror posting_batches into GL journal (requires USE_POSTING_ENGINE). */
  USE_GL_SPINE: z.string().optional(),
  /**
   * V2 Sprint 1: server-side plan/feature enforcement mode.
   *   off     — middleware is a no-op.
   *   log     — resolve + log would-be blocks, but never block (DRY-RUN, default).
   *   enforce — block state-changing requests to features not in the dealer's plan.
   * Default 'log' so shipping the framework changes NO production behaviour.
   */
  FEATURE_ENFORCEMENT: z.enum(['off', 'log', 'enforce']).default('log'),
});

export const env = envSchema.parse(process.env);
