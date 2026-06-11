/**
 * Project Reports — VPS migration phase 3J-2 (reads only).
 *
 * Mirrors src/services/projectReportService.ts:
 *   GET /api/reports/projects/sales?dealerId=
 *   GET /api/reports/projects/outstanding?dealerId=
 *   GET /api/reports/projects/delivery-history?dealerId=
 *   GET /api/reports/projects/quotation-pipeline?dealerId=
 *   GET /api/reports/projects/top-active?dealerId=&limit=
 *   GET /api/reports/projects/site-summary?dealerId=&siteId=
 *   GET /api/reports/projects/site-history?dealerId=&siteId=
 *   GET /api/reports/projects/dashboard?dealerId=
 *
 * Dealer-scoped, financial → dealer_admin/super_admin only.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { hasRole } from '../middleware/roles';
import { buildProjectOutstandingRows } from '../services/reportQueryService';

const router = Router();
router.use(authenticate, tenantGuard);

const toNum = (v: any) => Number(v ?? 0) || 0;
const todayStr = () => new Date().toISOString().split('T')[0];
function daysBetween(fromDate: string, toDate: string): number {
  const a = new Date(fromDate + 'T00:00:00').getTime();
  const b = new Date(toDate + 'T00:00:00').getTime();
  return Math.floor((b - a) / 86400000);
}

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || undefined;
  if (isSuper) {
    if (!claimed) {
      res.status(400).json({ error: 'super_admin must specify dealerId' });
      return null;
    }
    return claimed;
  }
  if (!req.dealerId) {
    res.status(403).json({ error: 'No dealer assigned to your account' });
    return null;
  }
  if (claimed && claimed !== req.dealerId) {
    res.status(403).json({ error: 'dealerId mismatch' });
    return null;
  }
  return req.dealerId;
}

function requireFinancialRole(req: Request, res: Response): boolean {
  if (hasRole(req, 'dealer_admin') || hasRole(req, 'super_admin')) return true;
  res.status(403).json({ error: 'Reports require dealer_admin role' });
  return false;
}

interface ProjectMeta {
  id: string;
  project_name: string;
  project_code: string;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  max_overdue_days: number | null;
}

async function loadProjectsMeta(dealerId: string): Promise<Map<string, ProjectMeta>> {
  const rows = await db('projects as p')
    .leftJoin('customers as c', 'c.id', 'p.customer_id')
    .where('p.dealer_id', dealerId)
    .select(
      'p.id', 'p.project_name', 'p.project_code', 'p.status',
      'p.customer_id', 'c.name as customer_name', 'c.max_overdue_days'
    );
  const m = new Map<string, ProjectMeta>();
  for (const r of rows as any[]) {
    m.set(r.id, {
      id: r.id,
      project_name: r.project_name,
      project_code: r.project_code,
      status: r.status,
      customer_id: r.customer_id,
      customer_name: r.customer_name,
      max_overdue_days: r.max_overdue_days,
    });
  }
  return m;
}

// ── 1. Sales by project ──────────────────────────────────────
router.get('/sales', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  try {
    const projects = await loadProjectsMeta(dealerId);
    const sales = await db('sales')
      .where({ dealer_id: dealerId })
      .whereNotNull('project_id')
      .select('project_id', 'total_amount', 'due_amount');

    const agg = new Map<string, { count: number; total: number; due: number }>();
    for (const r of sales as any[]) {
      const cur = agg.get(r.project_id) ?? { count: 0, total: 0, due: 0 };
      cur.count += 1;
      cur.total += toNum(r.total_amount);
      cur.due += toNum(r.due_amount);
      agg.set(r.project_id, cur);
    }

    const rows: any[] = [];
    for (const [pid, v] of agg.entries()) {
      const p = projects.get(pid);
      if (!p) continue;
      rows.push({
        project_id: pid,
        project_name: p.project_name,
        project_code: p.project_code,
        customer_name: p.customer_name ?? '—',
        invoice_count: v.count,
        total_sales: v.total,
        outstanding: v.due,
      });
    }
    res.json(rows.sort((a, b) => b.total_sales - a.total_sales));
  } catch (err) {
    console.error('[projects.sales]', err);
    res.status(500).json({ error: 'Failed to load project sales' });
  }
});

// ── 2. Outstanding by project ────────────────────────────────
router.get('/outstanding', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  try {
    const projects = await loadProjectsMeta(dealerId);
    const rows = await buildProjectOutstandingRows(dealerId, projects, todayStr());
    res.json(rows);
  } catch (err) {
    console.error('[projects.outstanding]', err);
    res.status(500).json({ error: 'Failed to load project outstanding' });
  }
});

// ── 3. Delivery history by site ──────────────────────────────
router.get('/delivery-history', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  try {
    const sites = await db('project_sites as ps')
      .leftJoin('projects as p', 'p.id', 'ps.project_id')
      .leftJoin('customers as c', 'c.id', 'ps.customer_id')
      .where('ps.dealer_id', dealerId)
      .select(
        'ps.id', 'ps.site_name', 'ps.address', 'ps.project_id',
        'p.project_name', 'p.project_code',
        'c.name as customer_name'
      );

    const [challans, deliveries] = await Promise.all([
      db('challans').where({ dealer_id: dealerId }).whereNotNull('site_id').select('site_id', 'status'),
      db('deliveries').where({ dealer_id: dealerId }).whereNotNull('site_id').select('site_id', 'status', 'delivery_date'),
    ]);

    const challanMap = new Map<string, number>();
    for (const c of challans as any[]) challanMap.set(c.site_id, (challanMap.get(c.site_id) ?? 0) + 1);

    const dStat = new Map<string, { total: number; pending: number; latest: string | null }>();
    for (const d of deliveries as any[]) {
      const cur = dStat.get(d.site_id) ?? { total: 0, pending: 0, latest: null };
      cur.total += 1;
      if (d.status !== 'delivered') cur.pending += 1;
      const dDate = d.delivery_date ? (typeof d.delivery_date === 'string' ? d.delivery_date : new Date(d.delivery_date).toISOString().split('T')[0]) : null;
      if (dDate && (!cur.latest || dDate > cur.latest)) cur.latest = dDate;
      dStat.set(d.site_id, cur);
    }

    const rows = (sites as any[]).map((s) => {
      const ds = dStat.get(s.id);
      return {
        site_id: s.id,
        site_name: s.site_name,
        site_address: s.address ?? null,
        project_name: s.project_name ?? '—',
        project_code: s.project_code ?? '—',
        project_id: s.project_id,
        customer_name: s.customer_name ?? '—',
        challan_count: challanMap.get(s.id) ?? 0,
        delivery_count: ds?.total ?? 0,
        pending_deliveries: ds?.pending ?? 0,
        latest_delivery_date: ds?.latest ?? null,
      };
    }).sort((a, b) => (b.latest_delivery_date ?? '').localeCompare(a.latest_delivery_date ?? ''));

    res.json(rows);
  } catch (err) {
    console.error('[projects.delivery-history]', err);
    res.status(500).json({ error: 'Failed to load delivery history' });
  }
});

// ── 4. Quotation pipeline ────────────────────────────────────
router.get('/quotation-pipeline', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  try {
    const projects = await loadProjectsMeta(dealerId);
    const quotes = await db('quotations')
      .where({ dealer_id: dealerId })
      .whereNotNull('project_id')
      .select('project_id', 'status', 'total_amount');

    const agg = new Map<string, { count: number; active: number; converted: number; lost: number }>();
    for (const r of quotes as any[]) {
      const cur = agg.get(r.project_id) ?? { count: 0, active: 0, converted: 0, lost: 0 };
      cur.count += 1;
      const amt = toNum(r.total_amount);
      if (r.status === 'active' || r.status === 'draft') cur.active += amt;
      else if (r.status === 'converted') cur.converted += amt;
      else if (['expired', 'cancelled', 'revised'].includes(r.status)) cur.lost += amt;
      agg.set(r.project_id, cur);
    }

    const rows: any[] = [];
    for (const [pid, v] of agg.entries()) {
      const p = projects.get(pid);
      if (!p) continue;
      rows.push({
        project_id: pid,
        project_name: p.project_name,
        project_code: p.project_code,
        customer_name: p.customer_name ?? '—',
        quote_count: v.count,
        active_value: v.active,
        converted_value: v.converted,
        expired_lost_value: v.lost,
      });
    }
    res.json(rows.sort((a, b) => b.active_value - a.active_value));
  } catch (err) {
    console.error('[projects.quotation-pipeline]', err);
    res.status(500).json({ error: 'Failed to load quotation pipeline' });
  }
});

// ── 5. Top active projects ───────────────────────────────────
router.get('/top-active', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '10', 10)));

  try {
    const top = await topActiveProjects(dealerId, limit);
    res.json(top);
  } catch (err) {
    console.error('[projects.top-active]', err);
    res.status(500).json({ error: 'Failed to load top active projects' });
  }
});

async function topActiveProjects(dealerId: string, limit: number) {
  const projects = await loadProjectsMeta(dealerId);
  const [sales, challans, deliveries] = await Promise.all([
    db('sales').where({ dealer_id: dealerId }).whereNotNull('project_id').select('project_id', 'total_amount'),
    db('challans').where({ dealer_id: dealerId }).whereNotNull('project_id').select('project_id'),
    db('deliveries').where({ dealer_id: dealerId }).whereNotNull('project_id').select('project_id'),
  ]);

  const stat = new Map<string, { activity: number; value: number }>();
  for (const r of sales as any[]) {
    const cur = stat.get(r.project_id) ?? { activity: 0, value: 0 };
    cur.activity += 1; cur.value += toNum(r.total_amount);
    stat.set(r.project_id, cur);
  }
  for (const r of challans as any[]) {
    const cur = stat.get(r.project_id) ?? { activity: 0, value: 0 };
    cur.activity += 1;
    stat.set(r.project_id, cur);
  }
  for (const r of deliveries as any[]) {
    const cur = stat.get(r.project_id) ?? { activity: 0, value: 0 };
    cur.activity += 1;
    stat.set(r.project_id, cur);
  }

  const rows: any[] = [];
  for (const [pid, v] of stat.entries()) {
    const p = projects.get(pid);
    if (!p) continue;
    rows.push({
      project_id: pid,
      project_name: p.project_name,
      project_code: p.project_code,
      customer_name: p.customer_name ?? '—',
      activity_count: v.activity,
      total_value: v.value,
    });
  }
  return rows
    .sort((a, b) => b.total_value - a.total_value || b.activity_count - a.activity_count)
    .slice(0, limit);
}

// ── 6. Site summary ──────────────────────────────────────────
router.get('/site-summary', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const siteId = (req.query.siteId as string | undefined) || undefined;
  if (!siteId) { res.status(400).json({ error: 'siteId required' }); return; }

  try {
    const [sales, quotes, challans, deliveries, site] = await Promise.all([
      db('sales').where({ dealer_id: dealerId, site_id: siteId }).select('id', 'total_amount', 'paid_amount', 'due_amount'),
      db('quotations').where({ dealer_id: dealerId, site_id: siteId }).select('id', 'status', 'total_amount'),
      db('challans').where({ dealer_id: dealerId, site_id: siteId }).select('id'),
      db('deliveries').where({ dealer_id: dealerId, site_id: siteId }).select('id', 'status'),
      db('project_sites as ps')
        .leftJoin('projects as p', 'p.id', 'ps.project_id')
        .leftJoin('customers as c', 'c.id', 'ps.customer_id')
        .where('ps.dealer_id', dealerId).andWhere('ps.id', siteId)
        .select(
          'ps.id', 'ps.site_name', 'ps.address', 'ps.contact_person', 'ps.contact_phone', 'ps.status',
          'p.id as project_id', 'p.project_name', 'p.project_code',
          'c.id as customer_id', 'c.name as customer_name', 'c.phone as customer_phone'
        )
        .first(),
    ]);

    res.json({
      site: site ? {
        id: site.id,
        site_name: site.site_name,
        address: site.address,
        contact_person: site.contact_person,
        contact_phone: site.contact_phone,
        status: site.status,
        projects: site.project_id ? { id: site.project_id, project_name: site.project_name, project_code: site.project_code } : null,
        customers: site.customer_id ? { id: site.customer_id, name: site.customer_name, phone: site.customer_phone } : null,
      } : null,
      summary: {
        quotation_count: quotes.length,
        sales_count: sales.length,
        challan_count: challans.length,
        delivery_count: deliveries.length,
        pending_deliveries: (deliveries as any[]).filter((d) => d.status !== 'delivered').length,
        billed: (sales as any[]).reduce((s, r) => s + toNum(r.total_amount), 0),
        paid: (sales as any[]).reduce((s, r) => s + toNum(r.paid_amount), 0),
        outstanding: (sales as any[]).reduce((s, r) => s + toNum(r.due_amount), 0),
      },
    });
  } catch (err) {
    console.error('[projects.site-summary]', err);
    res.status(500).json({ error: 'Failed to load site summary' });
  }
});

// ── 7. Site history ──────────────────────────────────────────
router.get('/site-history', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const siteId = (req.query.siteId as string | undefined) || undefined;
  if (!siteId) { res.status(400).json({ error: 'siteId required' }); return; }

  try {
    const [sales, challans, deliveries, quotations] = await Promise.all([
      db('sales').where({ dealer_id: dealerId, site_id: siteId })
        .orderBy('sale_date', 'desc')
        .select('id', 'invoice_number', 'sale_date', 'total_amount', 'paid_amount', 'due_amount', 'sale_status'),
      db('challans').where({ dealer_id: dealerId, site_id: siteId })
        .orderBy('challan_date', 'desc')
        .select('id', 'challan_no', 'challan_date', 'status', 'delivery_status', 'sale_id'),
      db('deliveries').where({ dealer_id: dealerId, site_id: siteId })
        .orderBy('delivery_date', 'desc')
        .select('id', 'delivery_no', 'delivery_date', 'status'),
      db('quotations').where({ dealer_id: dealerId, site_id: siteId })
        .orderBy('quote_date', 'desc')
        .select('id', 'quotation_no', 'quote_date', 'status', 'total_amount'),
    ]);

    const totalSales = (sales as any[]).reduce((s, r) => s + toNum(r.total_amount), 0);
    const totalDue = (sales as any[]).reduce((s, r) => s + toNum(r.due_amount), 0);
    const pendingDeliveries = (deliveries as any[]).filter((d) => d.status !== 'delivered').length;

    res.json({
      sales, challans, deliveries, quotations,
      summary: {
        sales_count: sales.length,
        total_sales: totalSales,
        outstanding: totalDue,
        challan_count: challans.length,
        delivery_count: deliveries.length,
        pending_deliveries: pendingDeliveries,
        quotation_count: quotations.length,
      },
    });
  } catch (err) {
    console.error('[projects.site-history]', err);
    res.status(500).json({ error: 'Failed to load site history' });
  }
});

// ── 8. Dashboard ─────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  try {
    const [activeRes, sites, salesRes, top, recentSales, recentChallans, recentDeliveries] = await Promise.all([
      db('projects').where({ dealer_id: dealerId, status: 'active' }).count<{ count: string }[]>('id as count').first(),
      db('project_sites as ps')
        .leftJoin('projects as p', 'p.id', 'ps.project_id')
        .where('ps.dealer_id', dealerId).andWhere('ps.status', 'active')
        .select('ps.id', 'ps.site_name', 'p.project_name'),
      db('sales').where({ dealer_id: dealerId }).whereNotNull('project_id').select('due_amount'),
      topActiveProjects(dealerId, 5),
      db('sales').where({ dealer_id: dealerId }).whereNotNull('site_id').orderBy('sale_date', 'desc').limit(20)
        .select('site_id', 'sale_date', 'project_id'),
      db('challans').where({ dealer_id: dealerId }).whereNotNull('site_id').orderBy('challan_date', 'desc').limit(20)
        .select('site_id', 'challan_date', 'project_id'),
      db('deliveries').where({ dealer_id: dealerId }).whereNotNull('site_id').orderBy('delivery_date', 'desc').limit(20)
        .select('site_id', 'delivery_date', 'project_id'),
    ]);

    const siteIds = (sites as any[]).map((s) => s.id);
    const pendingMap = new Map<string, number>();
    if (siteIds.length > 0) {
      const pendings = await db('deliveries')
        .where({ dealer_id: dealerId })
        .whereIn('site_id', siteIds)
        .whereNot('status', 'delivered')
        .select('site_id');
      for (const d of pendings as any[]) {
        pendingMap.set(d.site_id, (pendingMap.get(d.site_id) ?? 0) + 1);
      }
    }

    const siteMetaById = new Map<string, { site_name: string; project_name: string }>();
    for (const s of sites as any[]) {
      siteMetaById.set(s.id, { site_name: s.site_name, project_name: s.project_name ?? '—' });
    }

    const pendingDeliveriesBySite = (sites as any[])
      .map((s) => ({
        site_id: s.id,
        site_name: s.site_name,
        project_name: s.project_name ?? '—',
        pending_count: pendingMap.get(s.id) ?? 0,
      }))
      .filter((s) => s.pending_count > 0)
      .sort((a, b) => b.pending_count - a.pending_count)
      .slice(0, 5);

    const totalProjectOutstanding = (salesRes as any[]).reduce((s, r) => s + toNum(r.due_amount), 0);

    const recentMap = new Map<string, any>();
    const consider = (siteId: string | null, projectId: string | null, date: any, kind: 'sale' | 'challan' | 'delivery') => {
      if (!siteId || !date) return;
      const meta = siteMetaById.get(siteId);
      if (!meta) return;
      const dStr = typeof date === 'string' ? date : new Date(date).toISOString().split('T')[0];
      const existing = recentMap.get(siteId);
      if (!existing || dStr > existing.latest_date) {
        recentMap.set(siteId, {
          site_id: siteId,
          site_name: meta.site_name,
          project_id: projectId ?? '',
          project_name: meta.project_name,
          latest_date: dStr,
          kind,
        });
      }
    };
    for (const r of recentSales as any[]) consider(r.site_id, r.project_id, r.sale_date, 'sale');
    for (const r of recentChallans as any[]) consider(r.site_id, r.project_id, r.challan_date, 'challan');
    for (const r of recentDeliveries as any[]) consider(r.site_id, r.project_id, r.delivery_date, 'delivery');

    const recentSiteActivity = Array.from(recentMap.values())
      .sort((a, b) => b.latest_date.localeCompare(a.latest_date))
      .slice(0, 5);

    res.json({
      activeProjectsCount: Number(activeRes?.count ?? 0),
      pendingDeliveriesBySite,
      totalProjectOutstanding,
      topActive: top,
      recentSiteActivity,
    });
  } catch (err) {
    console.error('[projects.dashboard]', err);
    res.status(500).json({ error: 'Failed to load project dashboard' });
  }
});

// ── 9. Project history (panel) ───────────────────────────────
// GET /api/reports/projects/history?projectId=...
// Used by the per-project history panel. NOT financial-gated — visible to salesman as well
// (mirrors the prior direct supabase reads from ProjectHistoryPanel).
router.get('/history', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const projectId = (req.query.projectId as string | undefined) || undefined;
  if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }

  try {
    const [salesRows, challanRows, deliveryRows, quoteRows] = await Promise.all([
      db('sales as s')
        .leftJoin('project_sites as ps', 'ps.id', 's.site_id')
        .where('s.dealer_id', dealerId).andWhere('s.project_id', projectId)
        .orderBy('s.sale_date', 'desc')
        .limit(50)
        .select('s.id', 's.invoice_number', 's.sale_date', 's.total_amount',
                's.paid_amount', 's.due_amount', 's.sale_status',
                'ps.site_name as site_name'),
      db('challans as c')
        .leftJoin('project_sites as ps', 'ps.id', 'c.site_id')
        .where('c.dealer_id', dealerId).andWhere('c.project_id', projectId)
        .orderBy('c.challan_date', 'desc')
        .limit(50)
        .select('c.id', 'c.challan_no', 'c.challan_date', 'c.status',
                'c.delivery_status', 'ps.site_name as site_name'),
      db('deliveries as d')
        .leftJoin('project_sites as ps', 'ps.id', 'd.site_id')
        .where('d.dealer_id', dealerId).andWhere('d.project_id', projectId)
        .orderBy('d.delivery_date', 'desc')
        .limit(50)
        .select('d.id', 'd.delivery_no', 'd.delivery_date', 'd.status',
                'ps.site_name as site_name'),
      db('quotations as q')
        .leftJoin('project_sites as ps', 'ps.id', 'q.site_id')
        .where('q.dealer_id', dealerId).andWhere('q.project_id', projectId)
        .orderBy('q.quote_date', 'desc')
        .limit(50)
        .select('q.id', 'q.quotation_no', 'q.quote_date', 'q.status',
                'q.total_amount', 'ps.site_name as site_name'),
    ]);

    const wrapSite = (rows: any[]) => rows.map((r) => ({
      ...r,
      project_sites: r.site_name ? { site_name: r.site_name } : null,
    }));

    const sales = wrapSite(salesRows as any[]);
    const challans = wrapSite(challanRows as any[]);
    const deliveries = wrapSite(deliveryRows as any[]);
    const quotations = wrapSite(quoteRows as any[]);

    const dates = [
      ...sales.map((s: any) => s.sale_date),
      ...challans.map((c: any) => c.challan_date),
      ...deliveries.map((d: any) => d.delivery_date),
    ]
      .filter(Boolean)
      .map((d: any) => (typeof d === 'string' ? d : new Date(d).toISOString().split('T')[0]));
    const latest = dates.length ? dates.sort().reverse()[0] : null;

    res.json({
      sales, challans, deliveries, quotations,
      quotation_count: quotations.length,
      summary: {
        sales_count: sales.length,
        total_sales: sales.reduce((s: number, r: any) => s + toNum(r.total_amount), 0),
        total_paid: sales.reduce((s: number, r: any) => s + toNum(r.paid_amount), 0),
        outstanding: sales.reduce((s: number, r: any) => s + toNum(r.due_amount), 0),
        challan_count: challans.length,
        delivery_count: deliveries.length,
        pending_deliveries: deliveries.filter((d: any) => d.status !== 'delivered').length,
        latest_activity: latest,
      },
    });
  } catch (err) {
    console.error('[projects.history]', err);
    res.status(500).json({ error: 'Failed to load project history' });
  }
});

export default router;
