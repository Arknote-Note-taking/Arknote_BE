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

/**
 * @swagger
 * tags:
 *   name: Payment
 *   description: PayOS payment integration and PRO subscription endpoints
 */

/**
 * @swagger
 * /api/payment/webhook:
 *   post:
 *     summary: PayOS Webhook receiver (Public)
 *     tags: [Payment]
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 */
router.post('/webhook', handleWebhook);

/**
 * @swagger
 * /api/payment/create-payment-link:
 *   post:
 *     summary: Create PayOS checkout link for PRO upgrade
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment URL generated
 */
router.post('/create-payment-link', requireAuth, createPaymentLink);

/**
 * @swagger
 * /api/payment/verify-payment:
 *   post:
 *     summary: Verify payment status after checkout redirect
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment verified and PRO account activated
 */
router.post('/verify-payment', requireAuth, verifyPayment);

// Admin revenue routes
router.get('/admin/revenue-summary', requireAuth, getRevenueSummary);
router.get('/admin/transactions', requireAuth, getAdminTransactions);

module.exports = router;
