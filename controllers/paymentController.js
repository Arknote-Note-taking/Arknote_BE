const { PayOS } = require('@payos/node');
const fs = require('fs');
const path = require('path');
const { setUserPro } = require('./userController');

const PAY_FILE = path.join(__dirname, '../data/payments.json');

const initPaymentsFile = () => {
  const dir = path.dirname(PAY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(PAY_FILE)) {
    fs.writeFileSync(PAY_FILE, JSON.stringify({}));
  }
};

const getPayments = () => {
  initPaymentsFile();
  try {
    const data = fs.readFileSync(PAY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
};

const savePayments = (payments) => {
  initPaymentsFile();
  fs.writeFileSync(PAY_FILE, JSON.stringify(payments, null, 2));
};

const PAYOS_CLIENT_ID = process.env.PAYOS_CLIENT_ID;
const PAYOS_API_KEY = process.env.PAYOS_API_KEY;
const PAYOS_CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY;

let payos = null;
if (
  PAYOS_CLIENT_ID &&
  PAYOS_API_KEY &&
  PAYOS_CHECKSUM_KEY &&
  PAYOS_CLIENT_ID !== 'your_client_id_here' &&
  PAYOS_API_KEY !== 'your_api_key_here' &&
  PAYOS_CHECKSUM_KEY !== 'your_checksum_key_here'
) {
  try {
    payos = new PayOS({
      clientId: PAYOS_CLIENT_ID,
      apiKey: PAYOS_API_KEY,
      checksumKey: PAYOS_CHECKSUM_KEY
    });
    console.log("PayOS initialized successfully.");
  } catch (err) {
    console.error("PayOS failed to initialize:", err.message);
  }
} else {
  console.log("PayOS credentials not fully configured yet. Running in placeholder mode.");
}

const createPaymentLink = async (req, res) => {
  try {
    const isMock = process.env.MOCK_PAYMENT === 'true';
    const userId = req.user.id;
    const orderCode = Date.now();

    // Determine frontend url for redirect
    const frontendUrl = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
      ? process.env.CORS_ORIGIN.split(',')[0].trim()
      : 'http://localhost:5173';

    let checkoutUrl = '';

    if (isMock) {
      console.log(`[MOCK PAYMENT] Creating mock checkout for order ${orderCode}`);
      checkoutUrl = `${frontendUrl}/payment-success?code=00&status=PAID&orderCode=${orderCode}`;
    } else {
      if (!payos) {
        return res.status(500).json({
          error: 'Cổng thanh toán PayOS chưa được cấu hình hoặc tài khoản chưa xác thực. Hãy cấu hình PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY vào file backend/.env hoặc cấu hình MOCK_PAYMENT=true để test giả lập.'
        });
      }

      // Check if price is customized. Default is 79,000 VND
      const proPlanPrice = process.env.PRO_PLAN_PRICE ? Number(process.env.PRO_PLAN_PRICE) : 79000;

      const paymentLinkData = {
        orderCode: orderCode,
        amount: proPlanPrice,
        description: `Nang cap Pro ${orderCode.toString().slice(-4)}`,
        cancelUrl: `${frontendUrl}/payment-cancel`,
        returnUrl: `${frontendUrl}/payment-success`,
        items: [
          {
            name: 'Gói Chuyên Nghiệp (Pro) 1 Tháng',
            quantity: 1,
            price: proPlanPrice
          }
        ]
      };

      const paymentLink = await payos.paymentRequests.create(paymentLinkData);
      checkoutUrl = paymentLink.checkoutUrl;
    }

    // Save transaction
    const payments = getPayments();
    payments[orderCode] = {
      userId: userId,
      status: 'pending',
      amount: process.env.PRO_PLAN_PRICE ? Number(process.env.PRO_PLAN_PRICE) : 79000,
      paymentLinkId: isMock ? 'mock_link_id' : '',
      createdAt: new Date().toISOString()
    };
    savePayments(payments);

    res.status(200).json({ checkoutUrl, orderCode });
  } catch (error) {
    console.error("Create payment link error:", error);
    res.status(500).json({ error: error.message || 'Lỗi khi tạo liên kết thanh toán' });
  }
};

const verifyPayment = async (req, res) => {
  try {
    const { orderCode } = req.body;
    if (!orderCode) {
      return res.status(400).json({ error: 'Mã đơn hàng (orderCode) là bắt buộc' });
    }

    const payments = getPayments();
    const transaction = payments[orderCode];
    if (!transaction) {
      return res.status(404).json({ error: 'Không tìm thấy thông tin giao dịch trong hệ thống' });
    }

    const isMock = process.env.MOCK_PAYMENT === 'true';

    if (isMock) {
      console.log(`[MOCK PAYMENT] Verifying order ${orderCode} (Automatic approval)`);

      // Upgrade user
      setUserPro(transaction.userId, true);

      // Update transaction status
      transaction.status = 'paid';
      transaction.paidAt = new Date().toISOString();
      payments[orderCode] = transaction;
      savePayments(payments);

      // Notify via Socket
      if (req.io) {
        req.io.emit('payment_success', { userId: transaction.userId, orderCode });
      }

      return res.status(200).json({
        success: true,
        message: '[MOCK] Thanh toán thành công và tài khoản đã được nâng cấp lên PRO.',
        status: 'PAID',
        amount: transaction.amount
      });
    }

    if (!payos) {
      return res.status(500).json({ error: 'Cổng thanh toán PayOS chưa được cấu hình.' });
    }

    // Call PayOS API to get payment details
    const paymentInfo = await payos.paymentRequests.get(orderCode);

    if (paymentInfo && (paymentInfo.status === 'PAID' || paymentInfo.status === 'COMPLETED')) {
      // Upgrade user
      setUserPro(transaction.userId, true);

      // Update transaction status
      transaction.status = 'paid';
      transaction.paidAt = new Date().toISOString();
      payments[orderCode] = transaction;
      savePayments(payments);

      // Notify via Socket
      if (req.io) {
        req.io.emit('payment_success', { userId: transaction.userId, orderCode });
      }

      return res.status(200).json({
        success: true,
        message: 'Thanh toán thành công và tài khoản đã được nâng cấp lên PRO.',
        status: paymentInfo.status,
        amount: transaction.amount
      });
    }

    res.status(200).json({
      success: false,
      message: `Giao dịch chưa được hoàn thành. Trạng thái hiện tại: ${paymentInfo.status}`,
      status: paymentInfo.status
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    res.status(500).json({ error: error.message || 'Lỗi khi xác minh giao dịch' });
  }
};

const handleWebhook = async (req, res) => {
  try {
    if (!payos) {
      return res.status(500).json({ error: 'PayOS config missing' });
    }

    const body = req.body;

    // Verify signature
    const webhookData = payos.webhooks.verify(body);

    if (webhookData) {
      const { orderCode } = webhookData;

      const payments = getPayments();
      const transaction = payments[orderCode];

      if (transaction) {
        setUserPro(transaction.userId, true);

        transaction.status = 'paid';
        transaction.paidAt = new Date().toISOString();
        payments[orderCode] = transaction;
        savePayments(payments);

        if (req.io) {
          req.io.emit('payment_success', { userId: transaction.userId, orderCode });
        }
      }

      return res.status(200).json({ success: true, message: 'Webhook processed successfully' });
    }

    res.status(400).json({ error: 'Webhook signature verification failed' });
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({ error: error.message || 'Webhook internal error' });
  }
};

module.exports = {
  createPaymentLink,
  verifyPayment,
  handleWebhook
};
