/**
 * Customer Statement route.
 *
 *   GET /api/customer-statements/:customerId?dealerId=&from=&to=
 *     -> { customer, opening_balance, entries: [{date,type,description,debit,credit,balance,ref}], closing_balance, totals }
 *
 *   GET /api/customer-statements/credit/list?dealerId=
 *     -> credit customers with current due > 0 (for bulk send)
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined);
  if (isSuper) {
    if (!claimed) { res.status(400).json({ error: 'super_admin must specify dealerId' }); return null; }
    return claimed;
  }
  if (!req.dealerId) { res.status(403).json({ error: 'No dealer assigned' }); return null; }
  if (claimed && claimed !== req.dealerId) { res.status(403).json({ error: 'dealerId mismatch' }); return null; }
  return req.dealerId;
}

function requireAdmin(req: Request, res: Response): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can view statements' });
    return false;
  }
  return true;
}

router.get('/credit/list', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    // All customers with their net due (opening + sales - payments - refunds)
    const rows = await db.raw(`
      SELECT
        c.id, c.name, c.phone, c.email, c.address, c.credit_limit, c.max_overdue_days, c.opening_balance,
        COALESCE(c.opening_balance,0)
          + COALESCE(SUM(CASE WHEN cl.type IN ('sale','adjustment') THEN cl.amount ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN cl.type IN ('payment','refund') THEN cl.amount ELSE 0 END),0) AS due_balance
      FROM customers c
      LEFT JOIN customer_ledger cl ON cl.customer_id = c.id AND cl.dealer_id = c.dealer_id
      WHERE c.dealer_id = ?
      GROUP BY c.id
      HAVING COALESCE(c.opening_balance,0)
          + COALESCE(SUM(CASE WHEN cl.type IN ('sale','adjustment') THEN cl.amount ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN cl.type IN ('payment','refund') THEN cl.amount ELSE 0 END),0) > 0
      ORDER BY due_balance DESC
    `, [dealerId]);
    res.json(rows.rows.map((r: any) => ({
      ...r,
      opening_balance: Number(r.opening_balance) || 0,
      credit_limit: Number(r.credit_limit) || 0,
      due_balance: Number(r.due_balance) || 0,
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:customerId', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const { customerId } = req.params;
    const from = (req.query.from as string) || null;
    const to = (req.query.to as string) || null;

    const customer = await db('customers').where({ id: customerId, dealer_id: dealerId }).first();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const dealer = await db('dealers').where({ id: dealerId }).first();

    // Opening balance = customer.opening_balance + all ledger entries before `from`.
    // 'opening_balance'-typed rows (V2 Sprint 6B) are excluded here: they are a
    // GL/AR-total-only mirror of the same `customer.opening_balance` figure
    // already added below — including them too would double-count it.
    let openingQ = db('customer_ledger')
      .where({ customer_id: customerId, dealer_id: dealerId })
      .whereNot('type', 'opening_balance');
    if (from) openingQ = openingQ.where('entry_date', '<', from);
    const openingRows = await openingQ.select('type', 'amount');
    let opening = Number(customer.opening_balance) || 0;
    for (const r of openingRows) {
      const amt = Number(r.amount) || 0;
      if (r.type === 'sale' || r.type === 'adjustment') opening += amt;
      else if (r.type === 'payment' || r.type === 'refund') opening -= amt;
    }

    // Entries in window (same 'opening_balance' exclusion as above).
    let rangeQ = db('customer_ledger as cl')
      .leftJoin('sales as s', 's.id', 'cl.sale_id')
      .leftJoin('sales_returns as sr', 'sr.id', 'cl.sales_return_id')
      .where('cl.customer_id', customerId).where('cl.dealer_id', dealerId)
      .whereNot('cl.type', 'opening_balance');
    if (from) rangeQ = rangeQ.where('cl.entry_date', '>=', from);
    if (to) rangeQ = rangeQ.where('cl.entry_date', '<=', to);
    const ledgerRows = await rangeQ
      .orderBy('cl.entry_date', 'asc').orderBy('cl.created_at', 'asc')
      .select('cl.*', 's.invoice_number as sale_invoice', 'sr.id as return_id');

    let running = opening;
    const entries = ledgerRows.map((r: any) => {
      const amt = Number(r.amount) || 0;
      const isDebit = r.type === 'sale' || r.type === 'adjustment';
      const debit = isDebit ? amt : 0;
      const credit = !isDebit ? amt : 0;
      running += isDebit ? amt : -amt;
      const description = r.description ||
        (r.type === 'sale' ? `Sale - Invoice #${r.sale_invoice || '-'}` :
         r.type === 'payment' ? 'Payment received' :
         r.type === 'refund' ? 'Refund / Return' : 'Adjustment');
      return {
        date: r.entry_date, type: r.type, description, debit, credit, balance: running,
        sale_invoice: r.sale_invoice || null,
      };
    });

    const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
    const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

    res.json({
      customer: {
        id: customer.id, name: customer.name, phone: customer.phone, email: customer.email,
        address: customer.address, credit_limit: Number(customer.credit_limit) || 0,
      },
      dealer: dealer ? { name: dealer.name, phone: dealer.phone, address: dealer.address } : null,
      from, to,
      opening_balance: opening,
      entries,
      closing_balance: running,
      totals: { debit: totalDebit, credit: totalCredit },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
