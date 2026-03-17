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
    console.log('[Scheduler] Triggering sourcing run...');
    try {
      const { runSourcingEngine } = require('./sourcing-engine');
      await runSourcingEngine();
    } catch (err) {
      console.error('[Scheduler] Sourcing run failed:', err);
    }
  }, { timezone: 'America/Chicago' });
}

module.exports = { startScheduler };
