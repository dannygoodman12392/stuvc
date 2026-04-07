const cron = require('node-cron');

function startScheduler() {
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
