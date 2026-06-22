const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const { createPaymentLink, verifyPayment, handleWebhook } = require('../controllers/paymentController');

// Webhook does not require authentication since it is triggered by PayOS
router.post('/webhook', handleWebhook);

// Protected routes (requires user logged in)
router.post('/create-payment-link', requireAuth, createPaymentLink);
router.post('/verify-payment', requireAuth, verifyPayment);

module.exports = router;
