#!/usr/bin/env tsx
/**
 * Cron: send subscription-expiry reminders for all dealers due `days_before`
 * days from now (SMS / WhatsApp / Email per reminder_settings).
 *
 * Schedule (Bangladesh 9 AM daily):
 *   0 9 * * * cd /var/www/tilessaas/backend && npm run cron:expiry-reminders >> /var/log/tilessaas/expiry-reminders.log 2>&1
 */
import { checkDbConnection } from '../db/connection';
import { sendExpiryReminders } from '../services/subscriptionReminderService';

async function main() {
  await checkDbConnection();
  const result = await sendExpiryReminders();
  console.log(JSON.stringify(result, null, 2));
  // Exit non-zero only if we had candidates but every send failed.
  const total = result.sent + result.failed;
  process.exit(total > 0 && result.sent === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[cron:expiry-reminders] fatal:', err);
  process.exit(1);
});
