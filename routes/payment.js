const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const { 
  createPaymentLink, 
  verifyPayment, 
  handleWebhook,
  getRevenueSummary,
  getAdminTransactions
} = require('../controllers/paymentController');

// Webhook does not require authentication since it is triggered by PayOS
router.post('/webhook', handleWebhook);

// Protected routes (requires user logged in)
router.post('/create-payment-link', requireAuth, createPaymentLink);
router.post('/verify-payment', requireAuth, verifyPayment);

// Admin revenue routes
router.get('/admin/revenue-summary', requireAuth, getRevenueSummary);
router.get('/admin/transactions', requireAuth, getAdminTransactions);

module.exports = router;
