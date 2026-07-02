#!/usr/bin/env tsx
/**
 * Cron: send both Day 5 and Day 7 trial reminders.
 *
 * Schedule (Bangladesh 9 AM daily):
 *   0 9 * * * cd /var/www/tilessaas/backend && npm run cron:trial-reminders >> /var/log/tilessaas/trial-reminders.log 2>&1
 */
import { checkDbConnection } from '../db/connection';
import { sendAllTrialReminders } from '../services/trialReminderService';

async function main() {
  await checkDbConnection();
  const results = await sendAllTrialReminders();
  console.log(JSON.stringify(results, null, 2));
  const allFailed = results.every((r) => r.failed > 0 && r.sent === 0);
  process.exit(allFailed && results.some((r) => r.scanned > 0) ? 1 : 0);
}

main().catch((err) => {
  console.error('[cron:trial-reminders] fatal:', err);
  process.exit(1);
});
