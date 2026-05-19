/**
 * Performance Reviews — Phase 16
 *
 *   GET    /api/performance                 ?period=&employee_id=
 *   GET    /api/performance/:id             (with kpis)
 *   POST   /api/performance                 { employee_id, period, reviewer?, kpis?: [...] }
 *   PUT    /api/performance/:id             header fields
 *   DELETE /api/performance/:id
 *   POST   /api/performance/:id/kpis        add KPI
 *   PUT    /api/performance/kpis/:kpiId     update KPI
 *   DELETE /api/performance/kpis/:kpiId
 *   POST   /api/performance/:id/finalize    recompute overall + grade, mark finalized
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate as requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(requireAuth);

function grade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

async function recomputeOverall(reviewId: string): Promise<{ overall: number; grade: string }> {
  const kpis = await db('performance_kpis').where({ review_id: reviewId });
  let totalWeight = 0;
  let weighted = 0;
  for (const k of kpis) {
    const w = Number(k.weight) || 0;
    const s = Number(k.score) || 0;
    totalWeight += w;
    weighted += (w * s);
  }
  const overall = totalWeight > 0 ? +(weighted / totalWeight).toFixed(2) : 0;
  const g = grade(overall);
  await db('performance_reviews').where({ id: reviewId }).update({
    overall_rating: overall, grade: g, updated_at: db.fn.now(),
  });
  return { overall, grade: g };
}

router.get('/', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const { period, employee_id } = req.query as { period?: string; employee_id?: string };
  let q = db('performance_reviews as r')
    .leftJoin('employees as e', 'r.employee_id', 'e.id')
    .select('r.*', 'e.name as employee_name', 'e.designation')
    .where('r.dealer_id', dealerId)
    .orderBy('r.period', 'desc')
    .orderBy('r.created_at', 'desc');
  if (period) q = q.where('r.period', period);
  if (employee_id) q = q.where('r.employee_id', employee_id);
  res.json(await q);
});

router.get('/:id', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const row = await db('performance_reviews as r')
    .leftJoin('employees as e', 'r.employee_id', 'e.id')
    .select('r.*', 'e.name as employee_name', 'e.designation')
    .where('r.id', req.params.id).andWhere('r.dealer_id', dealerId).first();
  if (!row) return res.status(404).json({ error: 'Not found' });
  const kpis = await db('performance_kpis').where({ review_id: row.id }).orderBy('created_at');
  res.json({ ...row, kpis });
});

const kpiSchema = z.object({
  kpi_name: z.string().min(1).max(120),
  weight: z.coerce.number().min(0).max(100),
  target: z.coerce.number(),
  achieved: z.coerce.number(),
  score: z.coerce.number().min(0).max(100),
  notes: z.string().nullable().optional(),
});

const reviewSchema = z.object({
  employee_id: z.string().uuid(),
  period: z.string().min(1).max(16),
  reviewer: z.string().max(120).nullable().optional(),
  strengths: z.string().nullable().optional(),
  improvements: z.string().nullable().optional(),
  comments: z.string().nullable().optional(),
  kpis: z.array(kpiSchema).optional(),
});

router.post('/', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { kpis, ...header } = parsed.data;
  try {
    const result = await db.transaction(async (trx) => {
      const [row] = await trx('performance_reviews')
        .insert({ ...header, dealer_id: dealerId, created_by: req.user!.userId })
        .returning('*');
      if (kpis && kpis.length) {
        await trx('performance_kpis').insert(kpis.map((k) => ({ ...k, review_id: row.id })));
      }
      return row;
    });
    if (kpis && kpis.length) await recomputeOverall(result.id);
    res.json(result);
  } catch (e: any) {
    if (String(e.message).includes('unique')) return res.status(409).json({ error: 'Review for this period already exists' });
    throw e;
  }
});

router.put('/:id', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = reviewSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { kpis, ...header } = parsed.data;
  const [row] = await db('performance_reviews')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...header, updated_at: db.fn.now() })
    .returning('*');
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const c = await db('performance_reviews').where({ id: req.params.id, dealer_id: dealerId }).delete();
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

router.post('/:id/kpis', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = kpiSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const review = await db('performance_reviews').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!review) return res.status(404).json({ error: 'Review not found' });
  const [row] = await db('performance_kpis').insert({ ...parsed.data, review_id: review.id }).returning('*');
  await recomputeOverall(review.id);
  res.json(row);
});

router.put('/kpis/:kpiId', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = kpiSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const kpi = await db('performance_kpis as k')
    .join('performance_reviews as r', 'k.review_id', 'r.id')
    .where('k.id', req.params.kpiId).andWhere('r.dealer_id', dealerId)
    .select('k.*').first();
  if (!kpi) return res.status(404).json({ error: 'Not found' });
  const [row] = await db('performance_kpis').where({ id: kpi.id }).update(parsed.data).returning('*');
  await recomputeOverall(kpi.review_id);
  res.json(row);
});

router.delete('/kpis/:kpiId', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const kpi = await db('performance_kpis as k')
    .join('performance_reviews as r', 'k.review_id', 'r.id')
    .where('k.id', req.params.kpiId).andWhere('r.dealer_id', dealerId)
    .select('k.*').first();
  if (!kpi) return res.status(404).json({ error: 'Not found' });
  await db('performance_kpis').where({ id: kpi.id }).delete();
  await recomputeOverall(kpi.review_id);
  res.json({ success: true });
});

router.post('/:id/finalize', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const review = await db('performance_reviews').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!review) return res.status(404).json({ error: 'Not found' });
  const { overall, grade: g } = await recomputeOverall(review.id);
  await db('performance_reviews').where({ id: review.id }).update({ status: 'finalized', updated_at: db.fn.now() });
  res.json({ success: true, overall_rating: overall, grade: g });
});

export default router;
