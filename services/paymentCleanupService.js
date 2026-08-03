const { autoCancelExpiredPayments } = require('../controllers/paymentController');

const CLEANUP_INTERVAL_MS = 60 * 1000; // Run every 60 seconds

let intervalId = null;

const startPaymentCleanupInterval = () => {
  if (intervalId) return;

  console.log('[PaymentCleanupService] Starting payment cleanup interval (every 60s)...');
  
  // Run once immediately on startup
  autoCancelExpiredPayments();

  intervalId = setInterval(async () => {
    try {
      await autoCancelExpiredPayments();
    } catch (err) {
      console.error('[PaymentCleanupService] Error in interval check:', err.message);
    }
  }, CLEANUP_INTERVAL_MS);
};

const stopPaymentCleanupInterval = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[PaymentCleanupService] Payment cleanup interval stopped.');
  }
};

module.exports = {
  startPaymentCleanupInterval,
  stopPaymentCleanupInterval
};
