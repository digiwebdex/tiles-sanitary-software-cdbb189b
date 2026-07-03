#!/usr/bin/env tsx
/**
 * Cron: send Day 5 trial reminder (2 days left) via SMS + email.
 *
 * Schedule (Bangladesh 9 AM daily):
 *   0 9 * * * cd /var/www/tilessaas/backend && npm run cron:trial-day5 >> /var/log/tilessaas/trial-day5.log 2>&1
 */
import { checkDbConnection } from '../db/connection';
import { sendTrialDay5Reminders } from '../services/trialReminderService';

async function main() {
  await checkDbConnection();
  const result = await sendTrialDay5Reminders();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failed > 0 && result.sent === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[cron:trial-day5] fatal:', err);
  process.exit(1);
});
