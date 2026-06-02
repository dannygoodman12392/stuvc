const cron = require('node-cron');

// Daily newsletter brief — runs independently of the sourcing pipeline so the
// brief is ready each morning even when sourcing crons are off.
function startNewsletterScheduler() {
  const cronExpr = process.env.NEWSLETTER_CRON || '0 6 * * *'; // Default: daily at 6am CT
  console.log(`[Scheduler] Newsletter brief scheduled: ${cronExpr}`);
  cron.schedule(cronExpr, async () => {
    try {
      const db = require('../db');
      const { fetchAndProcess } = require('../services/newsletter');
      // Users who have configured a Gmail App Password for newsletters.
      const users = db.prepare(`
        SELECT DISTINCT user_id FROM user_settings
        WHERE setting_key = 'newsletter_gmail_app_password'
          AND setting_value IS NOT NULL AND setting_value != '' AND setting_value != '""'
      `).all();
      for (const { user_id } of users) {
        try {
          const r = await fetchAndProcess(user_id, { limit: 40 });
          console.log(`[Scheduler][Newsletter] user ${user_id}:`, r.ok ? `${r.added} added` : r.error);
        } catch (err) {
          console.error(`[Scheduler][Newsletter] user ${user_id} failed:`, err.message);
        }
      }
    } catch (err) {
      console.error('[Scheduler][Newsletter] run failed:', err.message);
    }
  }, { timezone: 'America/Chicago' });
}

function startScheduler() {
  // Newsletter brief is always scheduled (not gated by PIPELINE_ENABLED).
  startNewsletterScheduler();

  const enabled = process.env.PIPELINE_ENABLED === 'true';
  const cronExpr = process.env.PIPELINE_CRON || '0 6 * * *'; // Default: daily at 6am

  if (!enabled) {
    console.log('[Scheduler] Pipeline disabled');
    return;
  }

  console.log(`[Scheduler] Sourcing engine scheduled: ${cronExpr}`);
  cron.schedule(cronExpr, async () => {
    console.log('[Scheduler] Triggering sourcing runs for all active users...');
    try {
      const db = require('../db');
      const { runSourcingEngine } = require('./sourcing-engine');

      // Get all users who completed onboarding and have an Exa key
      const users = db.prepare(`
        SELECT DISTINCT u.id
        FROM users u
        JOIN user_settings us ON us.user_id = u.id AND us.setting_key = 'api_key_exa' AND us.setting_value IS NOT NULL AND us.setting_value != '""'
        WHERE u.onboarding_complete = 1
      `).all();

      // Also include user_id=1 (uses env var fallback)
      const userIds = new Set(users.map(u => u.id));
      userIds.add(1);

      console.log(`[Scheduler] Running sourcing for ${userIds.size} user(s): ${[...userIds].join(', ')}`);

      for (const userId of userIds) {
        try {
          console.log(`[Scheduler] Starting sourcing for user ${userId}`);
          await runSourcingEngine({ userId });
          console.log(`[Scheduler] Completed sourcing for user ${userId}`);
        } catch (err) {
          console.error(`[Scheduler] Sourcing failed for user ${userId}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Scheduler run failed:', err);
    }
  }, { timezone: 'America/Chicago' });
}

module.exports = { startScheduler };
