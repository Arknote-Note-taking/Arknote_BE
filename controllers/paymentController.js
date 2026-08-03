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

    // Verify signature (throws error if signature is invalid)
    const webhookData = payos.webhooks.verify(body);

    if (webhookData) {
      const { orderCode, code, amount } = webhookData;

      // 1. Double check the transaction code is '00' (success)
      if (code !== '00') {
        console.log(`[Webhook] Payment not successful for order ${orderCode}. Status code: ${code}`);
        return res.status(200).json({ success: true, message: `Webhook processed (Transaction status: ${code})` });
      }

      // Fetch transaction from Supabase
      const { data: transaction, error: fetchError } = await supabase
        .from('payments')
        .select('*')
        .eq('order_code', orderCode)
        .single();

      if (fetchError || !transaction) {
        console.error(`[Webhook] Transaction not found in database for order ${orderCode}`);
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // 2. Validate transaction amount
      if (transaction.amount !== amount) {
        console.error(`[Webhook] Amount mismatch for order ${orderCode}. Expected: ${transaction.amount}, Received: ${amount}`);
        return res.status(400).json({ error: 'Amount mismatch' });
      }

      if (transaction.status !== 'paid') {
        // Upgrade user to PRO status
        await setUserPro(transaction.user_id, true);

        // Update transaction status to paid
        const { error: updateError } = await supabase
          .from('payments')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString()
          })
          .eq('order_code', orderCode);

        if (updateError) {
          console.error(`[Webhook] Failed to update payment status for order ${orderCode}:`, updateError.message);
          throw updateError;
        }

        if (req.io) {
          req.io.emit('payment_success', { userId: transaction.user_id, orderCode });
        }
        
        console.log(`[Webhook] Payment verified successfully and upgraded user ${transaction.user_id} to PRO.`);
      }

      return res.status(200).json({ success: true, message: 'Webhook processed successfully' });
    }

    res.status(400).json({ error: 'Webhook signature verification failed' });
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({ error: error.message || 'Webhook internal error' });
  }
};

const getRevenueSummary = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Quyền truy cập bị từ chối. Chỉ Admin mới có thể xem báo cáo doanh thu.' });
    }

    // Fetch all payments joined with users
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*, users(id, email, name, avatar_url)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const allPayments = payments || [];

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let totalRevenue = 0;
    let todayRevenue = 0;
    let monthRevenue = 0;
    let yearRevenue = 0;

    let paidCount = 0;
    let pendingCount = 0;
    let cancelledCount = 0;

    // Daily revenue map (last 30 days)
    const dailyMap = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyMap[key] = { date: key, revenue: 0, count: 0 };
    }

    // Monthly revenue map (12 months of current year)
    const monthlyMap = {};
    for (let m = 1; m <= 12; m++) {
      const mStr = `${currentYear}-${m < 10 ? '0' + m : m}`;
      monthlyMap[mStr] = { month: mStr, label: `Thg ${m}`, revenue: 0, count: 0 };
    }

    // Yearly revenue map
    const yearlyMap = {};

    allPayments.forEach(p => {
      const pAmount = Number(p.amount) || 0;
      const status = (p.status || 'pending').toLowerCase();

      if (status === 'paid') {
        paidCount++;
        totalRevenue += pAmount;

        const dateObj = new Date(p.paid_at || p.created_at);
        const pDateStr = dateObj.toISOString().slice(0, 10);
        const pMonth = dateObj.getMonth();
        const pYear = dateObj.getFullYear();
        const pMonthStr = `${pYear}-${pMonth + 1 < 10 ? '0' + (pMonth + 1) : pMonth + 1}`;

        if (pDateStr === todayStr) {
          todayRevenue += pAmount;
        }

        if (pMonth === currentMonth && pYear === currentYear) {
          monthRevenue += pAmount;
        }

        if (pYear === currentYear) {
          yearRevenue += pAmount;
        }

        // Daily
        if (dailyMap[pDateStr]) {
          dailyMap[pDateStr].revenue += pAmount;
          dailyMap[pDateStr].count += 1;
        }

        // Monthly
        if (monthlyMap[pMonthStr]) {
          monthlyMap[pMonthStr].revenue += pAmount;
          monthlyMap[pMonthStr].count += 1;
        }

        // Yearly
        if (!yearlyMap[pYear]) {
          yearlyMap[pYear] = { year: String(pYear), revenue: 0, count: 0 };
        }
        yearlyMap[pYear].revenue += pAmount;
        yearlyMap[pYear].count += 1;
      } else if (status === 'pending') {
        pendingCount++;
      } else if (status === 'cancelled' || status === 'canceled' || status === 'failed') {
        cancelledCount++;
      }
    });

    const totalTransactions = allPayments.length;
    const avgTransactionValue = paidCount > 0 ? Math.round(totalRevenue / paidCount) : 0;

    res.status(200).json({
      summary: {
        totalRevenue,
        todayRevenue,
        monthRevenue,
        yearRevenue,
        totalTransactions,
        paidCount,
        pendingCount,
        cancelledCount,
        avgTransactionValue
      },
      daily: Object.values(dailyMap),
      monthly: Object.values(monthlyMap),
      yearly: Object.values(yearlyMap).sort((a, b) => a.year.localeCompare(b.year))
    });
  } catch (error) {
    console.error("Get revenue summary error:", error);
    res.status(500).json({ error: error.message || 'Lỗi khi lấy thông tin doanh thu' });
  }
};

const getAdminTransactions = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Quyền truy cập bị từ chối.' });
    }

    const { status, search } = req.query;

    let query = supabase
      .from('payments')
      .select('*, users(id, email, name, avatar_url)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: transactions, error, count } = await query;

    if (error) throw error;

    let filtered = transactions || [];

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(t => {
        const orderStr = String(t.order_code || '').toLowerCase();
        const userEmail = (t.users?.email || '').toLowerCase();
        const userName = (t.users?.name || t.users?.full_name || '').toLowerCase();
        return orderStr.includes(q) || userEmail.includes(q) || userName.includes(q);
      });
    }

    res.status(200).json({
      transactions: filtered,
      totalCount: count || filtered.length
    });
  } catch (error) {
    console.error("Get admin transactions error:", error);
    res.status(500).json({ error: error.message || 'Lỗi khi lấy danh sách giao dịch' });
  }
};

module.exports = {
  createPaymentLink,
  verifyPayment,
  handleWebhook,
  getRevenueSummary,
  getAdminTransactions
};

