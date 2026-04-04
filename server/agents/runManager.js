/**
 * In-memory registry for active assessment runs.
 * Supports cancellation via AbortController.
 */
const activeRuns = new Map();

module.exports = {
  register(assessmentId) {
    const controller = new AbortController();
    activeRuns.set(assessmentId, controller);
    return controller.signal;
  },

  cancel(assessmentId) {
    const controller = activeRuns.get(assessmentId);
    if (controller) {
      controller.abort();
      activeRuns.delete(assessmentId);
      return true;
    }
    return false;
  },

  cleanup(assessmentId) {
    activeRuns.delete(assessmentId);
  },

  isRunning(assessmentId) {
    return activeRuns.has(assessmentId);
  }
};
