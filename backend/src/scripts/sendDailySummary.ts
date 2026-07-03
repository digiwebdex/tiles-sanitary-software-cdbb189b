#!/usr/bin/env tsx
/**
 * Cron: send daily business summary via WhatsApp to all active dealer admins.
 *
 * Schedule (Bangladesh 11 PM = 17:00 UTC):
 *   0 17 * * * cd /var/www/tilessaas/backend && npm run cron:daily-summary >> /var/log/tilessaas/daily-summary.log 2>&1
 */
import { checkDbConnection } from '../db/connection';
import { sendDealerDailySummaries } from '../services/dealerDailySummaryService';

async function main() {
  await checkDbConnection();
  console.log(`[daily-summary] Starting at ${new Date().toISOString()}`);
  const result = await sendDealerDailySummaries();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) {
    console.error('[daily-summary] Errors:', result.errors);
  }
  const exitCode = result.total > 0 && result.sent === 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[cron:daily-summary] fatal:', err);
  process.exit(1);
});
