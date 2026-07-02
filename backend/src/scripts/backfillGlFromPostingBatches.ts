/**
 * Backfill gl_journal_entries from existing posting_batches (P6-01).
 *
 * Usage:
 *   cd /var/www/tilessaas/backend
 *   npx tsx src/scripts/backfillGlFromPostingBatches.ts --dealer-id <uuid>
 *   npx tsx src/scripts/backfillGlFromPostingBatches.ts --dealer-id <uuid> --dry-run
 *   npx tsx src/scripts/backfillGlFromPostingBatches.ts --all-dealers
 */
import { db } from '../db/connection';
import { backfillGlForDealer } from '../services/gl/glJournalWriter';

async function listDealerIds(all: boolean, dealerId?: string): Promise<string[]> {
  if (dealerId) return [dealerId];
  if (!all) {
    throw new Error('Specify --dealer-id <uuid> or --all-dealers');
  }
  const rows = await db('posting_batches').distinct('dealer_id').select('dealer_id');
  return rows.map((r) => r.dealer_id as string);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const allDealers = args.includes('--all-dealers');
  const dealerIdx = args.indexOf('--dealer-id');
  const dealerId = dealerIdx >= 0 ? args[dealerIdx + 1] : undefined;
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : undefined;

  const dealerIds = await listDealerIds(allDealers, dealerId);
  console.log(`Backfill GL for ${dealerIds.length} dealer(s)${dryRun ? ' (dry-run)' : ''}...`);

  let totalMirrored = 0;
  for (const id of dealerIds) {
    const result = await backfillGlForDealer(id, { dryRun, limit });
    console.log(`  dealer ${id}: found=${result.batches_found} mirrored=${result.mirrored} skipped=${result.skipped}`);
    totalMirrored += result.mirrored;
  }

  console.log(`Done. total mirrored=${totalMirrored}`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
