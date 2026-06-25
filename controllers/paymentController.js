const { PayOS } = require('@payos/node');
const supabase = require('../config/supabaseClient');
const { setUserPro } = require('./userController');

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

    // Determine frontend url for redirect (prioritize FRONTEND_URL env)
    const frontendUrl = process.env.FRONTEND_URL ||
      (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
        ? process.env.CORS_ORIGIN.split(',')[0].trim()
        : 'http://localhost:5173');

    // Support custom amount from request body, fallback to PRO_PLAN_PRICE or 79000
    // PayOS requires minimum amount of 1000 VND
    const bodyAmount = (req.body && req.body.amount) ? Number(req.body.amount) : null;
    const envPrice = process.env.PRO_PLAN_PRICE ? Number(process.env.PRO_PLAN_PRICE) : 79000;
    const finalAmount = bodyAmount && bodyAmount >= 1000 ? bodyAmount : envPrice;

    let checkoutUrl = '';

    if (isMock) {
      console.log(`[MOCK PAYMENT] Creating mock checkout for order ${orderCode} with amount ${finalAmount}`);
      checkoutUrl = `${frontendUrl}/payment-success?code=00&status=PAID&orderCode=${orderCode}`;
    } else {
      if (!payos) {
        return res.status(500).json({
          error: 'Cổng thanh toán PayOS chưa được cấu hình hoặc tài khoản chưa xác thực. Hãy cấu hình PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY vào file backend/.env hoặc cấu hình MOCK_PAYMENT=true để test giả lập.'
        });
      }

      const paymentLinkData = {
        orderCode: orderCode,
        amount: finalAmount,
        description: `Nang cap Pro ${orderCode.toString().slice(-4)}`,
        cancelUrl: `${frontendUrl}/payment-cancel`,
        returnUrl: `${frontendUrl}/payment-success`,
        items: [
          {
            name: 'Gói Chuyên Nghiệp (Pro) 1 Tháng',
            quantity: 1,
            price: finalAmount
          }
        ]
      };

      const paymentLink = await payos.paymentRequests.create(paymentLinkData);
      checkoutUrl = paymentLink.checkoutUrl;
    }

    // Save transaction to Supabase
    const { error: insertError } = await supabase
      .from('payments')
      .insert([{
        user_id: userId,
        order_code: orderCode,
        amount: finalAmount,
        status: 'pending',
        payment_link_id: isMock ? 'mock_link_id' : ''
      }]);

    if (insertError) throw insertError;

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

    // Fetch transaction from Supabase
    const { data: transaction, error: fetchError } = await supabase
      .from('payments')
      .select('*')
      .eq('order_code', orderCode)
      .single();

    if (fetchError || !transaction) {
      return res.status(404).json({ error: 'Không tìm thấy thông tin giao dịch trong hệ thống' });
    }

    const isMock = process.env.MOCK_PAYMENT === 'true';

    if (isMock) {
      console.log(`[MOCK PAYMENT] Verifying order ${orderCode} (Automatic approval)`);

      // Upgrade user
      await setUserPro(transaction.user_id, true);

      // Update transaction status in Supabase
      const { error: updateError } = await supabase
        .from('payments')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString()
        })
        .eq('order_code', orderCode);

      if (updateError) throw updateError;

      // Notify via Socket
      if (req.io) {
        req.io.emit('payment_success', { userId: transaction.user_id, orderCode });
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
      await setUserPro(transaction.user_id, true);

      // Update transaction status in Supabase
      const { error: updateError } = await supabase
        .from('payments')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString()
        })
        .eq('order_code', orderCode);

      if (updateError) throw updateError;

      // Notify via Socket
      if (req.io) {
        req.io.emit('payment_success', { userId: transaction.user_id, orderCode });
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

      // Fetch transaction from Supabase
      const { data: transaction, error: fetchError } = await supabase
        .from('payments')
        .select('*')
        .eq('order_code', orderCode)
        .single();

      if (transaction && transaction.status !== 'paid') {
        await setUserPro(transaction.user_id, true);

        const { error: updateError } = await supabase
          .from('payments')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString()
          })
          .eq('order_code', orderCode);

        if (updateError) throw updateError;

        if (req.io) {
          req.io.emit('payment_success', { userId: transaction.user_id, orderCode });
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
