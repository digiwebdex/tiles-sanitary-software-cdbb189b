/**
 * Phase 5 — tax_posting_lines writes for Mushak register reconciliation (P5-03).
 */
import type { Knex } from 'knex';
import { db } from '../db/connection';
import { normalizeDealerVatSettings } from '../lib/vatMath';

export interface TaxPostingLineInput {
  dealerId: string;
  postingBatchId?: string | null;
  documentType: 'sale' | 'purchase';
  documentId: string;
  entryDate: string;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  sdAmount?: number;
  partyId?: string | null;
  partyTaxId?: string | null;
  mushakForm: '6.3' | '6.1';
}

export async function loadDealerVatSettings(
  dealerId: string,
  trx?: Knex.Transaction,
): Promise<ReturnType<typeof normalizeDealerVatSettings>> {
  const row = await (trx ?? db)('dealers')
    .where({ id: dealerId })
    .first('vat_enabled', 'default_vat_rate');
  return normalizeDealerVatSettings(row);
}

export async function insertTaxPostingLine(
  trx: Knex.Transaction,
  input: TaxPostingLineInput,
): Promise<void> {
  const sd = input.sdAmount ?? 0;
  if (input.taxAmount <= 0 && sd <= 0) return;

  await trx('tax_posting_lines').insert({
    dealer_id: input.dealerId,
    posting_batch_id: input.postingBatchId ?? null,
    document_type: input.documentType,
    document_id: input.documentId,
    tax_type: 'vat',
    taxable_amount: input.taxableAmount,
    tax_rate: input.taxRate,
    tax_amount: input.taxAmount,
    sd_amount: sd,
    entry_date: input.entryDate,
    party_id: input.partyId ?? null,
    party_tax_id: input.partyTaxId?.trim() || null,
    mushak_form: input.mushakForm,
    metadata: {},
  });
}
