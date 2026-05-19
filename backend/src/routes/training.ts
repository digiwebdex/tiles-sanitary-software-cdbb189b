/**
 * Training & Skill Matrix — Phase 17
 *
 * Skills catalog
 *   GET    /api/training/skills
 *   POST   /api/training/skills
 *   PUT    /api/training/skills/:id
 *   DELETE /api/training/skills/:id
 *
 * Employee skill matrix
 *   GET    /api/training/employee-skills?employee_id=&skill_id=
 *   POST   /api/training/employee-skills           upsert (employee_id+skill_id unique)
 *   PUT    /api/training/employee-skills/:id
 *   DELETE /api/training/employee-skills/:id
 *   GET    /api/training/matrix                    pivot: rows=employees, cols=skills
 *
 * Training programs
 *   GET    /api/training/programs
 *   GET    /api/training/programs/:id              (with enrollments)
 *   POST   /api/training/programs
 *   PUT    /api/training/programs/:id
 *   DELETE /api/training/programs/:id
 *
 * Enrollments
 *   POST   /api/training/programs/:id/enroll       { employee_ids: [...] }
 *   PUT    /api/training/enrollments/:enrollId
 *   DELETE /api/training/enrollments/:enrollId
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate as requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(requireAuth);

/* ============================ Skills ============================ */

const skillSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  category: z.string().max(60).nullable().optional(),
  description: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

router.get('/skills', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const rows = await db('skills').where({ dealer_id: dealerId }).orderBy('name');
  res.json(rows);
});

router.post('/skills', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = skillSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const [row] = await db('skills').insert({ ...parsed.data, dealer_id: dealerId }).returning('*');
    res.json(row);
  } catch (e: any) {
    if (String(e.message).includes('unique')) return res.status(409).json({ error: 'Skill code already exists' });
    throw e;
  }
});

router.put('/skills/:id', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = skillSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db('skills')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/skills/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const c = await db('skills').where({ id: req.params.id, dealer_id: dealerId }).delete();
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

/* ====================== Employee Skills ======================= */

const empSkillSchema = z.object({
  employee_id: z.string().uuid(),
  skill_id: z.string().uuid(),
  proficiency: z.coerce.number().int().min(1).max(5),
  last_assessed: z.string().nullable().optional(),
  assessed_by: z.string().max(120).nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.get('/employee-skills', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const { employee_id, skill_id } = req.query as { employee_id?: string; skill_id?: string };
  let q = db('employee_skills as es')
    .leftJoin('employees as e', 'es.employee_id', 'e.id')
    .leftJoin('skills as s', 'es.skill_id', 's.id')
    .select('es.*', 'e.name as employee_name', 'e.designation', 's.name as skill_name', 's.category as skill_category')
    .where('es.dealer_id', dealerId)
    .orderBy('e.name').orderBy('s.name');
  if (employee_id) q = q.where('es.employee_id', employee_id);
  if (skill_id) q = q.where('es.skill_id', skill_id);
  res.json(await q);
});

router.post('/employee-skills', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = empSkillSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  // Upsert on (employee_id, skill_id)
  const existing = await db('employee_skills')
    .where({ dealer_id: dealerId, employee_id: parsed.data.employee_id, skill_id: parsed.data.skill_id })
    .first();
  if (existing) {
    const [row] = await db('employee_skills')
      .where({ id: existing.id })
      .update({ ...parsed.data, updated_at: db.fn.now() })
      .returning('*');
    return res.json(row);
  }
  const [row] = await db('employee_skills').insert({ ...parsed.data, dealer_id: dealerId }).returning('*');
  res.json(row);
});

router.put('/employee-skills/:id', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = empSkillSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db('employee_skills')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/employee-skills/:id', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const c = await db('employee_skills').where({ id: req.params.id, dealer_id: dealerId }).delete();
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

router.get('/matrix', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const [employees, skills, rows] = await Promise.all([
    db('employees').where({ dealer_id: dealerId, is_active: true }).select('id', 'name', 'designation').orderBy('name'),
    db('skills').where({ dealer_id: dealerId, is_active: true }).select('id', 'code', 'name', 'category').orderBy('name'),
    db('employee_skills').where({ dealer_id: dealerId }).select('employee_id', 'skill_id', 'proficiency'),
  ]);
  const map: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!map[r.employee_id]) map[r.employee_id] = {};
    map[r.employee_id][r.skill_id] = Number(r.proficiency) || 0;
  }
  res.json({ employees, skills, matrix: map });
});

/* ====================== Training Programs ======================= */

const programSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  trainer: z.string().max(120).nullable().optional(),
  mode: z.enum(['in_person', 'online', 'hybrid']).optional(),
  duration_hours: z.coerce.number().min(0).optional(),
  cost: z.coerce.number().min(0).optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  status: z.enum(['planned', 'ongoing', 'completed', 'cancelled']).optional(),
});

router.get('/programs', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const { status } = req.query as { status?: string };
  let q = db('training_programs as p')
    .leftJoin(
      db('training_enrollments').select('program_id').count('* as enrolled').groupBy('program_id').as('e'),
      'p.id', 'e.program_id'
    )
    .select('p.*', db.raw('coalesce(e.enrolled, 0)::int as enrolled_count'))
    .where('p.dealer_id', dealerId)
    .orderBy('p.created_at', 'desc');
  if (status) q = q.where('p.status', status);
  res.json(await q);
});

router.get('/programs/:id', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const row = await db('training_programs').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!row) return res.status(404).json({ error: 'Not found' });
  const enrollments = await db('training_enrollments as en')
    .leftJoin('employees as e', 'en.employee_id', 'e.id')
    .select('en.*', 'e.name as employee_name', 'e.designation')
    .where('en.program_id', row.id)
    .orderBy('e.name');
  res.json({ ...row, enrollments });
});

router.post('/programs', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = programSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db('training_programs')
    .insert({ ...parsed.data, dealer_id: dealerId, created_by: req.user!.userId })
    .returning('*');
  res.json(row);
});

router.put('/programs/:id', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = programSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db('training_programs')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/programs/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const c = await db('training_programs').where({ id: req.params.id, dealer_id: dealerId }).delete();
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

/* ======================== Enrollments ========================= */

router.post('/programs/:id/enroll', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const Body = z.object({ employee_ids: z.array(z.string().uuid()).min(1) });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const program = await db('training_programs').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!program) return res.status(404).json({ error: 'Program not found' });

  const existing = await db('training_enrollments')
    .where({ program_id: program.id })
    .whereIn('employee_id', parsed.data.employee_ids)
    .pluck('employee_id');
  const skip = new Set(existing.map(String));
  const toInsert = parsed.data.employee_ids
    .filter((id) => !skip.has(id))
    .map((employee_id) => ({ dealer_id: dealerId, program_id: program.id, employee_id }));
  if (toInsert.length === 0) return res.json({ inserted: 0, skipped: skip.size });
  await db('training_enrollments').insert(toInsert);
  res.json({ inserted: toInsert.length, skipped: skip.size });
});

const enrollUpdateSchema = z.object({
  status: z.enum(['enrolled', 'in_progress', 'completed', 'dropped']).optional(),
  score: z.coerce.number().min(0).max(100).nullable().optional(),
  completed_date: z.string().nullable().optional(),
  certificate_url: z.string().max(500).nullable().optional(),
  feedback: z.string().nullable().optional(),
});

router.put('/enrollments/:enrollId', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = enrollUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db('training_enrollments')
    .where({ id: req.params.enrollId, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/enrollments/:enrollId', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const c = await db('training_enrollments').where({ id: req.params.enrollId, dealer_id: dealerId }).delete();
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

export default router;
