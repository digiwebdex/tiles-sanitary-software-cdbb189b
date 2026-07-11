/**
 * V2 Sprint 5E — schema tests for the Import LC tracker (Proforma Invoice,
 * Letter of Credit, Shipment, Container).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const SUPPLIER_ID = '22222222-2222-2222-2222-222222222222';

describe('Proforma Invoice Zod schema', () => {
  const schema = z.object({
    supplier_id: z.string().uuid(),
    pi_number: z.string().trim().min(1),
    pi_date: z.string().min(1),
    total_amount: z.coerce.number().min(0).default(0),
    currency_note: z.string().trim().max(255).nullable().optional(),
    status: z.enum(['draft', 'confirmed', 'cancelled']).default('draft'),
    notes: z.string().nullable().optional(),
  });

  it('accepts a minimal valid PI', () => {
    const parsed = schema.parse({ supplier_id: SUPPLIER_ID, pi_number: 'PI-2026-001', pi_date: '2026-07-06' });
    expect(parsed.status).toBe('draft');
    expect(parsed.total_amount).toBe(0);
  });

  it('accepts a currency_note for FX context without doing FX conversion', () => {
    const parsed = schema.parse({ supplier_id: SUPPLIER_ID, pi_number: 'PI-1', pi_date: '2026-07-06', currency_note: 'USD 12,000 @ approx 118.50' });
    expect(parsed.currency_note).toContain('USD');
  });

  it('rejects an empty pi_number', () => {
    expect(() => schema.parse({ supplier_id: SUPPLIER_ID, pi_number: '', pi_date: '2026-07-06' })).toThrow();
  });
});

describe('Letter of Credit Zod schema', () => {
  const schema = z.object({
    proforma_invoice_id: z.string().uuid().nullable().optional(),
    supplier_id: z.string().uuid(),
    lc_number: z.string().trim().min(1),
    lc_date: z.string().min(1),
    issuing_bank: z.string().trim().max(255).nullable().optional(),
    lc_amount: z.coerce.number().min(0).default(0),
    expiry_date: z.string().nullable().optional(),
    status: z.enum(['draft', 'opened', 'amended', 'closed', 'cancelled']).default('draft'),
    notes: z.string().nullable().optional(),
  });

  it('accepts an LC with no proforma invoice linked', () => {
    const parsed = schema.parse({ supplier_id: SUPPLIER_ID, lc_number: 'LC-001', lc_date: '2026-07-06' });
    expect(parsed.proforma_invoice_id).toBeUndefined();
  });

  it('accepts all 5 documented LC statuses', () => {
    for (const s of ['draft', 'opened', 'amended', 'closed', 'cancelled']) {
      expect(() => schema.parse({ supplier_id: SUPPLIER_ID, lc_number: 'LC-1', lc_date: '2026-07-06', status: s })).not.toThrow();
    }
  });

  it('rejects an undocumented status', () => {
    expect(() => schema.parse({ supplier_id: SUPPLIER_ID, lc_number: 'LC-1', lc_date: '2026-07-06', status: 'pending' })).toThrow();
  });
});

describe('Shipment + Container Zod schema', () => {
  const containerSchema = z.object({
    container_no: z.string().trim().min(1),
    container_size: z.string().trim().max(20).nullable().optional(),
    seal_no: z.string().trim().max(50).nullable().optional(),
    notes: z.string().nullable().optional(),
  });
  const shipmentSchema = z.object({
    letter_of_credit_id: z.string().uuid().nullable().optional(),
    supplier_id: z.string().uuid(),
    purchase_id: z.string().uuid().nullable().optional(),
    shipment_ref: z.string().trim().min(1),
    status: z.enum(['in_transit', 'arrived', 'customs_clearance', 'cleared', 'cancelled']).default('in_transit'),
    containers: z.array(containerSchema).default([]),
  });

  it('accepts a shipment with multiple containers', () => {
    const parsed = shipmentSchema.parse({
      supplier_id: SUPPLIER_ID,
      shipment_ref: 'SHIP-001',
      containers: [
        { container_no: 'MSCU1234567', container_size: '40ft' },
        { container_no: 'MSCU7654321', container_size: '20ft' },
      ],
    });
    expect(parsed.containers).toHaveLength(2);
  });

  it('accepts a shipment with zero containers (not yet loaded)', () => {
    const parsed = shipmentSchema.parse({ supplier_id: SUPPLIER_ID, shipment_ref: 'SHIP-002' });
    expect(parsed.containers).toEqual([]);
  });

  it('accepts all 5 documented shipment statuses', () => {
    for (const s of ['in_transit', 'arrived', 'customs_clearance', 'cleared', 'cancelled']) {
      expect(() => shipmentSchema.parse({ supplier_id: SUPPLIER_ID, shipment_ref: 'S', status: s })).not.toThrow();
    }
  });

  it('rejects an empty container_no', () => {
    expect(() => containerSchema.parse({ container_no: '' })).toThrow();
  });
});
